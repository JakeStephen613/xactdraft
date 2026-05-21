'use strict'

const axios = require('axios')
const Anthropic = require('@anthropic-ai/sdk')
const db = require('../db/client')
const { downloadFile } = require('./storage')
const { spinUpVm, tearDownVm } = require('./vm')

// ── Constants ─────────────────────────────────────────────────────────────────
const MODEL        = 'claude-sonnet-4-6'
const BETA         = 'computer-use-2025-11-24'
// Tool type follows Anthropic's YYYYMMDD versioning convention for the beta.
// Verify this matches the current Anthropic docs before first production run.
const TOOL_TYPE    = 'computer_20251124'
const AGENT_PORT   = 8765
const TIMEOUT_MS   = 15 * 60 * 1000   // 15 minutes per attempt
const MAX_ATTEMPTS = 2

const DISPLAY_WIDTH  = 1920
const DISPLAY_HEIGHT = 1080

const SYSTEM_PROMPT =
  'You are an expert Xactimate estimator operating Xactimate on a Windows computer. ' +
  'You can see the screen and control the mouse and keyboard. You have been provided ' +
  'job documentation including photos, field notes, and any existing documents. ' +
  'Your task is to create a complete and accurate Xactimate estimate. Open Xactimate ' +
  'if it is not already open. Work through the estimate room by room based on the ' +
  'documentation provided. Enter all line items, quantities, dimensions, and labor ' +
  'and material codes you can identify. When the estimate is fully complete, export ' +
  'it as a PDF using Xactimate built-in PDF export and save it to C:\\output\\estimate.pdf. ' +
  'Then type the single word COMPLETE and nothing else.'

const COMPUTER_TOOL = {
  type: TOOL_TYPE,
  name: 'computer',
  display_width_px: DISPLAY_WIDTH,
  display_height_px: DISPLAY_HEIGHT,
  display_number: 1
}

// ── Anthropic client (lazy singleton) ────────────────────────────────────────
let _client = null
function claude() {
  return _client || (_client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
}

// ── VM agent helpers ──────────────────────────────────────────────────────────
function agentUrl(vmIp, path) {
  return `http://${vmIp}:${AGENT_PORT}${path}`
}

async function takeScreenshot(vmIp) {
  const { data } = await axios.get(agentUrl(vmIp, '/screenshot'), { timeout: 15_000 })
  return data.screenshot  // base64 PNG string
}

async function executeAction(vmIp, action) {
  await axios.post(agentUrl(vmIp, '/action'), action, { timeout: 30_000 })
}

// Pull a file off the VM by absolute Windows path (e.g. 'C:\\output\\estimate.pdf')
async function pullFileFromVm(vmIp, remotePath) {
  const { data } = await axios.get(agentUrl(vmIp, '/file'), {
    params: { path: remotePath },
    responseType: 'arraybuffer',
    timeout: 60_000
  })
  return Buffer.from(data)
}

// ── File content helpers ──────────────────────────────────────────────────────
async function pdfToText(buffer) {
  try {
    const pdfParse = require('pdf-parse')
    const { text } = await pdfParse(buffer)
    return text || ''
  } catch {
    return '[PDF text extraction failed]'
  }
}

// Download each job file from GCS and convert to Claude message content blocks.
// Photos → image blocks.  PDFs / text files → text blocks.
async function buildFileBlocks(files) {
  const blocks = []
  for (const file of files) {
    const buffer = await downloadFile(file.gcs_key)

    if (file.file_type === 'image/jpeg' || file.file_type === 'image/png') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: file.file_type, data: buffer.toString('base64') }
      })
    } else if (file.file_type === 'application/pdf') {
      const text = await pdfToText(buffer)
      blocks.push({
        type: 'text',
        text: `--- PDF: ${file.filename} ---\n${text}\n--- END PDF ---`
      })
    } else {
      blocks.push({
        type: 'text',
        text: `--- File: ${file.filename} ---\n${buffer.toString('utf8')}\n--- END FILE ---`
      })
    }
  }
  return blocks
}

