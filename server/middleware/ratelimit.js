const { getRedis } = require('../lib/redis')

const REQUEST_LIMIT = 60           // per minute
const JOB_DAILY_LIMIT = 10         // per 24-hour window
const QUEUE_MAX_DEPTH = 50

// ── 1. Request rate limiter ────────────────────────────────────────────────
// Fixed per-minute window; key rolls every 60 seconds.
// Skips silently for unauthenticated requests (req.user not yet set).
async function requestLimiter(req, res, next) {
  if (!req.user) return next()

  const redis = getRedis()
  const window = Math.floor(Date.now() / 60_000)
  const key = `ratelimit:requests:${req.user.id}:${window}`
  const resetAt = (window + 1) * 60 // Unix seconds

  const [count] = (await redis.pipeline().incr(key).expire(key, 120).exec()).map(r => r[1])

  res.set('X-RateLimit-Remaining', Math.max(0, REQUEST_LIMIT - count))
  res.set('X-RateLimit-Reset', resetAt)

  if (count > REQUEST_LIMIT) {
    // Undo the increment so the user isn't permanently locked by a burst
    await redis.decr(key)
    return res.status(429).json({
      error: `Rate limit exceeded: ${REQUEST_LIMIT} requests per minute.`,
      retryAfter: resetAt - Math.floor(Date.now() / 1000)
    })
  }

  next()
}

// ── 2. Job submission limiter ──────────────────────────────────────────────
// Fixed 24-hour window; key rolls at UTC midnight of each day.
async function jobSubmissionLimiter(req, res, next) {
  const redis = getRedis()
  const window = Math.floor(Date.now() / 86_400_000)
  const key = `ratelimit:jobs:${req.user.id}:${window}`
  const resetAt = (window + 1) * 86400

  const [count] = (await redis.pipeline().incr(key).expire(key, 172_800).exec()).map(r => r[1])

  res.set('X-RateLimit-Remaining', Math.max(0, JOB_DAILY_LIMIT - count))
  res.set('X-RateLimit-Reset', resetAt)

  if (count > JOB_DAILY_LIMIT) {
    await redis.decr(key)
    return res.status(429).json({
      error: `Daily job limit reached: ${JOB_DAILY_LIMIT} jobs per 24 hours.`,
      retryAfter: resetAt - Math.floor(Date.now() / 1000)
    })
  }

  next()
}

// ── 3. Concurrency limiter ─────────────────────────────────────────────────
// Checks current in-flight job count against the user's plan limit.
// Does NOT increment — that happens in the job worker when processing starts.
async function concurrencyLimiter(req, res, next) {
  const redis = getRedis()
  const limit = req.user.plan === 'enterprise' ? 10 : 3
  const key = `ratelimit:concurrent:${req.user.id}`
  const count = parseInt(await redis.get(key) || '0', 10)

  if (count >= limit) {
    return res.status(429).json({
      error: `Concurrent job limit reached: ${limit} active jobs allowed on your plan.`,
      retryAfter: 60
    })
  }

  next()
}

// ── Concurrency counter helpers (called by job worker) ────────────────────
async function incrementConcurrent(userId) {
  return getRedis().incr(`ratelimit:concurrent:${userId}`)
}

async function decrementConcurrent(userId) {
  const redis = getRedis()
  const val = await redis.decr(`ratelimit:concurrent:${userId}`)
  if (val < 0) await redis.set(`ratelimit:concurrent:${userId}`, 0)
  return Math.max(0, val)
}

// ── Global VM cap helpers (called by vm.js) ────────────────────────────────
async function checkActiveVms() {
  const limit = parseInt(process.env.MAX_CONCURRENT_VMS || '20', 10)
  const count = parseInt(await getRedis().get('system:active_vms') || '0', 10)
  return { count, limit, available: count < limit }
}

async function incrementActiveVms() {
  return getRedis().incr('system:active_vms')
}

async function decrementActiveVms() {
  const redis = getRedis()
  const val = await redis.decr('system:active_vms')
  if (val < 0) await redis.set('system:active_vms', 0)
  return Math.max(0, val)
}

// ── Queue depth check (called by queue.js before enqueue) ─────────────────
async function checkQueueDepth() {
  const depth = await getRedis().llen('jobs:queue')
  if (depth >= QUEUE_MAX_DEPTH) {
    throw Object.assign(new Error('Job queue is full. Try again shortly.'), {
      status: 429,
      retryAfter: 30
    })
  }
  return depth
}

module.exports = {
  requestLimiter,
  jobSubmissionLimiter,
  concurrencyLimiter,
  incrementConcurrent,
  decrementConcurrent,
  checkActiveVms,
  incrementActiveVms,
  decrementActiveVms,
  checkQueueDepth
}
