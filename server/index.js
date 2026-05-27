require('dotenv').config()

// ── Startup env validation ────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'DATABASE_URL', 'REDIS_URL',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GCP_PROJECT_ID', 'GCP_BUCKET_NAME', 'GCP_ZONE', 'VM_INSTANCE_TYPE',
  'XACTIMATE_IMAGE_ID', 'XACTIMATE_LICENSE_KEY', 'XACTIMATE_USERNAME', 'XACTIMATE_PASSWORD',
  'GMAIL_USER', 'GMAIL_APP_PASSWORD'
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
const { cleanupOrphanedVms } = require('./cron/orphanedVmCleanup')
const { ensureLifecyclePolicy } = require('./services/storage')
const { ensureFirewallRule } = require('./services/vm')
const { getQueueDepth } = require('./services/queue')
const { getRedis } = require('./lib/redis')
const db = require('./db/client')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
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

app.use('/api/auth', authRoutes)

// All other API routes require a valid session + per-user request rate limit
app.use('/api/jobs', authenticate, requestLimiter, jobRoutes)
app.use('/api/files', authenticate, requestLimiter, fileRoutes)

// ── Cron jobs ─────────────────────────────────────────────────────────────────
cron.schedule('0 * * * *', cleanupOrphanedVms)

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
