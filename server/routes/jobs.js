const express = require('express')
const router = express.Router()
const multer = require('multer')
const { v4: uuidv4 } = require('uuid')

const db = require('../db/client')
const { jobSubmissionLimiter, concurrencyLimiter } = require('../middleware/ratelimit')
const { uploadFile } = require('../services/storage')
const { scanBuffer } = require('../services/scanner')
const { enqueueJob } = require('../services/queue')

const MAX_FILES = 10
const MAX_FILE_SIZE = 20 * 1024 * 1024   // 20 MB
const MAX_TOTAL_SIZE = 100 * 1024 * 1024  // 100 MB

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

// ── POST /api/jobs ────────────────────────────────────────────────────────────
// Creates a job record in 'uploading' state.
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
// Accepts multipart/form-data. Scans, uploads, and queues the job.
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

  // Verify job belongs to this user and is still in uploading state
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

  // Total size guard (individual size already enforced by multer)
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  if (totalSize > MAX_TOTAL_SIZE) {
    return res.status(400).json({
      error: `Total upload size exceeds 100 MB (got ${(totalSize / 1024 / 1024).toFixed(1)} MB)`
    })
  }

  const saved = []

  for (const file of files) {
    const fileId = uuidv4()
    // Sanitise filename: strip path separators that could escape the GCS key
    const safeName = file.originalname.replace(/[/\\]/g, '_')
    const gcsKey = `jobs/${jobId}/${fileId}-${safeName}`

    // Malware scan
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

    // Upload to GCS
    await uploadFile(file.buffer, gcsKey, file.mimetype)

    // Persist metadata
    await db.query(
      `INSERT INTO files (id, job_id, filename, gcs_key, file_type, size_bytes, malware_clean)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [fileId, jobId, file.originalname, gcsKey, file.mimetype, file.size]
    )

    saved.push({ fileId, filename: file.originalname })
  }

  // All files clean and uploaded — transition to queued
  await db.query(`UPDATE jobs SET status = 'queued' WHERE id = $1`, [jobId])

  try {
    await enqueueJob(jobId)
  } catch (err) {
    // Queue full: job stays in 'queued' state in DB; worker will pick it up on next poll
    if (err.status === 429) {
      return res.status(429).json({ error: err.message, retryAfter: err.retryAfter })
    }
    throw err
  }

  res.status(201).json({ jobId, status: 'queued', files: saved })
})

// ── GET /api/jobs ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, status, address, description, created_at, completed_at
     FROM jobs WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  )
  res.json(rows)
})

// ── GET /api/jobs/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { rows: [job] } = await db.query(
    `SELECT id, status, address, description, vm_instance_name,
            docusign_envelope_id, error_message, created_at, completed_at
     FROM jobs WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  )
  if (!job) return res.status(404).json({ error: 'Job not found' })

  const { rows: files } = await db.query(
    `SELECT id, filename, file_type, size_bytes, malware_clean, created_at
     FROM files WHERE job_id = $1 ORDER BY created_at`,
    [job.id]
  )

  const { rows: events } = await db.query(
    `SELECT event_type, payload, created_at
     FROM job_events WHERE job_id = $1 ORDER BY created_at`,
    [job.id]
  )

  res.json({ ...job, files, events })
})

// ── PATCH /api/jobs/:id ───────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const { status } = req.body
  const allowed = ['complete']
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Only these status transitions are allowed from the client: ${allowed.join(', ')}` })
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
