import { Link } from 'react-router-dom'
import StatusBadge from './StatusBadge.jsx'

const ACTIVE = new Set(['uploading', 'queued', 'processing'])

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export default function JobCard({ job, onCancel }) {
  const isActive = ACTIVE.has(job.status)

  return (
    <div style={s.card}>
      <div style={s.top}>
        <div style={s.left}>
          <Link to={`/jobs/${job.id}`} style={s.address}>
            {job.address || '(no address)'}
          </Link>
          <div style={s.meta}>
            <StatusBadge status={job.status} />
            <span style={s.time}>
              {job.status === 'complete' && job.completed_at
                ? `Completed ${timeAgo(job.completed_at)}`
                : `Created ${timeAgo(job.created_at)}`}
            </span>
            {job.file_count > 0 && (
              <span style={s.files}>{job.file_count} file{job.file_count !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        <div style={s.actions}>
          {job.status === 'review_ready' && job.docusign_draft_url && (
            <a href={job.docusign_draft_url} target="_blank" rel="noreferrer" style={s.reviewBtn}>
              Review in DocuSign
            </a>
          )}
          {(job.status === 'queued' || job.status === 'processing') && (
            <button onClick={() => onCancel(job.id)} style={s.cancelBtn}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const s = {
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '16px 20px',
    marginBottom: 10
  },
  top: { display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  left: { flex: 1, minWidth: 0 },
  address: {
    display: 'block',
    fontSize: 15,
    fontWeight: 600,
    color: '#111',
    textDecoration: 'none',
    marginBottom: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  meta: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  time: { fontSize: 12, color: '#6b7280' },
  files: { fontSize: 12, color: '#6b7280' },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  reviewBtn: {
    padding: '6px 14px',
    background: '#22c55e',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 600
  },
  cancelBtn: {
    padding: '6px 14px',
    background: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600
  }
}
