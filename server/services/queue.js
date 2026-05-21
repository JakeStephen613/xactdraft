const { getRedis } = require('../lib/redis')
const { checkQueueDepth } = require('../middleware/ratelimit')

const QUEUE_KEY = 'jobs:queue'

// Push a jobId onto the queue. Throws HTTP 429 if depth >= 50.
async function enqueueJob(jobId) {
  await checkQueueDepth()
  await getRedis().rpush(QUEUE_KEY, jobId)
}

// Blocking pop — waits up to `timeout` seconds for a job.
// Returns jobId string or null on timeout.
async function dequeueJob(timeout = 30) {
  const result = await getRedis().blpop(QUEUE_KEY, timeout)
  return result ? result[1] : null
}

async function getQueueDepth() {
  return getRedis().llen(QUEUE_KEY)
}

module.exports = { enqueueJob, dequeueJob, getQueueDepth }
