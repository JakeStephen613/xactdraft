'use strict'

const path = require('path')
const fs = require('fs')
const {
  InstancesClient,
  ZoneOperationsClient,
  FirewallsClient,
  GlobalOperationsClient
} = require('@google-cloud/compute')

const db = require('../db/client')
const { checkActiveVms, incrementActiveVms, decrementActiveVms } = require('../middleware/ratelimit')

// ── Constants ─────────────────────────────────────────────────────────────────
const VM_PREFIX    = 'xactdraft-job-'
const AGENT_PORT   = '8765'          // Python FastAPI agent (see vm-agent/agent.py)
const FIREWALL_RULE = 'xactdraft-vm-agent'

// ── Lazy GCP client singletons ────────────────────────────────────────────────
// Not instantiated at module load so the server starts cleanly without GCP creds.
let _instances, _zoneOps, _firewalls, _globalOps
const instances  = () => _instances  || (_instances  = new InstancesClient())
const zoneOps    = () => _zoneOps    || (_zoneOps    = new ZoneOperationsClient())
const firewalls  = () => _firewalls  || (_firewalls  = new FirewallsClient())
const globalOps  = () => _globalOps  || (_globalOps  = new GlobalOperationsClient())

const project = () => process.env.GCP_PROJECT_ID
const zone    = () => process.env.GCP_ZONE
const vmName  = jobId => `${VM_PREFIX}${jobId}`

// ── Operation wait helpers ────────────────────────────────────────────────────
async function waitZone(operationName) {
  let op
  do {
    ;[op] = await zoneOps().wait({ operation: operationName, project: project(), zone: zone() })
  } while (op.status !== 'DONE')
  if (op.error?.errors?.length) {
    throw new Error(op.error.errors.map(e => e.message).join('; '))
  }
}

async function waitGlobal(operationName) {
  let op
  do {
    ;[op] = await globalOps().wait({ operation: operationName, project: project() })
  } while (op.status !== 'DONE')
  if (op.error?.errors?.length) {
    throw new Error(op.error.errors.map(e => e.message).join('; '))
  }
}

// ── Firewall rule ─────────────────────────────────────────────────────────────
// Idempotent — call once at startup. Restricts port 8765 to GCP internal ranges only.
async function ensureFirewallRule() {
  try {
    await firewalls().get({ project: project(), firewall: FIREWALL_RULE })
    return // already exists
  } catch (err) {
    if (err.code !== 404) throw err
  }

  const [res] = await firewalls().insert({
    project: project(),
    firewallResource: {
      name: FIREWALL_RULE,
      network: `projects/${project()}/global/networks/default`,
      direction: 'INGRESS',
      allowed: [{ IPProtocol: 'tcp', ports: [AGENT_PORT] }],
      targetTags: ['xactdraft-vm'],
      sourceRanges: ['10.128.0.0/9']  // GCP internal — no public internet access
    }
  })

  await waitGlobal(res.latestResponse.name)
  console.log(`[vm] Firewall rule '${FIREWALL_RULE}' created (TCP ${AGENT_PORT}, internal only)`)
}

// ── spinUpVm ──────────────────────────────────────────────────────────────────
// Creates a Windows VM, waits for RUNNING, saves name+IP to the jobs row.
// Credentials come from env vars per Prompt 5 (single shared Xactimate license).
async function spinUpVm(jobId) {
  const { available, count, limit } = await checkActiveVms()
  if (!available) {
    throw Object.assign(new Error(`VM cap reached (${count}/${limit} active VMs)`), { code: 'VM_CAP_EXCEEDED' })
  }

  const name = vmName(jobId)
  const startupScript = fs.readFileSync(
    path.join(__dirname, '../../vm-agent/startup.ps1'),
    'utf8'
  )

  await incrementActiveVms()

  try {
    const [res] = await instances().insert({
      project: project(),
      zone: zone(),
      instanceResource: {
        name,
        machineType: `zones/${zone()}/machineTypes/${process.env.VM_INSTANCE_TYPE || 'n1-standard-2'}`,
        disks: [{
          boot: true,
          autoDelete: true,
          initializeParams: { sourceImage: process.env.XACTIMATE_IMAGE_ID }
        }],
        networkInterfaces: [{
          network: `projects/${project()}/global/networks/default`
          // No accessConfigs = no external IP assigned
        }],
        tags: { items: ['xactdraft-vm'] },
        metadata: {
          items: [
            { key: 'XACTIMATE_LICENSE_KEY',     value: process.env.XACTIMATE_LICENSE_KEY || '' },
            { key: 'XACTIMATE_USERNAME',         value: process.env.XACTIMATE_USERNAME    || '' },
            { key: 'XACTIMATE_PASSWORD',         value: process.env.XACTIMATE_PASSWORD    || '' },
            { key: 'agent-bucket',               value: process.env.GCP_BUCKET_NAME       || '' },
            { key: 'windows-startup-script-ps1', value: startupScript }
          ]
        }
      }
    })

    await waitZone(res.latestResponse.name)

    const [instance] = await instances().get({ project: project(), zone: zone(), instance: name })
    const vmIp = instance.networkInterfaces?.[0]?.networkIP
    if (!vmIp) throw new Error('VM reached RUNNING but has no internal IP')

    await db.query(
      'UPDATE jobs SET vm_instance_name = $1, vm_ip = $2 WHERE id = $3',
      [name, vmIp, jobId]
    )

    console.log(`[vm] Started ${name} — internal IP: ${vmIp}`)
    return vmIp

  } catch (err) {
    await decrementActiveVms()
    throw err
  }
}

