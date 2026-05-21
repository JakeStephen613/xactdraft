const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'

function getKey() {
  const hex = process.env.XACTIMATE_CRED_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('XACTIMATE_CRED_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

// Returns iv:authTag:ciphertext (all hex), safe to store in DB
function encrypt(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

// Reverses encrypt(); throws if tampered
function decrypt(encoded) {
  const key = getKey()
  const [ivHex, authTagHex, encryptedHex] = encoded.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

module.exports = { encrypt, decrypt }
