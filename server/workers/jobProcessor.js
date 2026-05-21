// Job queue worker — run as a separate Render background service
// Loop:
//   1. dequeueJob() — blocking pop from Upstash queue
//   2. Set job status → processing
//   3. spinUpVm(jobId, xactimateCreds)
//   4. runAgentLoop(jobId, vmIp)
//   5. On success: createDraftEnvelope, set status → review_ready, email user
//   6. On failure: if retry_count < 1, retry on fresh VM; else set status → failed, email user
