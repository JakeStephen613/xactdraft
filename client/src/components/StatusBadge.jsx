const STATUS = {
  uploading:    { dot: '#9ca3af', color: '#6b7280',  bg: '#f9fafb',  label: 'Uploading' },
  queued:       { dot: '#60a5fa', color: '#1d4ed8',  bg: '#eff6ff',  label: 'Queued' },
  processing:   { dot: '#fbbf24', color: '#92400e',  bg: '#fffbeb',  label: 'Processing', pulse: true },
  review_ready: { dot: '#4ade80', color: '#15803d',  bg: '#f0fdf4',  label: 'Review ready' },
  complete:     { dot: '#22d3ee', color: '#0e7490',  bg: '#ecfeff',  label: 'Complete' },
  failed:       { dot: '#f87171', color: '#991b1b',  bg: '#fef2f2',  label: 'Failed' },
  cancelled:    { dot: '#d1d5db', color: '#9ca3af',  bg: '#f9fafb',  label: 'Cancelled' },
}

export default function StatusBadge({ status }) {
  const cfg = STATUS[status] || { dot: '#d1d5db', color: '#9ca3af', bg: '#f9fafb', label: status }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 8px',
      background: cfg.bg,
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 500,
      color: cfg.color,
      whiteSpace: 'nowrap',
      letterSpacing: '0.01em',
    }}>
      <span
        className={cfg.pulse ? 'pulse-dot' : undefined}
        style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }}
      />
      {cfg.label}
    </span>
  )
}
