'use strict'

const db = require('../db/client')
const redis = require('../lib/redis')

const RETRY_KEY = 'jobs:docusign_retry'
const RETRY_INTERVAL_MS = 10 * 60 * 1000    // 10 minutes
const MAX_RETRY_DURATION_MS = 2 * 60 * 60 * 1000  // 2 hours

function authServer() {
  return process.env.DOCUSIGN_AUTH_SERVER
}

function basicCredentials() {
  return Buffer.from(
    `${process.env.DOCUSIGN_INTEGRATION_KEY}:${process.env.DOCUSIGN_SECRET}`
  ).toString('base64')
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

function getAuthUrl(userId) {
  const params = new URLSearchParams({
    response_type: 'code',
    scope: 'signature',
    client_id: process.env.DOCUSIGN_INTEGRATION_KEY,
    redirect_uri: process.env.DOCUSIGN_REDIRECT_URI,
    state: userId
  })
  return `${authServer()}/oauth/auth?${params}`
}

async function exchangeCode(code, userId) {
  const tokenRes = await fetch(`${authServer()}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DOCUSIGN_REDIRECT_URI
    })
  })

  if (!tokenRes.ok) throw new Error(`DocuSign token exchange failed: ${tokenRes.status}`)

  const tokens = await tokenRes.json()

  const userInfoRes = await fetch(`${authServer()}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  })
  const userInfo = await userInfoRes.json()
  const account = userInfo.accounts.find(a => a.is_default) || userInfo.accounts[0]

  await db.query(
    `UPDATE users
     SET docusign_access_token  = $1,
         docusign_refresh_token = $2,
         docusign_account_id    = $3,
         docusign_base_uri      = $4
     WHERE id = $5`,
    [tokens.access_token, tokens.refresh_token, account.account_id, account.base_uri, userId]
  )

  return account.account_id
}

