import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api.js'

const MAX_FILE_SIZE  = 20 * 1024 * 1024
const MAX_TOTAL_SIZE = 100 * 1024 * 1024
const MAX_FILES      = 10
const ALLOWED_TYPES  = new Set(['image/jpeg', 'image/png', 'application/pdf', 'text/plain'])

function formatBytes(b) {
  if (b < 1024)      return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}

function validateFile(file) {
  if (!ALLOWED_TYPES.has(file.type)) return 'Unsupported type — allowed: jpg, png, pdf, txt'
  if (file.size > MAX_FILE_SIZE)     return `Over 20 MB limit (${formatBytes(file.size)})`
  return null
}

export default function Upload() {
  const [address, setAddress]         = useState('')
  const [notes, setNotes]             = useState('')
  const [files, setFiles]             = useState([])
  const [dragging, setDragging]       = useState(false)
  const [progress, setProgress]       = useState(0)
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  function addFiles(incoming) {
    const list = Array.from(incoming)
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.file.name))
      const next = list
        .filter(f => !existingNames.has(f.name))
        .map(file => ({ file, error: validateFile(file) }))
      return [...prev, ...next].slice(0, MAX_FILES)
    })
  }

  const onDrop      = useCallback(e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }, [])
  const onDragOver  = useCallback(e => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])

  const validFiles   = files.filter(f => !f.error)
  const totalSize    = validFiles.reduce((sum, f) => sum + f.file.size, 0)
  const totalSizeErr = totalSize > MAX_TOTAL_SIZE ? `Total ${formatBytes(totalSize)} exceeds 100 MB limit` : null
  const canSubmit    = address.trim() && validFiles.length > 0 && !totalSizeErr && !submitting

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitError(null); setSubmitting(true); setProgress(0)

    try {
      const { data: { jobId } } = await api.post('/jobs', {
        address:     address.trim(),
        description: notes.trim() || undefined,
      })
      const formData = new FormData()
      validFiles.forEach(({ file }) => formData.append('files', file))
      await api.post(`/jobs/${jobId}/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => { if (e.total) setProgress(Math.round((e.loaded / e.total) * 100)) },
      })
      navigate('/dashboard')
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Upload failed — please try again.')
      setSubmitting(false); setProgress(0)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.container}>

        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>New job</h1>
          <p style={s.pageDesc}>Upload job files to generate an Xactimate estimate.</p>
        </div>

        <div style={s.panel}>
          <form onSubmit={handleSubmit} style={s.form}>

            <div style={s.formSection}>
              <p style={s.sectionLabel}>Job details</p>
              <div style={s.fields}>
                <div style={s.field}>
                  <label style={s.label}>
                    Address <span style={s.req}>*</span>
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Main St, Springfield, IL"
                    required
                    disabled={submitting}
                    className="field-input"
                    style={s.input}
                  />
                </div>
                <div style={s.field}>
                  <label style={s.label}>
                    Field notes <span style={s.opt}>optional</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Describe damage, scope of work, or relevant details…"
                    rows={3}
                    disabled={submitting}
                    className="field-input"
                    style={{ ...s.input, resize: 'vertical' }}
                  />
                </div>
              </div>
            </div>

            <div style={s.divider} />

            <div style={s.formSection}>
              <p style={s.sectionLabel}>Files <span style={s.sectionLabelSub}>— jpg, png, pdf, txt · max {MAX_FILES}</span></p>

              <div
                style={{ ...s.dropzone, ...(dragging ? s.dropzoneActive : {}) }}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => !submitting && inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf,.txt"
                  style={{ display: 'none' }}
                  onChange={e => { addFiles(e.target.files); e.target.value = '' }}
                />
                <div style={s.dropIcon}>↑</div>
                <p style={s.dropMain}>{dragging ? 'Drop files here' : 'Drag files here, or click to browse'}</p>
                <p style={s.dropSub}>20 MB per file · 100 MB total</p>
              </div>

              {files.length > 0 && (
                <div style={s.fileList}>
                  {files.map(({ file, error: fileError }, i) => (
                    <div
                      key={i}
                      style={{
                        ...s.fileRow,
                        borderBottom: i < files.length - 1 ? '1px solid #f3f4f6' : 'none',
                        background: fileError ? '#fef9f9' : '#fff',
                      }}
                    >
                      <div style={s.fileInfo}>
                        <span style={s.fileName}>{file.name}</span>
                        <span style={s.fileSize}>{formatBytes(file.size)}</span>
                      </div>
                      {fileError
                        ? <span style={s.fileError}>{fileError}</span>
                        : submitting
                          ? <div style={s.progressTrack}><div style={{ ...s.progressFill, width: `${progress}%` }} /></div>
                          : null
                      }
                      {!submitting && (
                        <button
                          type="button"
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          style={s.removeBtn}
                          aria-label={`Remove ${file.name}`}
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {totalSizeErr && <p style={s.errorMsg}>{totalSizeErr}</p>}
            {submitError  && <p style={s.errorMsg}>{submitError}</p>}

            <div style={s.formFooter}>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{ ...s.submit, opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'default' }}
              >
                {submitting ? `Uploading… ${progress}%` : 'Submit job'}
              </button>
              {!submitting && (
                <p style={s.footerNote}>
                  Files are scanned for malware before processing begins.
                </p>
              )}
            </div>

          </form>
        </div>

      </div>
    </div>
  )
}

const s = {
  page: {
    padding: '36px 48px',
  },
  container: {
    maxWidth: 640,
  },
  pageHeader: {
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 600,
    color: '#111827',
    letterSpacing: '-0.02em',
    marginBottom: 4,
  },
  pageDesc: {
    fontSize: 14,
    color: '#6b7280',
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  formSection: {
    padding: '24px 28px',
  },
  divider: {
    height: 1,
    background: '#f3f4f6',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 16,
  },
  sectionLabelSub: {
    fontSize: 11,
    fontWeight: 400,
    color: '#9ca3af',
    textTransform: 'none',
    letterSpacing: 0,
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
  req: { color: '#ef4444', marginLeft: 2 },
  opt: { color: '#9ca3af', fontWeight: 400, marginLeft: 4, fontSize: 12 },
  input: {
    padding: '9px 12px',
    fontSize: 14,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    width: '100%',
  },
  dropzone: {
    border: '1px dashed #d1d5db',
    borderRadius: 8,
    padding: '28px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    background: '#fafafa',
    transition: 'border-color 0.15s, background 0.15s',
  },
  dropzoneActive: {
    borderColor: '#111827',
    background: '#f3f4f6',
  },
  dropIcon: {
    fontSize: 20,
    color: '#9ca3af',
    marginBottom: 8,
    fontWeight: 300,
  },
  dropMain: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  dropSub: {
    fontSize: 12,
    color: '#9ca3af',
  },
  fileList: {
    marginTop: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    overflow: 'hidden',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 14px',
  },
  fileInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  fileSize:  { fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' },
  fileError: { fontSize: 12, color: '#b91c1c', whiteSpace: 'nowrap' },
  progressTrack: {
    width: 72,
    height: 3,
    background: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
    flexShrink: 0,
  },
  progressFill: {
    height: '100%',
    background: '#111827',
    borderRadius: 2,
    transition: 'width 0.1s',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    color: '#9ca3af',
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
  errorMsg: {
    fontSize: 13,
    color: '#b91c1c',
    padding: '10px 28px',
    background: '#fef2f2',
    borderTop: '1px solid #fecaca',
  },
  formFooter: {
    padding: '18px 28px',
    borderTop: '1px solid #f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    background: '#fafafa',
  },
  submit: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 36,
    padding: '0 20px',
    fontSize: 14,
    fontWeight: 500,
    background: '#111827',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    flexShrink: 0,
  },
  footerNote: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 1.4,
  },
}
