const Redis = require('ioredis')

let client = null

function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 3
    })
    client.on('error', (err) => console.error('Redis error:', err))
  }
  return client
}

module.exports = { getRedis }
