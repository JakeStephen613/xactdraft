const express = require('express')
const router = express.Router()

const db = require('../db/client')
const { authenticate } = require('../middleware/auth')
const { requestLimiter } = require('../middleware/ratelimit')
const { encrypt } = require('../lib/crypto')

// GET /api/auth/me
router.get('/me', authenticate, requestLimiter, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, plan,
              (xactimate_credentials_encrypted IS NOT NULL) AS has_xactimate_creds
       FROM users WHERE id = $1`,
      [req.user.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    res.json(rows[0])
  } catch (err) {
    console.error('GET /auth/me:', err)
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// POST /api/auth/xactimate
// Body: { username: string, password: string }
router.post('/xactimate', authenticate, requestLimiter, async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' })
  }

  const encrypted = encrypt(JSON.stringify({ username, password }))

  await db.query(
    'UPDATE users SET xactimate_credentials_encrypted = $1 WHERE id = $2',
    [encrypted, req.user.id]
  )

  res.json({ success: true })
})

module.exports = router
