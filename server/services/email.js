'use strict'

const { google } = require('googleapis')
const db = require('../db/client')

// ── Gmail client (lazy singleton with domain-wide delegation) ─────────────────

let _gmail = null

function gmail() {
  if (_gmail) return _gmail

  const auth = new google.auth.JWT({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: process.env.NOTIFICATION_EMAIL  // impersonate sender via delegation
  })

  _gmail = google.gmail({ version: 'v1', auth })
  return _gmail
}

// ── MIME builder ──────────────────────────────────────────────────────────────

function buildMime(to, subject, bodyText, attachmentBuffer, attachmentFilename) {
  const from = process.env.NOTIFICATION_EMAIL
  const boundary = `xactdraft_${Date.now()}`

  if (!attachmentBuffer) {
    const raw = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      bodyText
    ].join('\r\n')

    return Buffer.from(raw).toString('base64url')
  }

  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf`,
    `Content-Disposition: attachment; filename="${attachmentFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    attachmentBuffer.toString('base64'),
    '',
    `--${boundary}--`
  ].join('\r\n')

  return Buffer.from(parts).toString('base64url')
}

// ── Core send ─────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, bodyText, attachmentBuffer = null, attachmentFilename = null) {
  const raw = buildMime(to, subject, bodyText, attachmentBuffer, attachmentFilename)

  try {
    await gmail().users.messages.send({
      userId: 'me',
      requestBody: { raw }
    })
    console.log(`[email] sent "${subject}" → ${to}`)
  } catch (err) {
    console.error(`[email] failed to send "${subject}" → ${to}:`, err.message)
    throw err
  }
}

// ── Job-specific email functions ──────────────────────────────────────────────

async function sendJobQueuedEmail(to, jobId, address, waitMinutes) {
  await sendEmail(
    to,
    'XactDraft — your job is queued',
    `Your estimate for ${address} is queued.\nEstimated wait: ${waitMinutes} minutes.`
  )
}

async function sendJobReadyEmail(to, jobId) {
  // Look up envelope draft URL from DB
  const { rows: [job] } = await db.query(
    `SELECT j.address, j.docusign_envelope_id, j.docusign_fallback_pdf_path,
            u.docusign_account_id
     FROM jobs j
     JOIN users u ON u.id = j.user_id
     WHERE j.id = $1`,
    [jobId]
  )

  let reviewUrl = ''
  if (job?.docusign_envelope_id && job?.docusign_account_id) {
    reviewUrl = `${process.env.DOCUSIGN_AUTH_SERVER}/documents/${job.docusign_account_id}/drafts/${job.docusign_envelope_id}`
  }

  const body = reviewUrl
    ? `Your estimate for ${job?.address || jobId} is ready.\nReview and send it here: ${reviewUrl}`
    : `Your estimate for ${job?.address || jobId} is ready. Log in to your dashboard to review it.`

  await sendEmail(to, 'XactDraft — estimate ready to review', body)
}

async function sendJobCompletedEmail(to, jobId, address) {
  await sendEmail(
    to,
    'XactDraft — estimate sent',
    `Your estimate for ${address || jobId} has been sent via DocuSign.`
  )
}

async function sendJobFailedEmail(to, jobId, errorMessage) {
  const { rows: [job] } = await db.query(
    'SELECT address FROM jobs WHERE id = $1',
    [jobId]
  ).catch(() => ({ rows: [] }))

  await sendEmail(
    to,
    'XactDraft — job needs manual review',
    `Your job for ${job?.address || jobId} could not be completed automatically.\n` +
    `Error: ${errorMessage}\n\n` +
    `Your files are preserved and available in your dashboard.`
  )
}

async function sendDocusignFallbackEmail(to, jobId, address, pdfBuffer) {
  await sendEmail(
    to,
    'XactDraft — estimate attached (DocuSign unavailable)',
    `DocuSign was unavailable but your estimate for ${address || jobId} is attached as a PDF.`,
    pdfBuffer,
    'estimate.pdf'
  )
}

module.exports = {
  sendEmail,
  sendJobQueuedEmail,
  sendJobReadyEmail,
  sendJobCompletedEmail,
  sendJobFailedEmail,
  sendDocusignFallbackEmail
}
