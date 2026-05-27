import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [mode, setMode]         = useState('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [message, setMessage]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setMessage(null); setLoading(true)

    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })

    setLoading(false)
    if (result.error) { setError(result.error.message); return }
    if (mode === 'signup' && !result.data.session) {
      setMessage('Check your email to confirm your account.')
      return
    }
    navigate('/dashboard')
  }

  return (
    <div style={s.page}>

      {/* Left panel — branding */}
      <div style={s.left}>
        <div style={s.leftInner}>
          <p style={s.leftLogo}>XactDraft</p>
          <p style={s.leftTag}>Automated Xactimate estimates for restoration contractors.</p>
          <div style={s.leftDivider} />
          <ul style={s.leftList}>
            {[
              'Upload photos, PDFs, and field notes',
              'AI agent operates Xactimate on your behalf',
              'Completed estimate delivered as a DocuSign draft',
            ].map(item => (
              <li key={item} style={s.leftListItem}>
                <span style={s.checkmark}>✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right panel — form */}
      <div style={s.right}>
        <div style={s.form}>
          <div style={s.formHeader}>
            <h1 style={s.heading}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h1>
            <p style={s.subheading}>
              {mode === 'signin'
                ? 'Welcome back. Enter your credentials to continue.'
                : 'Get started — it only takes a moment.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} style={s.fields}>
            <div style={s.field}>
              <label style={s.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@company.com"
                className="field-input"
                style={s.input}
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6}
                placeholder={mode === 'signin' ? '••••••••' : 'Min. 6 characters'}
                className="field-input"
                style={s.input}
              />
            </div>

            {error   && <p style={s.errorBox}>{error}</p>}
            {message && <p style={s.successBox}>{message}</p>}

            <button type="submit" disabled={loading} style={s.submit}>
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p style={s.toggle}>
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setError(null) }}
              style={s.toggleBtn}
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>

    </div>
  )
}

const s = {
  page: {
    display: 'flex',
    minHeight: '100vh',
  },
  left: {
    width: '45%',
    background: '#18181b',
    display: 'flex',
    alignItems: 'center',
    padding: '60px 56px',
  },
  leftInner: {
    maxWidth: 340,
  },
  leftLogo: {
    fontSize: 20,
    fontWeight: 600,
    color: '#fff',
    letterSpacing: '-0.02em',
    marginBottom: 16,
  },
  leftTag: {
    fontSize: 15,
    lineHeight: 1.6,
    color: '#a1a1aa',
    marginBottom: 32,
  },
  leftDivider: {
    height: 1,
    background: '#27272a',
    marginBottom: 28,
  },
  leftList: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  leftListItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 1.5,
  },
  checkmark: {
    color: '#4ade80',
    fontWeight: 600,
    flexShrink: 0,
    marginTop: 1,
  },
  right: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 40px',
    background: '#fff',
  },
  form: {
    width: '100%',
    maxWidth: 360,
  },
  formHeader: {
    marginBottom: 28,
  },
  heading: {
    fontSize: 22,
    fontWeight: 600,
    color: '#111827',
    letterSpacing: '-0.02em',
    marginBottom: 6,
  },
  subheading: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 1.5,
  },
  fields: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    padding: '9px 12px',
    fontSize: 14,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    width: '100%',
  },
  errorBox: {
    fontSize: 13,
    color: '#b91c1c',
    padding: '10px 12px',
    background: '#fef2f2',
    borderRadius: 6,
    border: '1px solid #fecaca',
  },
  successBox: {
    fontSize: 13,
    color: '#166534',
    padding: '10px 12px',
    background: '#f0fdf4',
    borderRadius: 6,
    border: '1px solid #bbf7d0',
  },
  submit: {
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    background: '#111827',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    marginTop: 4,
  },
  toggle: {
    marginTop: 20,
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    color: '#111827',
    fontWeight: 500,
    padding: 0,
  },
}
