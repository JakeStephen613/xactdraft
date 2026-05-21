'use strict'

require('dotenv').config()

const db = require('./db/client')
const { dequeueJob } = require('./services/queue')
const { runAgent } = require('./services/agent')
const { runWatchdog, cleanupOrphanedVms } = require('./services/vm')
const { checkActiveVms } = require('./middleware/ratelimit')
const { getRedis } = require('./lib/redis')

const POLL_TIMEOUT_S  = 5        // seconds for BLPOP to wait before returning null
const VM_CAP_WAIT_MS  = 30_000  // wait 30s when global VM cap is reached

async function processNext() {
  const jobId = await dequeueJob(POLL_TIMEOUT_S)
  if (!jobId) return  // BLPOP timeout, nothing to do

  // Check DB status — job may have been cancelled while queued
  const { rows: [job] } = await db.query(
    'SELECT status FROM jobs WHERE id = $1',
    [jobId]
  )
  if (!job || job.status !== 'queued') {
    console.log(`[worker] Skipping job ${jobId} (status: ${job?.status ?? 'not found'})`)
    return
  }

  // Check global VM cap before spinning one up
  const { available } = await checkActiveVms()
  if (!available) {
    console.log(`[worker] VM cap reached — re-queuing job ${jobId} and waiting ${VM_CAP_WAIT_MS / 1000}s`)
    await getRedis().rpush('jobs:queue', jobId)
    await new Promise(r => setTimeout(r, VM_CAP_WAIT_MS))
    return
  }

  // runAgent handles everything: VM spin-up, agent loop, DocuSign draft, email, status updates
  runAgent(jobId).catch(err => {
    console.error(`[worker] runAgent failed for job ${jobId}:`, err.message)
  })
}

async function startWorker() {
  console.log('[worker] XactDraft job processor started')

  // Watchdog: tear down stuck VMs every 60 seconds
  setInterval(() => {
    runWatchdog().catch(err => console.error('[worker] watchdog error:', err.message))
  }, 60_000)

  // Orphaned VM cleanup: every 60 minutes
  setInterval(() => {
    cleanupOrphanedVms().catch(err => console.error('[worker] orphan cleanup error:', err.message))
  }, 60 * 60_000)

  while (true) {
    try {
      await processNext()
    } catch (err) {
      console.error('[worker] poll loop error:', err.message)
      await new Promise(r => setTimeout(r, 5_000))
    }
  }
}

startWorker().catch(err => {
  console.error('[worker] fatal startup error:', err)
  process.exit(1)
})
