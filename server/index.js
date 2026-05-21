require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cron = require('node-cron')

const { authenticate } = require('./middleware/auth')
const { requestLimiter } = require('./middleware/ratelimit')
const authRoutes = require('./routes/auth')
const jobRoutes = require('./routes/jobs')
const fileRoutes = require('./routes/files')
const webhookRoutes = require('./routes/webhooks')
const { cleanupOrphanedVms } = require('./cron/orphanedVmCleanup')
const { ensureLifecyclePolicy } = require('./services/storage')
const { ensureFirewallRule } = require('./services/vm')
const { processDocuSignRetries } = require('./services/docusign')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())

// Webhook routes must be registered BEFORE express.json() so that
// express.raw() in the DocuSign handler can read the raw body for HMAC verification
app.use('/api/webhooks', webhookRoutes)

app.use(express.json())

// Auth routes: individual handlers apply authenticate where needed
// (DocuSign callback is unauthenticated — can't put authenticate globally here)
app.use('/api/auth', authRoutes)

// All other API routes require a valid session + per-user request rate limit
app.use('/api/jobs', authenticate, requestLimiter, jobRoutes)
app.use('/api/files', authenticate, requestLimiter, fileRoutes)

// Hourly orphaned VM cleanup
cron.schedule('0 * * * *', cleanupOrphanedVms)

// Every 5 minutes: process pending DocuSign retries
cron.schedule('*/5 * * * *', () =>
  processDocuSignRetries().catch(err =>
    console.error('[cron] DocuSign retry error:', err.message)
  )
)

// One-time GCP setup on startup (both are idempotent)
ensureLifecyclePolicy().catch(err =>
  console.warn('GCS lifecycle policy check skipped (GCS not configured?):', err.message)
)
ensureFirewallRule().catch(err =>
  console.warn('GCP firewall rule check skipped (GCP not configured?):', err.message)
)

app.listen(PORT, () => {
  console.log(`XactDraft API running on port ${PORT}`)
})

module.exports = app
