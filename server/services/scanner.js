const NodeClam = require('clamscan')
const { Readable } = require('stream')

let _scanner = null

async function getScanner() {
  if (!_scanner) {
    _scanner = await new NodeClam().init({
      removeInfected: false,
      debugMode: false,
      clamscan: { path: '/usr/bin/clamscan', active: true },
      clamdscan: { active: false }
    })
  }
  return _scanner
}

// Returns { clean: boolean, virus: string|null }
// In non-production environments, skips the scan if ClamAV binary is missing.
async function scanBuffer(buffer, filename) {
  try {
    const clam = await getScanner()
    const stream = Readable.from(buffer)
    const { isInfected, viruses } = await clam.scanStream(stream)
    return { clean: !isInfected, virus: viruses?.[0] ?? null }
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      throw Object.assign(new Error(`Malware scan failed for "${filename}"`), { cause: err })
    }
    console.warn(`[scanner] ClamAV unavailable — skipping scan for "${filename}": ${err.message}`)
    return { clean: true, virus: null }
  }
}

module.exports = { scanBuffer }
