import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api.js'
import JobCard from '../components/JobCard.jsx'

const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'processing'])

function StatBlock({ value, label, sub, accent }) {
  return (
    <div style={{ ...st.statBlock, ...(accent ? st.statBlockAccent : {}) }}>
      <p style={{ ...st.statValue, ...(accent ? { color: '#111827' } : {}) }}>{value}</p>
      <p style={st.statLabel}>{label}</p>
      {sub && <p style={st.statSub}>{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const [jobs, setJobs]       = useState([])
  const [usage, setUsage]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
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

  useEffect(() => {
    fetchJobs().finally(() => setLoading(false))
    const id = setInterval(() => {
      if (jobsRef.current.some(j => ACTIVE_STATUSES.has(j.status))) fetchJobs()
    }, 10_000)
    return () => clearInterval(id)
  }, [fetchJobs])

  async function handleCancel(jobId) {
    if (!window.confirm('Cancel this job?')) return
    try {
      await api.delete(`/jobs/${jobId}`)
      fetchJobs()
    } catch (err) {
      alert(err.response?.data?.error || 'Could not cancel job')
    }
  }

  const reviewReady = jobs.filter(j => j.status === 'review_ready').length
  const completed   = jobs.filter(j => j.status === 'complete').length
  const active      = jobs.filter(j => ACTIVE_STATUSES.has(j.status)).length

  return (
    <div style={st.page}>

      {/* Page header */}
      <div style={st.pageHeader}>
        <div>
          <h1 style={st.pageTitle}>Jobs</h1>
          <p style={st.pageDesc}>Manage and track your Xactimate estimate jobs.</p>
        </div>
        <Link to="/upload" style={st.newBtn}>+ New job</Link>
      </div>

      {/* Estimates ready banner */}
      {reviewReady > 0 && (
        <div style={st.reviewBanner}>
          <span style={st.reviewDot} />
          <p style={st.reviewText}>
            {reviewReady} estimate{reviewReady !== 1 ? 's' : ''} ready to download
          </p>
        </div>
      )}

      {/* Stat blocks */}
      {!loading && (
        <div style={st.stats}>
          <StatBlock
            value={usage ? usage.jobsToday : '—'}
            label="Jobs today"
            sub={usage ? `of ${usage.jobsLimit} allowed` : null}
          />
          <StatBlock
            value={active || '0'}
            label="Active now"
            sub={usage ? `of ${usage.concurrentLimit} slots` : null}
            accent={active > 0}
          />
          <StatBlock
            value={reviewReady || '0'}
            label="Awaiting review"
            sub={reviewReady > 0 ? 'Action needed' : 'None pending'}
            accent={reviewReady > 0}
          />
          <StatBlock
            value={completed}
            label="Completed"
            sub="all time"
          />
        </div>
      )}

      {/* Job list */}
      <div style={st.section}>
        <div style={st.sectionHeader}>
          <p style={st.sectionTitle}>All jobs</p>
          {jobs.length > 0 && <p style={st.sectionCount}>{jobs.length}</p>}
        </div>

        {loading && <p style={st.dim}>Loading…</p>}
        {error   && <p style={st.errText}>{error}</p>}

        {!loading && !error && jobs.length === 0 && (
          <div style={st.empty}>
            <p style={st.emptyHeading}>No jobs yet</p>
            <p style={st.emptyText}>Upload job files to generate your first estimate.</p>
            <Link to="/upload" style={st.emptyBtn}>Create your first job</Link>
          </div>
        )}

        <div>
          {jobs.map(job => (
            <JobCard key={job.id} job={job} onCancel={handleCancel} />
          ))}
        </div>
      </div>

    </div>
  )
}

const st = {
  page: {
    padding: '36px 48px',
    maxWidth: 900,
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 28,
    gap: 16,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 600,
    color: '#111827',
    letterSpacing: '-0.02em',
    marginBottom: 3,
  },
  pageDesc: {
    fontSize: 14,
    color: '#6b7280',
  },
  newBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 36,
    padding: '0 16px',
    background: '#111827',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
    flexShrink: 0,
    letterSpacing: '0.01em',
  },
  reviewBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    marginBottom: 20,
  },
  reviewDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
    flexShrink: 0,
  },
  reviewText: {
    fontSize: 13,
    color: '#15803d',
    fontWeight: 500,
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 32,
  },
  statBlock: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '18px 20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  statBlockAccent: {
    borderColor: '#d1d5db',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  statValue: {
    fontSize: 26,
    fontWeight: 600,
    color: '#374151',
    letterSpacing: '-0.03em',
    lineHeight: 1,
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
    marginBottom: 2,
  },
  statSub: {
    fontSize: 12,
    color: '#9ca3af',
  },
  section: {},
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: 600,
    color: '#9ca3af',
    background: '#f3f4f6',
    padding: '1px 7px',
    borderRadius: 99,
  },
  dim:     { fontSize: 14, color: '#9ca3af' },
  errText: { fontSize: 14, color: '#b91c1c' },
  empty: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '60px 40px',
    textAlign: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  emptyHeading: {
    fontSize: 15,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 20,
  },
  emptyBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 36,
    padding: '0 18px',
    background: '#111827',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
  },
}
