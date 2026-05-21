const { Storage } = require('@google-cloud/storage')

const gcs = new Storage()

function getBucket() {
  return gcs.bucket(process.env.GCP_BUCKET_NAME)
}

async function uploadFile(buffer, gcsKey, mimeType) {
  await getBucket().file(gcsKey).save(buffer, {
    metadata: { contentType: mimeType },
    resumable: false
  })
}

async function getPresignedUrl(gcsKey) {
  const [url] = await getBucket().file(gcsKey).getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000
  })
  return url
}

async function deleteFile(gcsKey) {
  await getBucket().file(gcsKey).delete({ ignoreNotFound: true })
}

async function downloadFile(gcsKey) {
  const [buffer] = await getBucket().file(gcsKey).download()
  return buffer
}

// Ensures 30-day auto-delete lifecycle policy on the bucket.
// Idempotent — safe to call on every startup.
async function ensureLifecyclePolicy() {
  const bucket = getBucket()
  const [meta] = await bucket.getMetadata()
  const already = meta.lifecycle?.rule?.some(
    r => r.action?.type === 'Delete' && r.condition?.age === 30
  )
  if (!already) {
    await bucket.setMetadata({
      lifecycle: { rule: [{ action: { type: 'Delete' }, condition: { age: 30 } }] }
    })
    console.log('GCS: 30-day lifecycle policy applied to bucket')
  }
}

module.exports = { uploadFile, getPresignedUrl, deleteFile, downloadFile, ensureLifecyclePolicy }
