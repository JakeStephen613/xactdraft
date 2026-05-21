const express = require('express')
const router = express.Router()

const db = require('../db/client')
const { authenticate } = require('../middleware/auth')
const { requestLimiter } = require('../middleware/ratelimit')
const { encrypt } = require('../lib/crypto')
const { getAuthUrl, exchangeCode } = require('../services/docusign')

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// GET /api/auth/me
// Returns the authenticated user's profile (no sensitive fields)
router.get('/me', authenticate, requestLimiter, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         id, email, plan, docusign_account_id,
         (xactimate_credentials_encrypted IS NOT NULL) AS has_xactimate_creds,
         (docusign_access_token IS NOT NULL)           AS has_docusign
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
// Encrypts and stores per-user Xactimate credentials
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

// GET /api/auth/docusign/connect
// Returns the DocuSign OAuth authorization URL for the frontend to redirect to
router.get('/docusign/connect', authenticate, requestLimiter, (req, res) => {
  const url = getAuthUrl(req.user.id)
  res.json({ url })
})

// GET /api/auth/docusign/callback?code=...&state=userId
// DocuSign redirects here after the user grants access
router.get('/docusign/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state) {
    return res.redirect(`${CLIENT_URL}/dashboard?docusign=error&reason=missing_params`)
  }

  try {
    await exchangeCode(code, state) // state carries userId from getAuthUrl
    res.redirect(`${CLIENT_URL}/dashboard?docusign=connected`)
  } catch (err) {
    console.error('DocuSign callback error:', err)
    res.redirect(`${CLIENT_URL}/dashboard?docusign=error`)
  }
})

module.exports = router
