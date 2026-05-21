import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    let result
    if (mode === 'signin') {
      result = await supabase.auth.signInWithPassword({ email, password })
    } else {
      result = await supabase.auth.signUp({ email, password })
    }

    setLoading(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    if (mode === 'signup' && !result.data.session) {
      // Supabase sends a confirmation email when email confirmation is enabled
      setMessage('Check your email to confirm your account, then sign in.')
      return
    }

    navigate('/dashboard')
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.logo}>XactDraft</h1>
        <p style={styles.subtitle}>Xactimate estimates, automated.</p>

        <h2 style={styles.heading}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </h2>

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={styles.input}
          />

          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={6}
            style={styles.input}
          />

          {error && <p style={styles.error}>{error}</p>}
          {message && <p style={styles.success}>{message}</p>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p style={styles.toggle}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
            style={styles.link}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    fontFamily: 'system-ui, sans-serif'
  },
  card: {
    background: '#fff',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    width: '100%',
    maxWidth: '400px'
  },
  logo: { margin: '0 0 4px', fontSize: '28px' },
  subtitle: { margin: '0 0 28px', color: '#666', fontSize: '14px' },
  heading: { margin: '0 0 20px', fontSize: '20px' },
  label: { display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '6px' },
  input: {
    display: 'block',
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    marginBottom: '16px',
    boxSizing: 'border-box'
  },
  button: {
    display: 'block',
    width: '100%',
    padding: '11px',
    fontSize: '15px',
    fontWeight: 600,
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    marginTop: '4px'
  },
  error: { color: '#c00', fontSize: '14px', margin: '-8px 0 12px' },
  success: { color: '#007700', fontSize: '14px', margin: '-8px 0 12px' },
  toggle: { marginTop: '20px', fontSize: '14px', textAlign: 'center', color: '#555' },
  link: {
    background: 'none',
    border: 'none',
    color: '#1a1a1a',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '14px',
    padding: 0
  }
}
