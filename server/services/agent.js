'use strict'

const { v4: uuidv4 } = require('uuid')
const axios = require('axios')
const Anthropic = require('@anthropic-ai/sdk')
const db = require('../db/client')
const { uploadFile, downloadFile } = require('./storage')
const { spinUpVm, tearDownVm } = require('./vm')
const { incrementConcurrent, decrementConcurrent } = require('../middleware/ratelimit')

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

// ── Context compression ───────────────────────────────────────────────────────
const MAX_CONTEXT_TOKENS = 200_000
const COMPRESS_AT        = Math.floor(MAX_CONTEXT_TOKENS * 0.40)  // compress at 80k tokens
const SCREENSHOT_TOKENS  = 2800   // rough estimate per 1920×1080 PNG
const KEEP_RECENT        = 8      // how many recent messages to retain

function estimateTokens(messages) {
  let tokens = 0
  for (const msg of messages) {
    for (const block of (Array.isArray(msg.content) ? msg.content : [])) {
      if (block.type === 'text') {
        tokens += Math.ceil((block.text || '').length / 4)
      } else if (block.type === 'image') {
        tokens += SCREENSHOT_TOKENS
      } else if (block.type === 'tool_use') {
        tokens += 50 + Math.ceil(JSON.stringify(block.input || {}).length / 4)
      } else if (block.type === 'tool_result') {
        for (const c of (block.content || [])) {
          if (c.type === 'image') tokens += SCREENSHOT_TOKENS
          else if (c.type === 'text') tokens += Math.ceil((c.text || '').length / 4)
        }
      }
    }
  }
  return tokens
}

// Trims old messages when context exceeds 40% of the context window.
// Keeps the initial user message (files + first screenshot) and the most recent turns.
// The alternating user/assistant pattern is preserved by starting the tail at an odd index.
function maybeCompress(messages) {
  if (messages.length <= KEEP_RECENT + 1) return messages
  const before = estimateTokens(messages)
  if (before < COMPRESS_AT) return messages

  // Tail must begin at an assistant message (odd index) to stay after messages[0] (user)
  let tailStart = messages.length - KEEP_RECENT
  if (tailStart % 2 === 0) tailStart++

  const droppedCount = tailStart - 1
  const tail = messages.slice(tailStart)
  const initial = {
    ...messages[0],
    content: [
      ...messages[0].content,
      {
        type: 'text',
        text: `\n[Context trimmed: ${droppedCount} earlier step(s) removed to stay within the context window. Continue the estimate from your current position — the current screen state is in the most recent tool result.]`
      }
    ]
  }

  const after = estimateTokens([initial, ...tail])
  console.log(`[agent] Context compressed — dropped ${droppedCount} messages (~${before} → ~${after} est. tokens)`)
  return [initial, ...tail]
}

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

  let messages = [{
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

    // Compress context if approaching 40% of the context window
    messages = maybeCompress(messages)

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

  // Track per-user concurrent slot. Decremented in finally — cancelled jobs skip
  // the decrement because the cancel handler already called decrementConcurrent.
  await incrementConcurrent(job.user_id).catch(() => {})

  let lastError = null

  try {
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

      // Upload estimate PDF to GCS and register it as a file record
      const estimateFileId = uuidv4()
      const estimateGcsKey = `jobs/${jobId}/estimate.pdf`
      await uploadFile(pdfBuffer, estimateGcsKey, 'application/pdf')
      await db.query(
        `INSERT INTO files (id, job_id, filename, gcs_key, file_type, size_bytes, malware_clean)
         VALUES ($1, $2, 'estimate.pdf', $3, 'application/pdf', $4, true)`,
        [estimateFileId, jobId, estimateGcsKey, pdfBuffer.length]
      )
      await db.query(
        `UPDATE jobs SET status = 'review_ready', estimate_file_id = $1 WHERE id = $2`,
        [estimateFileId, jobId]
      )

      // Notify user with a direct link to the job page
      try {
        const { sendJobReadyEmail } = require('./email')
        const { rows: [user] } = await db.query(
          'SELECT email FROM users WHERE id = $1', [job.user_id]
        )
        const jobUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/jobs/${jobId}`
        if (user?.email) await sendJobReadyEmail(user.email, jobId, job.address, jobUrl)
      } catch (e) {
        console.error('[agent] ready email failed:', e.message)
      }

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
  // Guard: don't overwrite 'cancelled' status if the job was cancelled mid-processing
  await db.query(
    `UPDATE jobs SET status = 'failed', error_message = $1
     WHERE id = $2 AND status != 'cancelled'`,
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

  } finally {
    // Decrement per-user concurrent slot unless the job was cancelled
    // (cancel handler already decremented to avoid double-decrement)
    const { rows: [cur] } = await db.query(
      'SELECT status FROM jobs WHERE id = $1', [jobId]
    ).catch(() => ({ rows: [] }))
    if (cur?.status !== 'cancelled') {
      await decrementConcurrent(job.user_id).catch(() => {})
    }
  }
}

module.exports = { runAgent }
