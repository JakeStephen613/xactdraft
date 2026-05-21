import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import api from '../lib/api.js'
import StatusBadge from '../components/StatusBadge.jsx'

const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'processing'])

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}

function fileIcon(mimeType) {
  if (!mimeType) return '📄'
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType === 'application/pdf') return '📋'
  return '📄'
}

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob]   = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading]   = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError]       = useState(null)
  const logEndRef = useRef(null)
  const jobRef = useRef(null)

  const fetchJob = useCallback(async () => {
    try {
      const { data } = await api.get(`/jobs/${id}`)
      setJob(data)
      jobRef.current = data
    } catch (err) {
      if (err.response?.status === 404) setError('Job not found')
      else setError(err.response?.data?.error || 'Failed to load job')
    }
  }, [id])

  const fetchLogs = useCallback(async () => {
    try {
      const { data } = await api.get(`/jobs/${id}/logs`)
      setLogs(data)
    } catch {
      // non-fatal
    }
  }, [id])

  useEffect(() => {
    Promise.all([fetchJob(), fetchLogs()]).finally(() => setLoading(false))

    const id_ = setInterval(() => {
      if (ACTIVE_STATUSES.has(jobRef.current?.status)) {
        fetchJob()
        fetchLogs()
      }
    }, 10_000)

    return () => clearInterval(id_)
  }, [fetchJob, fetchLogs])

  // Auto-scroll logs to bottom when new entries arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  async function handleRetry() {
    setRetrying(true)
    try {
      await api.post(`/jobs/${id}/retry`)
      await fetchJob()
    } catch (err) {
      alert(err.response?.data?.error || 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this job?')) return
    try {
      await api.delete(`/jobs/${id}`)
      navigate('/dashboard')
    } catch (err) {
      alert(err.response?.data?.error || 'Could not cancel job')
    }
  }

  if (loading) return <div style={s.page}><p style={s.dim}>Loading…</p></div>
  if (error)   return <div style={s.page}><p style={s.err}>{error}</p><Link to="/dashboard" style={s.back}>← Dashboard</Link></div>
  if (!job)    return null

  const canReview = (job.status === 'review_ready' || job.status === 'complete') && job.docusign_draft_url
  const isFailed  = job.status === 'failed'
  const isActive  = ACTIVE_STATUSES.has(job.status)

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* Back link */}
        <Link to="/dashboard" style={s.back}>← Dashboard</Link>

        {/* Job header */}
        <div style={s.card}>
          <div style={s.headerRow}>
            <div>
              <h1 style={s.address}>{job.address || '(no address)'}</h1>
              {job.description && <p style={s.desc}>{job.description}</p>}
            </div>
            <StatusBadge status={job.status} />
          </div>

          <div style={s.meta}>
            <span style={s.metaItem}>Created: {formatTime(job.created_at)}</span>
            {job.completed_at && (
              <span style={s.metaItem}>Completed: {formatTime(job.completed_at)}</span>
            )}
          </div>

          {/* Primary action */}
          {canReview && (
            <a href={job.docusign_draft_url} target="_blank" rel="noreferrer" style={s.reviewBtn}>
              Review in DocuSign →
            </a>
          )}

          {isFailed && (
            <div style={s.failedBox}>
              <p style={s.failedMsg}>{job.error_message || 'Processing failed.'}</p>
              <button onClick={handleRetry} disabled={retrying} style={s.retryBtn}>
                {retrying ? 'Retrying…' : 'Retry this job'}
              </button>
            </div>
          )}

          {isActive && (
            <button onClick={handleCancel} style={s.cancelBtn}>Cancel job</button>
          )}
        </div>

        {/* Files */}
        {job.files?.length > 0 && (
          <div style={s.card}>
            <h2 style={s.sectionTitle}>Files ({job.files.length})</h2>
            <ul style={s.fileList}>
              {job.files.map(f => (
                <li key={f.id} style={s.fileRow}>
                  <span style={s.fileIcon}>{fileIcon(f.file_type)}</span>
                  <span style={s.fileName}>{f.filename}</span>
                  <span style={s.fileSize}>{f.size_bytes ? formatBytes(f.size_bytes) : ''}</span>
                  <span style={{ ...s.scanBadge, color: f.malware_clean ? '#16a34a' : '#dc2626' }}>
                    {f.malware_clean === true ? 'Clean' : f.malware_clean === false ? 'Flagged' : 'Pending'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Processing log */}
        <div style={s.card}>
          <h2 style={s.sectionTitle}>Processing Log</h2>
          {logs.length === 0 ? (
            <p style={s.dim}>No log entries yet.</p>
          ) : (
            <div style={s.logBox}>
              {logs.map((entry, i) => (
                <div key={i} style={s.logRow}>
                  <span style={s.logTime}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span style={s.logMsg}>{entry.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

const s = {
  page: { minHeight: '100vh', background: '#f3f4f6', padding: '32px 16px', fontFamily: 'system-ui, sans-serif' },
  container: { maxWidth: 720, margin: '0 auto' },
  back: { display: 'inline-block', color: '#6b7280', textDecoration: 'none', fontSize: 14, marginBottom: 20 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '24px', marginBottom: 16 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 },
  address: { margin: 0, fontSize: 22, fontWeight: 700 },
  desc: { margin: '6px 0 0', fontSize: 14, color: '#6b7280' },
  meta: { display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16 },
  metaItem: { fontSize: 13, color: '#6b7280' },
  reviewBtn: {
    display: 'inline-block',
    padding: '10px 20px',
    background: '#22c55e',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 15
  },
  failedBox: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 16 },
  failedMsg: { margin: '0 0 12px', fontSize: 14, color: '#b91c1c' },
  retryBtn: {
    padding: '8px 18px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14
  },
  cancelBtn: {
    marginTop: 12,
    padding: '8px 18px',
    background: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600
  },
  sectionTitle: { margin: '0 0 14px', fontSize: 16, fontWeight: 600 },
  fileList: { listStyle: 'none', margin: 0, padding: 0 },
  fileRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' },
  fileIcon: { fontSize: 18, flexShrink: 0 },
  fileName: { flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileSize: { fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' },
  scanBadge: { fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  logBox: { background: '#0f172a', borderRadius: 6, padding: '16px', maxHeight: 360, overflowY: 'auto' },
  logRow: { display: 'flex', gap: 12, marginBottom: 8, fontSize: 13, lineHeight: 1.5 },
  logTime: { color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 },
  logMsg: { color: '#e2e8f0', wordBreak: 'break-word' },
  dim: { color: '#9ca3af', fontSize: 14, margin: 0 },
  err: { color: '#dc2626', fontSize: 14 }
}
