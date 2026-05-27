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
  const hasEstimate = job.status === 'review_ready' && job.estimate_file_id

  return (
    <div
      className="card-hover"
      style={{ ...s.card, ...(hasEstimate ? s.cardHighlight : {}) }}
    >
      <div style={s.inner}>
        <div style={s.left}>
          <Link to={`/jobs/${job.id}`} style={s.address}>
            {job.address || '(no address)'}
          </Link>
          <div style={s.meta}>
            <StatusBadge status={job.status} />
            <span style={s.dot} />
            <span style={s.time}>
              {job.status === 'complete' && job.completed_at
                ? timeAgo(job.completed_at)
                : timeAgo(job.created_at)}
            </span>
            {job.file_count > 0 && (
              <>
                <span style={s.dot} />
                <span style={s.files}>{job.file_count} file{job.file_count !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>

        <div style={s.actions}>
          {hasEstimate && (
            <Link to={`/jobs/${job.id}`} style={s.reviewBtn}>
              Download →
            </Link>
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
    marginBottom: 8,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    transition: 'background 0.1s',
  },
  cardHighlight: {
    borderColor: '#bbf7d0',
    boxShadow: '0 1px 3px rgba(34,197,94,0.08)',
  },
  inner: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    justifyContent: 'space-between',
    padding: '14px 18px',
  },
  left: {
    flex: 1,
    minWidth: 0,
  },
  address: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: '#111827',
    textDecoration: 'none',
    marginBottom: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  dot: {
    display: 'inline-block',
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: '#d1d5db',
    flexShrink: 0,
  },
  time:  { fontSize: 12, color: '#9ca3af' },
  files: { fontSize: 12, color: '#9ca3af' },
  actions: {
    display: 'flex',
    gap: 8,
    flexShrink: 0,
  },
  reviewBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 30,
    padding: '0 14px',
    background: '#111827',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 500,
  },
  cancelBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 30,
    padding: '0 12px',
    background: '#fff',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  },
}
