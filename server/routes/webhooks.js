'use strict'

const crypto = require('crypto')
const express = require('express')
const router = express.Router()
const db = require('../db/client')

function verifySignature(rawBody, signature) {
  const secret = process.env.DOCUSIGN_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

// POST /api/webhooks/docusign
// express.raw() must run BEFORE global express.json(), so webhooks route is
// registered before app.use(express.json()) in index.js
router.post('/docusign', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-docusign-signature-1']

  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  let event
  try {
    event = JSON.parse(req.body.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  const eventType = event.event
  // DocuSign Connect sends envelopeId at different paths depending on version
  const envelopeId =
    event.data?.envelopeId ||
    event.data?.envelopeSummary?.envelopeId

  if (eventType === 'envelope-sent' && envelopeId) {
    try {
      const { rows: [job] } = await db.query(
        `UPDATE jobs
         SET status = 'complete', completed_at = NOW()
         WHERE docusign_envelope_id = $1
         RETURNING id, user_id, address`,
        [envelopeId]
      )

      if (job) {
        const { rows: [user] } = await db.query(
          'SELECT email FROM users WHERE id = $1',
          [job.user_id]
        )
        if (user?.email) {
          const { sendJobCompletedEmail } = require('../services/email')
          sendJobCompletedEmail(user.email, job.id, job.address).catch(err =>
            console.error('[webhook] completion email failed:', err.message)
          )
        }
      }
    } catch (err) {
      console.error('[webhook] envelope-sent handling failed:', err.message)
      return res.status(500).json({ error: 'Internal error' })
    }
  }

  res.json({ received: true })
})

module.exports = router
