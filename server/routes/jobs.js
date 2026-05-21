'use strict'

const express = require('express')
const router = express.Router()
const multer = require('multer')
const { v4: uuidv4 } = require('uuid')

const db = require('../db/client')
const { getRedis } = require('../lib/redis')
const { jobSubmissionLimiter, concurrencyLimiter, decrementConcurrent } = require('../middleware/ratelimit')
const { uploadFile } = require('../services/storage')
const { scanBuffer } = require('../services/scanner')
const { enqueueJob } = require('../services/queue')

const MAX_FILES = 10
const MAX_FILE_SIZE = 20 * 1024 * 1024   // 20 MB
const MAX_TOTAL_SIZE = 100 * 1024 * 1024  // 100 MB
const JOB_DAILY_LIMIT = 10

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png',
  'application/pdf',
  'text/plain'
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    ALLOWED_MIME_TYPES.has(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`File type not allowed: ${file.mimetype}`))
  }
})

function draftUrl(envelopeId, accountId) {
  if (!envelopeId || !accountId) return null
  return `${process.env.DOCUSIGN_AUTH_SERVER}/documents/${accountId}/drafts/${envelopeId}`
}

function formatEvent(ev) {
  const p = ev.payload || {}
  switch (ev.event_type) {
    case 'agent_step':
      return `Agent step — stop reason: ${p.stop_reason || '?'}, blocks: ${p.content_blocks ?? '?'}`
    case 'attempt_failed':
      return `Attempt ${p.attempt} failed: ${p.error || 'unknown error'}`
    default:
      return `${ev.event_type}: ${Object.keys(p).length ? JSON.stringify(p) : '(no detail)'}`
  }
}

// ── POST /api/jobs ────────────────────────────────────────────────────────────
router.post('/', jobSubmissionLimiter, concurrencyLimiter, async (req, res) => {
  const { address, description } = req.body
  if (!address?.trim()) {
    return res.status(400).json({ error: 'address is required' })
  }

  const jobId = uuidv4()
  await db.query(
    `INSERT INTO jobs (id, user_id, status, address, description)
     VALUES ($1, $2, 'uploading', $3, $4)`,
    [jobId, req.user.id, address.trim(), description?.trim() || null]
  )

  res.status(201).json({ jobId, uploadUrl: `/api/jobs/${jobId}/files` })
})

// ── POST /api/jobs/:id/files ──────────────────────────────────────────────────
router.post('/:id/files', (req, res, next) => {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'A file exceeds the 20 MB limit'
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Too many files — maximum ${MAX_FILES} per job`
          : err.message
      return res.status(400).json({ error: msg })
    }
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, async (req, res) => {
  const jobId = req.params.id

  const { rows } = await db.query(
    'SELECT id, status FROM jobs WHERE id = $1 AND user_id = $2',
    [jobId, req.user.id]
  )
  if (!rows.length) return res.status(404).json({ error: 'Job not found' })
  if (rows[0].status !== 'uploading') {
    return res.status(409).json({ error: 'Job is not in uploading state' })
  }

  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'No files provided' })

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  if (totalSize > MAX_TOTAL_SIZE) {
    return res.status(400).json({
      error: `Total upload size exceeds 100 MB (got ${(totalSize / 1024 / 1024).toFixed(1)} MB)`
    })
  }

  const saved = []

  for (const file of files) {
    const fileId = uuidv4()
    const safeName = file.originalname.replace(/[/\\]/g, '_')
    const gcsKey = `jobs/${jobId}/${fileId}-${safeName}`

    let scanResult
    try {
      scanResult = await scanBuffer(file.buffer, file.originalname)
    } catch (err) {
      await db.query(
        `INSERT INTO files (id, job_id, filename, gcs_key, file_type, size_bytes, malware_clean)
         VALUES ($1,$2,$3,$4,$5,$6,false)`,
        [fileId, jobId, file.originalname, gcsKey, file.mimetype, file.size]
      )
      return res.status(422).json({ error: `Malware scan failed for "${file.originalname}"` })
    }

    if (!scanResult.clean) {
      await db.query(
        `INSERT INTO files (id, job_id, filename, gcs_key, file_type, size_bytes, malware_clean)
         VALUES ($1,$2,$3,$4,$5,$6,false)`,
        [fileId, jobId, file.originalname, gcsKey, file.mimetype, file.size]
      )
      return res.status(422).json({
        error: `Infected file rejected: "${file.originalname}" (${scanResult.virus})`
      })
    }

    await uploadFile(file.buffer, gcsKey, file.mimetype)

    await db.query(
      `INSERT INTO files (id, job_id, filename, gcs_key, file_type, size_bytes, malware_clean)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [fileId, jobId, file.originalname, gcsKey, file.mimetype, file.size]
    )

    saved.push({ fileId, filename: file.originalname })
  }

  await db.query(`UPDATE jobs SET status = 'queued' WHERE id = $1`, [jobId])

  try {
    await enqueueJob(jobId)
  } catch (err) {
    if (err.status === 429) {
      return res.status(429).json({ error: err.message, retryAfter: err.retryAfter })
    }
    throw err
  }

  res.status(201).json({ jobId, status: 'queued', files: saved })
})

