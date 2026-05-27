'use strict'

const nodemailer = require('nodemailer')
const db = require('../db/client')

// ── Nodemailer transport (lazy singleton) ─────────────────────────────────────

let _transport = null

function transport() {
  return _transport || (_transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  }))
}

// ── Core send ─────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, bodyText) {
  try {
    await transport().sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject,
      text: bodyText,
    })
    console.log(`[email] sent "${subject}" → ${to}`)
  } catch (err) {
    console.error(`[email] failed to send "${subject}" → ${to}:`, err.message)
    throw err
  }
}

// ── Job-specific email functions ──────────────────────────────────────────────

async function sendJobReadyEmail(to, jobId, address, downloadUrl) {
  await sendEmail(
    to,
    'XactDraft — estimate ready to download',
    `Your estimate for ${address || jobId} is ready.\n\nDownload it here: ${downloadUrl}`
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

module.exports = {
  sendEmail,
  sendJobReadyEmail,
  sendJobFailedEmail
}