async function refreshToken(userId) {
  const { rows } = await db.query(
    'SELECT docusign_refresh_token FROM users WHERE id = $1',
    [userId]
  )
  if (!rows[0]?.docusign_refresh_token) {
    throw new Error('No DocuSign refresh token — user must reconnect DocuSign')
  }

  const res = await fetch(`${authServer()}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rows[0].docusign_refresh_token
    })
  })

  if (!res.ok) throw new Error(`DocuSign token refresh failed: ${res.status}`)

  const tokens = await res.json()

  await db.query(
    'UPDATE users SET docusign_access_token = $1, docusign_refresh_token = $2 WHERE id = $3',
    [tokens.access_token, tokens.refresh_token, userId]
  )

  return tokens.access_token
}

async function getAccessToken(userId) {
  const { rows } = await db.query(
    'SELECT docusign_access_token FROM users WHERE id = $1',
    [userId]
  )
  if (!rows[0]?.docusign_access_token) {
    throw new Error('User has not connected DocuSign')
  }

  const probe = await fetch(`${authServer()}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${rows[0].docusign_access_token}` }
  })
  if (probe.status === 401) return refreshToken(userId)

  return rows[0].docusign_access_token
}

// ── Envelope creation ─────────────────────────────────────────────────────────

async function _makeEnvelope(token, accountId, baseUri, pdfBuffer, address, userEmail) {
  const res = await fetch(`${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      emailSubject: `Estimate ready for review — ${address || 'your job'}`,
      status: 'created',  // keeps it as a draft, not sent
      documents: [{
        documentBase64: pdfBuffer.toString('base64'),
        name: 'estimate.pdf',
        fileExtension: 'pdf',
        documentId: '1'
      }],
      recipients: {
        signers: [{
          email: userEmail,
          name: userEmail,
          recipientId: '1',
          routingOrder: '1'
        }]
      }
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DocuSign envelope creation failed: ${res.status} — ${text.slice(0, 300)}`)
  }

  const { envelopeId } = await res.json()
  return envelopeId
}

async function createDocuSignDraft(jobId, pdfBuffer) {
  const { rows: [job] } = await db.query(
    'SELECT id, user_id, address FROM jobs WHERE id = $1',
    [jobId]
  )
  if (!job) throw new Error(`Job ${jobId} not found`)

  const { rows: [user] } = await db.query(
    'SELECT email, docusign_account_id, docusign_base_uri FROM users WHERE id = $1',
    [job.user_id]
  )

  try {
    const token = await getAccessToken(job.user_id)
    const envelopeId = await _makeEnvelope(
      token,
      user.docusign_account_id,
      user.docusign_base_uri,
      pdfBuffer,
      job.address,
      user.email
    )

    await db.query(
      `UPDATE jobs SET docusign_envelope_id = $1, status = 'review_ready' WHERE id = $2`,
      [envelopeId, jobId]
    )

    const draftUrl = `${authServer()}/documents/${user.docusign_account_id}/drafts/${envelopeId}`
    return { envelopeId, draftUrl }

  } catch (err) {
    console.error(`[docusign] createDocuSignDraft failed for job ${jobId}:`, err.message)

    // Save PDF to GCS and queue retries
    try {
      const { uploadFile } = require('./storage')
      const fallbackKey = `jobs/${jobId}/estimate-fallback.pdf`
      await uploadFile(pdfBuffer, fallbackKey, 'application/pdf')
      await db.query(
        'UPDATE jobs SET docusign_fallback_pdf_path = $1 WHERE id = $2',
        [fallbackKey, jobId]
      )
      const member = `${jobId}:${Date.now()}`
      await redis.zadd(RETRY_KEY, Date.now() + RETRY_INTERVAL_MS, member)
    } catch (fallbackErr) {
      console.error(`[docusign] Fallback save failed for job ${jobId}:`, fallbackErr.message)
    }

    throw err
  }
}

// ── Retry processor (called every 5 min by cron in index.js) ─────────────────

async function processDocuSignRetries() {
  const now = Date.now()
  const due = await redis.zrangebyscore(RETRY_KEY, '-inf', now, 'LIMIT', 0, 20)
  if (!due.length) return

  for (const member of due) {
    await redis.zrem(RETRY_KEY, member)

    const colonIdx = member.indexOf(':')
    const jobId = member.slice(0, colonIdx)
    const startedAt = parseInt(member.slice(colonIdx + 1), 10)

    const { rows: [job] } = await db.query(
      'SELECT id, user_id, address, docusign_fallback_pdf_path FROM jobs WHERE id = $1',
      [jobId]
    ).catch(() => ({ rows: [] }))

    if (!job?.docusign_fallback_pdf_path) continue

    // 2-hour retry window exhausted — send PDF via email
    if (now - startedAt > MAX_RETRY_DURATION_MS) {
      try {
        const { downloadFile } = require('./storage')
        const { sendDocusignFallbackEmail } = require('./email')
        const { rows: [user] } = await db.query(
          'SELECT email FROM users WHERE id = $1',
          [job.user_id]
        )
        if (user?.email) {
          const pdfBuffer = await downloadFile(job.docusign_fallback_pdf_path)
          await sendDocusignFallbackEmail(user.email, jobId, job.address, pdfBuffer)
        }
      } catch (e) {
        console.error(`[docusign] Fallback email failed for job ${jobId}:`, e.message)
      }
      continue
    }

    // Still within window — retry envelope creation
    try {
      const { rows: [user] } = await db.query(
        'SELECT email, docusign_account_id, docusign_base_uri FROM users WHERE id = $1',
        [job.user_id]
      )
      const { downloadFile } = require('./storage')
      const pdfBuffer = await downloadFile(job.docusign_fallback_pdf_path)
      const token = await getAccessToken(job.user_id)
      const envelopeId = await _makeEnvelope(
        token,
        user.docusign_account_id,
        user.docusign_base_uri,
        pdfBuffer,
        job.address,
        user.email
      )

      await db.query(
        `UPDATE jobs SET docusign_envelope_id = $1, status = 'review_ready' WHERE id = $2`,
        [envelopeId, jobId]
      )
      console.log(`[docusign] Retry succeeded for job ${jobId}`)

    } catch (err) {
      console.error(`[docusign] Retry failed for job ${jobId}:`, err.message)
      await redis.zadd(RETRY_KEY, now + RETRY_INTERVAL_MS, member)
    }
  }
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  refreshToken,
  getAccessToken,
  createDocuSignDraft,
  processDocuSignRetries
}
