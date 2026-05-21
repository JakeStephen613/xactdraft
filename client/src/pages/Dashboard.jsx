import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api.js'
import JobCard from '../components/JobCard.jsx'

const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'processing'])

function UsageMeter({ label, value, limit, color }) {
  const pct = Math.min(100, Math.round((value / limit) * 100))
  return (
    <div style={s.meterBox}>
      <div style={s.meterLabel}>{label}</div>
      <div style={s.meterBar}>
        <div style={{ ...s.meterFill, width: `${pct}%`, background: color }} />
      </div>
      <div style={s.meterCount}>{value} / {limit}</div>
    </div>
  )
}

export default function Dashboard() {
  const [jobs, setJobs]   = useState([])
  const [usage, setUsage] = useState(null)
  const [user, setUser]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const jobsRef = useRef([])

  const fetchJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/jobs')
      setJobs(data.jobs)
      setUsage(data.usage)
      jobsRef.current = data.jobs
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load jobs')
    }
  }, [])

  // Fetch user profile (for DocuSign connection status)
  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {})
  }, [])

  // Initial load + polling: poll every 10s only when active jobs exist
  useEffect(() => {
    fetchJobs().finally(() => setLoading(false))

    const id = setInterval(() => {
      if (jobsRef.current.some(j => ACTIVE_STATUSES.has(j.status))) {
        fetchJobs()
      }
    }, 10_000)

    return () => clearInterval(id)
  }, [fetchJobs])

  async function handleConnectDocuSign() {
    try {
      const { data } = await api.get('/auth/docusign/connect')
      window.location.href = data.url
    } catch {
      alert('Could not start DocuSign connection. Please try again.')
    }
  }

  async function handleCancel(jobId) {
    if (!window.confirm('Cancel this job?')) return
    try {
      await api.delete(`/jobs/${jobId}`)
      fetchJobs()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not cancel job')
    }
  }

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* Header */}
        <div style={s.header}>
          <h1 style={s.title}>Dashboard</h1>
          <Link to="/upload" style={s.newBtn}>+ New Job</Link>
        </div>

        {/* Usage meters */}
        {usage && (
          <div style={s.usageCard}>
            <UsageMeter
              label="Jobs today"
              value={usage.jobsToday}
              limit={usage.jobsLimit}
              color={usage.jobsToday >= usage.jobsLimit ? '#ef4444' : '#3b82f6'}
            />
            <UsageMeter
              label="Active slots"
              value={usage.concurrentActive}
              limit={usage.concurrentLimit}
              color={usage.concurrentActive >= usage.concurrentLimit ? '#ef4444' : '#f59e0b'}
            />

            {user && !user.has_docusign && (
              <button onClick={handleConnectDocuSign} style={s.docusignBtn}>
                Connect DocuSign
              </button>
            )}
          </div>
        )}

        {/* Job list */}
        {loading && <p style={s.dim}>Loading…</p>}
        {error && <p style={s.errText}>{error}</p>}

        {!loading && !error && jobs.length === 0 && (
          <div style={s.empty}>
            <p style={s.emptyText}>No jobs yet.</p>
            <Link to="/upload" style={s.newBtn}>Submit your first job</Link>
          </div>
        )}

        {jobs.map(job => (
          <JobCard key={job.id} job={job} onCancel={handleCancel} />
        ))}
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '32px 16px',
    fontFamily: 'system-ui, sans-serif'
  },
  container: { maxWidth: 720, margin: '0 auto' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24
  },
  title: { margin: 0, fontSize: 24 },
  newBtn: {
    padding: '8px 18px',
    background: '#111',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600
  },
  usageCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '20px 24px',
    marginBottom: 24,
    display: 'flex',
    gap: 32,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  meterBox: { flex: 1, minWidth: 140 },
  meterLabel: { fontSize: 12, color: '#6b7280', marginBottom: 6, fontWeight: 600 },
  meterBar: { height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  meterFill: { height: '100%', borderRadius: 3, transition: 'width .3s' },
  meterCount: { fontSize: 13, color: '#374151', fontWeight: 600 },
  docusignBtn: {
    padding: '8px 16px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },
  dim: { color: '#9ca3af', fontSize: 14 },
  errText: { color: '#dc2626', fontSize: 14 },
  empty: { textAlign: 'center', padding: '60px 0' },
  emptyText: { color: '#6b7280', marginBottom: 16 }
}