// ── Single-VM agent loop ──────────────────────────────────────────────────────
async function runAgentOnVm(jobId, vmIp, fileBlocks, startTime) {
  const screenshot0 = await takeScreenshot(vmIp)

  const messages = [{
    role: 'user',
    content: [
      ...fileBlocks,
      { type: 'text', text: 'The screenshot below shows the current Windows desktop state.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot0 } }
    ]
  }]

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw Object.assign(new Error('Agent timed out after 15 minutes'), { code: 'TIMEOUT' })
    }

    const response = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: [BETA],
      tools: [COMPUTER_TOOL],
      system: SYSTEM_PROMPT,
      messages
    })

    // Persist step for the job event log shown in the UI
    await db.query(
      `INSERT INTO job_events (job_id, event_type, payload) VALUES ($1, 'agent_step', $2)`,
      [jobId, JSON.stringify({
        stop_reason: response.stop_reason,
        content_blocks: response.content.length
      })]
    ).catch(() => {})  // non-fatal

    messages.push({ role: 'assistant', content: response.content })

    // COMPLETE check — Claude signals completion with this exact word in any text block
    const isDone = response.content.some(b => b.type === 'text' && b.text.includes('COMPLETE'))
    if (isDone) return

    // end_turn without tool use and without COMPLETE means Claude is stuck
    if (response.stop_reason === 'end_turn') {
      const lastText = response.content.find(b => b.type === 'text')?.text || '(no text)'
      throw new Error(`Agent stopped without completing. Last message: "${lastText.slice(0, 200)}"`)
    }

    // Execute each tool_use block, collect tool_results with fresh screenshots
    const toolResults = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const action = block.input

      // screenshot action: just capture, no interaction needed
      if (action.action !== 'screenshot') {
        await executeAction(vmIp, action)
      }

      const screenshot = await takeScreenshot(vmIp)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: screenshot }
        }]
      })
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults })
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
async function runAgent(jobId) {
  // Fetch job record
  const { rows: [job] } = await db.query(
    'SELECT id, user_id FROM jobs WHERE id = $1',
    [jobId]
  )
  if (!job) throw new Error(`Job ${jobId} not found`)

  // Fetch clean files
  const { rows: files } = await db.query(
    `SELECT filename, gcs_key, file_type
     FROM files WHERE job_id = $1 AND malware_clean = true ORDER BY created_at`,
    [jobId]
  )

  // Download files once, build Claude message blocks once (reused across retries)
  const fileBlocks = await buildFileBlocks(files)

  await db.query(`UPDATE jobs SET status = 'processing' WHERE id = $1`, [jobId])

  let lastError = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let vmIp = null
    const startTime = Date.now()

    try {
      vmIp = await spinUpVm(jobId)  // spinUpVm already increments system:active_vms

      await runAgentOnVm(jobId, vmIp, fileBlocks, startTime)

      // Pull the completed estimate PDF off the VM
      const pdfBuffer = await pullFileFromVm(vmIp, 'C:\\output\\estimate.pdf')

      await tearDownVm(jobId)
      vmIp = null

      // Create DocuSign draft (implemented in next step; lazy-require to avoid circular dep)
      try {
        const { createDraftEnvelope } = require('./docusign')
        await createDraftEnvelope(jobId, pdfBuffer)
      } catch (dsErr) {
        console.error(`[agent] DocuSign draft failed for job ${jobId}:`, dsErr.message)
        // createDraftEnvelope handles its own fallback (save PDF to GCS, retry)
      }

      // Notify user
      try {
        const { sendJobReadyEmail } = require('./email')
        const { rows: [user] } = await db.query(
          'SELECT email FROM users WHERE id = $1', [job.user_id]
        )
        if (user?.email) await sendJobReadyEmail(user.email, jobId)
      } catch (e) {
        console.error('[agent] ready email failed:', e.message)
      }

      await db.query(`UPDATE jobs SET status = 'review_ready' WHERE id = $1`, [jobId])
      return  // success

    } catch (err) {
      lastError = err
      console.error(`[agent] Attempt ${attempt}/${MAX_ATTEMPTS} failed for job ${jobId}: ${err.message}`)

      if (vmIp) {
        await tearDownVm(jobId).catch(e => console.error('[agent] tearDown error:', e.message))
      }

      await db.query(
        `INSERT INTO job_events (job_id, event_type, payload) VALUES ($1, 'attempt_failed', $2)`,
        [jobId, JSON.stringify({ attempt, error: err.message })]
      ).catch(() => {})

      if (attempt < MAX_ATTEMPTS) {
        // Reset VM fields so spinUpVm can start fresh
        await db.query(
          'UPDATE jobs SET vm_instance_name = NULL, vm_ip = NULL WHERE id = $1',
          [jobId]
        )
        console.log(`[agent] Retrying job ${jobId} on a fresh VM…`)
      }
    }
  }

  // Both attempts failed
  const errMsg = lastError?.message || 'Agent failed after 2 attempts'
  await db.query(
    `UPDATE jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
    [errMsg, jobId]
  )

  try {
    const { sendJobFailedEmail } = require('./email')
    const { rows: [user] } = await db.query(
      'SELECT email FROM users WHERE id = $1', [job.user_id]
    )
    if (user?.email) await sendJobFailedEmail(user.email, jobId, errMsg)
  } catch (e) {
    console.error('[agent] failure email failed:', e.message)
  }
}

module.exports = { runAgent }
