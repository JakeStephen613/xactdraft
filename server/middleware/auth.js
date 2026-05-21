const { createClient } = require('@supabase/supabase-js')
const db = require('../db/client')

let supabase

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  }
  return supabase
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }

  const token = header.slice(7)
  const { data: { user }, error } = await getSupabase().auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Fetch plan so rate limiters and concurrency checks have it available
  const { rows } = await db.query('SELECT plan FROM users WHERE id = $1', [user.id])

  req.user = {
    id: user.id,
    email: user.email,
    plan: rows[0]?.plan || 'basic'
  }

  next()
}

module.exports = { authenticate }
