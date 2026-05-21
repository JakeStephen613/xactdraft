const STATUS = {
  uploading:    { bg: '#6b7280', label: 'Uploading' },
  queued:       { bg: '#3b82f6', label: 'Queued' },
  processing:   { bg: '#f59e0b', label: 'Processing' },
  review_ready: { bg: '#22c55e', label: 'Review Ready' },
  complete:     { bg: '#14b8a6', label: 'Complete' },
  failed:       { bg: '#ef4444', label: 'Failed' },
  cancelled:    { bg: '#9ca3af', label: 'Cancelled' }
}

export default function StatusBadge({ status }) {
  const { bg, label } = STATUS[status] || { bg: '#9ca3af', label: status }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      color: '#fff',
      background: bg,
      whiteSpace: 'nowrap'
    }}>
      {label}
    </span>
  )
}
