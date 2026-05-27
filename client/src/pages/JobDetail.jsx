import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import api from '../lib/api.js'
import StatusBadge from '../components/StatusBadge.jsx'

function DownloadButton({ fileId }) {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const { data } = await api.get(`/files/${fileId}/download`)
      window.open(data.url, '_blank', 'noopener')
    } catch {
      alert('Download failed — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={handleDownload} disabled={loading} style={{
      display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 16px',
      background: '#111827', color: '#fff', border: 'none', borderRadius: 6,
      cursor: loading ? 'default' : 'pointer', fontSize: 13, fontWeight: 500,
      flexShrink: 0, opacity: loading ? 0.7 : 1,
    }}>
      {loading ? 'Getting link…' : 'Download estimate'}
    </button>
  )
}

const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'processing'])

function formatBytes(b) {
  if (b < 1024)      return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}

function fileExt(mimeType) {
  if (!mimeType) return 'file'
  if (mimeType.startsWith('image/')) return 'img'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'txt'
}

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob]           = useState(null)
  const [logs, setLogs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError]       = useState(null)
  const logEndRef = useRef(null)
  const jobRef    = useRef(null)

  const fetchJob = useCallback(async () => {
    try {
      const { data } = await api.get(`/jobs/${id}`)
      setJob(data); jobRef.current = data
    } catch (err) {
      setError(err.response?.status === 404 ? 'Job not found' : (err.response?.data?.error || 'Failed to load job'))
    }
  }, [id])

  const fetchLogs = useCallback(async () => {
    try { const { data } = await api.get(`/jobs/${id}/logs`); setLogs(data) } catch {}
  }, [id])

  useEffect(() => {
    Promise.all([fetchJob(), fetchLogs()]).finally(() => setLoading(false))
    const timer = setInterval(() => {
      if (ACTIVE_STATUSES.has(jobRef.current?.status)) { fetchJob(); fetchLogs() }
    }, 10_000)
    return () => clearInterval(timer)
  }, [fetchJob, fetchLogs])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  async function handleRetry() {
    setRetrying(true)
    try { await api.post(`/jobs/${id}/retry`); await fetchJob() }
    catch (err) { alert(err.response?.data?.error || 'Retry failed') }
    finally { setRetrying(false) }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this job?')) return
    try { await api.delete(`/jobs/${id}`); navigate('/dashboard') }
    catch (err) { alert(err.response?.data?.error || 'Could not cancel job') }
  }

  if (loading) return (
    <div style={s.page}><p style={s.dim}>Loading…</p></div>
  )
  if (error) return (
    <div style={s.page}>
      <Link to="/dashboard" style={s.back}>← Jobs</Link>
      <p style={s.errText}>{error}</p>
    </div>
  )
  if (!job) return null

  const hasEstimate = (job.status === 'review_ready' || job.status === 'complete') && job.estimate_file_id
  const isFailed    = job.status === 'failed'
  const isActive    = ACTIVE_STATUSES.has(job.status)

  return (
    <div style={s.page}>

      <Link to="/dashboard" style={s.back}>← Jobs</Link>

      {/* Page header */}
      <div style={s.pageHeader}>
        <div style={s.titleRow}>
          <h1 style={s.address}>{job.address || '(no address)'}</h1>
          <StatusBadge status={job.status} />
        </div>
        <div style={s.metaRow}>
          <span style={s.metaItem}>Created {formatTime(job.created_at)}</span>
          {job.completed_at && (
            <>
              <span style={s.metaDot} />
              <span style={s.metaItem}>Completed {formatTime(job.completed_at)}</span>
            </>
          )}
        </div>
        {job.description && <p style={s.desc}>{job.description}</p>}
      </div>

      {/* Action panel */}
      {(hasEstimate || isFailed || isActive) && (
        <div style={s.actionPanel}>
          <div style={s.actionPanelInner}>
            {hasEstimate && (
              <div style={s.actionItem}>
                <div>
                  <p style={s.actionTitle}>Estimate ready</p>
                  <p style={s.actionSub}>Download the completed Xactimate estimate PDF.</p>
                </div>
                <DownloadButton fileId={job.estimate_file_id} />
              </div>
            )}
            {isFailed && (
              <div style={s.actionItem}>
                <div>
                  <p style={s.actionTitle}>Job failed</p>
                  <p style={s.actionSub}>Both processing attempts were exhausted.</p>
                </div>
                <button onClick={handleRetry} disabled={retrying} style={s.secondaryBtn}>
                  {retrying ? 'Retrying…' : 'Retry job'}
                </button>
              </div>
            )}
            {isActive && (
              <div style={s.actionItem}>
                <div>
                  <p style={s.actionTitle}>Job in progress</p>
                  <p style={s.actionSub}>Processing will continue in the background.</p>
                </div>
                <button onClick={handleCancel} style={s.cancelBtn}>Cancel job</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error detail */}
      {isFailed && job.error_message && (
        <div style={s.errorCard}>
          <p style={s.errorLabel}>Error detail</p>
          <p style={s.errorText}>{job.error_message}</p>
        </div>
      )}

      {/* Files */}
      {job.files?.length > 0 && (
        <div style={s.panel}>
          <div style={s.panelHeader}>
            <p style={s.panelTitle}>Files</p>
            <span style={s.panelCount}>{job.files.length}</span>
          </div>
          <div style={s.fileList}>
            {job.files.map((f, i) => (
              <div
                key={f.id}
                style={{ ...s.fileRow, borderBottom: i < job.files.length - 1 ? '1px solid #f3f4f6' : 'none' }}
              >
                <span style={s.fileExt}>{fileExt(f.file_type)}</span>
                <span style={s.fileName}>{f.filename}</span>
                <div style={s.fileMeta}>
                  {f.size_bytes ? <span style={s.fileSize}>{formatBytes(f.size_bytes)}</span> : null}
                  <span style={{
                    ...s.scanBadge,
                    color: f.malware_clean === true ? '#15803d' : f.malware_clean === false ? '#b91c1c' : '#9ca3af',
                    background: f.malware_clean === true ? '#f0fdf4' : f.malware_clean === false ? '#fef2f2' : '#f9fafb',
                  }}>
                    {f.malware_clean === true ? 'Clean' : f.malware_clean === false ? 'Flagged' : 'Scanning…'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processing log */}
      <div style={s.panel}>
        <div style={s.panelHeader}>
          <p style={s.panelTitle}>Processing log</p>
          {isActive && (
            <div style={s.liveIndicator}>
              <span className="pulse-dot" style={s.liveDot} />
              <span style={s.liveText}>Live</span>
            </div>
          )}
        </div>
        {logs.length === 0 ? (
          <div style={s.logEmpty}>
            <p style={s.dim}>No activity yet.</p>
          </div>
        ) : (
          <div style={s.logBox}>
            {logs.map((entry, i) => (
              <div key={i} style={s.logRow}>
                <span style={s.logTime}>
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span style={s.logMsg}>{entry.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

    </div>
  )
}

const s = {
  page: {
    padding: '36px 48px',
    maxWidth: 800,
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 13,
    color: '#6b7280',
    textDecoration: 'none',
    marginBottom: 20,
    gap: 4,
  },
  pageHeader: {
    marginBottom: 24,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  address: {
    fontSize: 22,
    fontWeight: 600,
    color: '#111827',
    letterSpacing: '-0.02em',
    margin: 0,
    lineHeight: 1.2,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  metaItem: {
    fontSize: 12,
    color: '#9ca3af',
  },
  metaDot: {
    display: 'inline-block',
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: '#d1d5db',
  },
  desc: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
    lineHeight: 1.5,
  },
  actionPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  actionPanelInner: {
    padding: '18px 22px',
  },
  actionItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#111827',
    marginBottom: 2,
  },
  actionSub: {
    fontSize: 13,
    color: '#6b7280',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 36,
    padding: '0 16px',
    background: '#fff',
    color: '#374151',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    flexShrink: 0,
  },
  cancelBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 36,
    padding: '0 16px',
    background: '#fff',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    flexShrink: 0,
  },
  errorCard: {
    padding: '14px 18px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    marginBottom: 16,
  },
  errorLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#b91c1c',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#991b1b',
    lineHeight: 1.5,
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 20px',
    borderBottom: '1px solid #f3f4f6',
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    flex: 1,
  },
  panelCount: {
    fontSize: 11,
    fontWeight: 600,
    color: '#9ca3af',
    background: '#f3f4f6',
    padding: '1px 7px',
    borderRadius: 99,
  },
  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#f59e0b',
    flexShrink: 0,
  },
  liveText: {
    fontSize: 11,
    fontWeight: 600,
    color: '#b45309',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  fileList: {
    background: '#fff',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 20px',
  },
  fileExt: {
    fontSize: 10,
    fontWeight: 600,
    color: '#6b7280',
    background: '#f3f4f6',
    borderRadius: 4,
    padding: '2px 5px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    flexShrink: 0,
  },
  fileName: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  fileSize: {
    fontSize: 12,
    color: '#9ca3af',
  },
  scanBadge: {
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 7px',
    borderRadius: 99,
  },
  logEmpty: {
    padding: '20px',
  },
  logBox: {
    background: '#0d1117',
    padding: '14px 18px',
    maxHeight: 380,
    overflowY: 'auto',
    fontFamily: "ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace",
  },
  logRow: {
    display: 'flex',
    gap: 14,
    marginBottom: 5,
    fontSize: 12,
    lineHeight: 1.6,
  },
  logTime: {
    color: '#6e7681',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    letterSpacing: '0.02em',
  },
  logMsg: {
    color: '#c9d1d9',
    wordBreak: 'break-word',
  },
  dim:     { fontSize: 14, color: '#9ca3af' },
  errText: { fontSize: 14, color: '#b91c1c' },
}
