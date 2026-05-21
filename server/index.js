require('dotenv').config()

// ── Startup env validation ────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'DATABASE_URL', 'REDIS_URL',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GCP_PROJECT_ID', 'GCP_BUCKET_NAME', 'GCP_ZONE', 'VM_INSTANCE_TYPE',
  'XACTIMATE_IMAGE_ID', 'XACTIMATE_LICENSE_KEY', 'XACTIMATE_USERNAME', 'XACTIMATE_PASSWORD',
  'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET', 'DOCUSIGN_REDIRECT_URI', 'DOCUSIGN_AUTH_SERVER',
  'NOTIFICATION_EMAIL', 'GOOGLE_APPLICATION_CREDENTIALS'
]

const missing = REQUIRED_ENV.filter(v => !process.env[v])
if (missing.length && process.env.NODE_ENV !== 'test') {
  console.error('[startup] Missing required environment variables:')
  missing.forEach(v => console.error(`  - ${v}`))
  process.exit(1)
}

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
const { getQueueDepth } = require('./services/queue')
const { getRedis } = require('./lib/redis')
const db = require('./db/client')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())

// Webhook routes BEFORE express.json() so express.raw() can read the raw body for HMAC
app.use('/api/webhooks', webhookRoutes)

app.use(express.json())

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const [queueDepth, rawVms, dbConnected] = await Promise.all([
    getQueueDepth().catch(() => -1),
    getRedis().get('system:active_vms').catch(() => null),
    db.query('SELECT 1').then(() => true).catch(() => false)
  ])
  res.json({
    status: 'ok',
    queueDepth,
    activeVMs: parseInt(rawVms || '0', 10),
    dbConnected
  })
})

// Auth routes: individual handlers apply authenticate where needed
// (DocuSign callback is unauthenticated — can't put authenticate globally here)
app.use('/api/auth', authRoutes)

// All other API routes require a valid session + per-user request rate limit
app.use('/api/jobs', authenticate, requestLimiter, jobRoutes)
app.use('/api/files', authenticate, requestLimiter, fileRoutes)

// ── Cron jobs ─────────────────────────────────────────────────────────────────
cron.schedule('0 * * * *', cleanupOrphanedVms)

cron.schedule('*/5 * * * *', () =>
  processDocuSignRetries().catch(err =>
    console.error('[cron] DocuSign retry error:', err.message)
  )
)

// ── One-time GCP setup on startup (idempotent) ────────────────────────────────
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