// ── tearDownVm ────────────────────────────────────────────────────────────────
// Stops then deletes the VM, decrements the global counter.
async function tearDownVm(jobId) {
  const { rows: [job] } = await db.query(
    'SELECT vm_instance_name FROM jobs WHERE id = $1',
    [jobId]
  )

  if (!job?.vm_instance_name) {
    console.warn(`[vm] tearDown: no VM on record for job ${jobId}`)
    return
  }

  const name = job.vm_instance_name

  try {
    const [stopRes] = await instances().stop({ project: project(), zone: zone(), instance: name })
    await waitZone(stopRes.latestResponse.name)

    const [delRes] = await instances().delete({ project: project(), zone: zone(), instance: name })
    await waitZone(delRes.latestResponse.name)

  } catch (err) {
    if (err.code === 404) {
      console.warn(`[vm] tearDown: ${name} already gone`)
    } else {
      throw err
    }
  }

  await decrementActiveVms()
  await db.query(
    'UPDATE jobs SET vm_instance_name = NULL, vm_ip = NULL WHERE id = $1',
    [jobId]
  )

  console.log(`[vm] Torn down ${name}`)
}

// ── Watchdog ──────────────────────────────────────────────────────────────────
// Call on a 1-minute interval from the job worker.
// Uses updated_at (last status-change time) rather than created_at
// so jobs that waited in queue before processing aren't falsely timed out.
async function runWatchdog() {
  try {
    const { rows } = await db.query(
      `SELECT id, user_id FROM jobs
       WHERE status = 'processing'
         AND updated_at < now() - interval '20 minutes'`
    )

    for (const job of rows) {
      console.warn(`[watchdog] Job ${job.id} stalled — tearing down`)

      await tearDownVm(job.id).catch(e =>
        console.error('[watchdog] tearDown error:', e.message)
      )

      await db.query(
        `UPDATE jobs
         SET status = 'failed',
             error_message = 'Agent timed out after 20 minutes'
         WHERE id = $1`,
        [job.id]
      )

      // Lazy-require email to avoid circular deps; email service built in a later step.
      try {
        const { sendJobFailedEmail } = require('./email')
        const { rows: [user] } = await db.query(
          'SELECT email FROM users WHERE id = $1', [job.user_id]
        )
        if (user?.email) {
          await sendJobFailedEmail(user.email, job.id, 'Agent timed out after 20 minutes')
        }
      } catch (e) {
        console.error('[watchdog] email send failed:', e.message)
      }
    }
  } catch (err) {
    console.error('[watchdog] error:', err.message)
  }
}

// ── Orphan cleanup ────────────────────────────────────────────────────────────
// Call on a 1-hour interval from the cron job.
async function cleanupOrphanedVms() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

    for await (const instance of instances().listAsync({
      project: project(),
      zone: zone(),
      filter: `name:${VM_PREFIX}`
    })) {
      if (!instance.name?.startsWith(VM_PREFIX)) continue
      if (new Date(instance.creationTimestamp) > twoHoursAgo) continue

      const jobId = instance.name.slice(VM_PREFIX.length)

      const { rows } = await db.query(
        `SELECT id FROM jobs
         WHERE id = $1 AND status IN ('processing','queued','uploading')`,
        [jobId]
      )
      if (rows.length) continue  // active job — leave the VM alone

      try {
        const [res] = await instances().delete({
          project: project(),
          zone: zone(),
          instance: instance.name
        })
        await waitZone(res.latestResponse.name)
        await decrementActiveVms()
        console.log(`[cleanup] Deleted orphaned VM: ${instance.name}`)
      } catch (e) {
        if (e.code !== 404) console.error(`[cleanup] Could not delete ${instance.name}:`, e.message)
      }
    }
  } catch (err) {
    console.error('[cleanup] orphan scan error:', err.message)
  }
}

module.exports = { spinUpVm, tearDownVm, runWatchdog, cleanupOrphanedVms, ensureFirewallRule }