// ── GET /api/jobs ─────────────────────────────────────────────────────────────
// Returns { jobs, usage } — the usage block drives the dashboard meter.
router.get('/', async (req, res) => {
  const redis = getRedis()
  const dayWindow = Math.floor(Date.now() / 86_400_000)
  const concurrentLimit = req.user.plan === 'enterprise' ? 10 : 3

  const [jobRows, jobsToday, concurrentRaw] = await Promise.all([
    db.query(
      `SELECT j.id, j.status, j.address, j.description,
              j.created_at, j.completed_at, j.error_message,
              j.docusign_envelope_id, u.docusign_account_id,
              COUNT(f.id)::int AS file_count
       FROM jobs j
       JOIN users u ON u.id = j.user_id
       LEFT JOIN files f ON f.job_id = j.id
       WHERE j.user_id = $1
       GROUP BY j.id, u.docusign_account_id
       ORDER BY j.created_at DESC`,
      [req.user.id]
    ),
    redis.get(`ratelimit:jobs:${req.user.id}:${dayWindow}`),
    redis.get(`ratelimit:concurrent:${req.user.id}`)
  ])

  const jobs = jobRows.rows.map(job => ({
    ...job,
    docusign_draft_url: draftUrl(job.docusign_envelope_id, job.docusign_account_id)
  }))

  res.json({
    jobs,
    usage: {
      jobsToday:       Math.max(0, parseInt(jobsToday || '0', 10)),
      jobsLimit:       JOB_DAILY_LIMIT,
      concurrentActive: Math.max(0, parseInt(concurrentRaw || '0', 10)),
      concurrentLimit
    }
  })
})

// ── GET /api/jobs/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { rows: [job] } = await db.query(
    `SELECT j.id, j.status, j.address, j.description,
            j.vm_instance_name, j.docusign_envelope_id, j.error_message,
            j.created_at, j.completed_at, u.docusign_account_id
     FROM jobs j
     JOIN users u ON u.id = j.user_id
     WHERE j.id = $1 AND j.user_id = $2`,
    [req.params.id, req.user.id]
  )
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const { rows: files } = await db.query(
    `SELECT id, filename, file_type, size_bytes, malware_clean, created_at
     FROM files WHERE job_id = $1 ORDER BY created_at`,
    [job.id]
  )

  res.json({
    ...job,
    docusign_draft_url: draftUrl(job.docusign_envelope_id, job.docusign_account_id),
    files
  })
})

// ── GET /api/jobs/:id/logs ────────────────────────────────────────────────────
router.get('/:id/logs', async (req, res) => {
  const { rows: [job] } = await db.query(
    'SELECT id FROM jobs WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  )
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const { rows: events } = await db.query(
    `SELECT event_type, payload, created_at
     FROM job_events WHERE job_id = $1 ORDER BY created_at`,
    [job.id]
  )

  const logs = events.map(ev => ({
    timestamp: ev.created_at,
    message: formatEvent(ev)
  }))

  res.json(logs)
})

// ── DELETE /api/jobs/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { rows: [job] } = await db.query(
    'SELECT id, status, user_id FROM jobs WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  )
  if (!job) return res.status(404).json({ error: 'Job not found' })

  if (!['queued', 'processing'].includes(job.status)) {
    return res.status(409).json({ error: 'Only queued or processing jobs can be cancelled' })
  }

  if (job.status === 'processing') {
    const { tearDownVm } = require('../services/vm')
    await tearDownVm(job.id).catch(e => console.error('[cancel] teardown error:', e.message))
    await decrementConcurrent(req.user.id).catch(() => {})
  }

  await db.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [job.id])

  res.json({ success: true })
})

// ── POST /api/jobs/:id/retry ──────────────────────────────────────────────────
router.post('/:id/retry', async (req, res) => {
  const { rows: [job] } = await db.query(
    'SELECT id, status FROM jobs WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  )
  if (!job) return res.status(404).json({ error: 'Job not found' })
  if (job.status !== 'failed') {
    return res.status(409).json({ error: 'Only failed jobs can be retried' })
  }

  await db.query(
    `UPDATE jobs SET status = 'queued', error_message = NULL,
                     vm_instance_name = NULL, vm_ip = NULL
     WHERE id = $1`,
    [job.id]
  )

  await enqueueJob(job.id)

  res.json({ success: true, status: 'queued' })
})

// ── PATCH /api/jobs/:id ───────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const { status } = req.body
  if (status !== 'complete') {
    return res.status(400).json({ error: 'Only status=complete is allowed from the client' })
  }

  const { rows: [job] } = await db.query(
    `UPDATE jobs SET status = $1, completed_at = now()
     WHERE id = $2 AND user_id = $3 AND status = 'review_ready'
     RETURNING id, status`,
    [status, req.params.id, req.user.id]
  )
  if (!job) return res.status(404).json({ error: 'Job not found or not in review_ready state' })

  res.json(job)
})

module.exports = router
