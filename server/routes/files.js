const express = require('express')
const router = express.Router()

const db = require('../db/client')
const { getPresignedUrl } = require('../services/storage')

// GET /api/files/:id/download
// Returns a presigned GCS URL valid for 15 minutes.
router.get('/:id/download', async (req, res) => {
  const { rows: [file] } = await db.query(
    `SELECT f.gcs_key
     FROM files f
     JOIN jobs j ON j.id = f.job_id
     WHERE f.id = $1 AND j.user_id = $2`,
    [req.params.id, req.user.id]
  )
  if (!file) return res.status(404).json({ error: 'File not found' })

  const url = await getPresignedUrl(file.gcs_key)
  res.json({ url })
})

module.exports = router
