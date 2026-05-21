import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api.js'

const MAX_FILE_SIZE = 20 * 1024 * 1024   // 20 MB
const MAX_TOTAL_SIZE = 100 * 1024 * 1024  // 100 MB
const MAX_FILES = 10
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf', 'text/plain'])

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}

function validateFile(file) {
  if (!ALLOWED_TYPES.has(file.type)) return `Unsupported file type (allowed: jpg, png, pdf, txt)`
  if (file.size > MAX_FILE_SIZE) return `Exceeds 20 MB limit (${formatBytes(file.size)})`
  return null
}

export default function Upload() {
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])       // { file, error: string|null }
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)  // 0–100
  const [submitting, setSubmitting] = useState(false)
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

  const onDrop = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [])

  const onDragOver = useCallback(e => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])

  const validFiles = files.filter(f => !f.error)
  const totalSize = validFiles.reduce((sum, f) => sum + f.file.size, 0)
  const totalSizeError = totalSize > MAX_TOTAL_SIZE
    ? `Total size ${formatBytes(totalSize)} exceeds 100 MB limit`
    : null

  const canSubmit = address.trim() && validFiles.length > 0 && !totalSizeError && !submitting

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitError(null)
    setSubmitting(true)
    setProgress(0)

    try {
      const { data: { jobId } } = await api.post('/jobs', {
        address: address.trim(),
        description: notes.trim() || undefined
      })

      const formData = new FormData()
      validFiles.forEach(({ file }) => formData.append('files', file))

      await api.post(`/jobs/${jobId}/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100))
        }
      })

      navigate('/dashboard')
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Upload failed — please try again.')
      setSubmitting(false)
      setProgress(0)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>New Job</h1>

        <form onSubmit={handleSubmit}>
          {/* Address */}
          <label style={s.label}>
            Job Address <span style={s.req}>*</span>
          </label>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="123 Main St, Springfield, IL 62701"
            required
            disabled={submitting}
            style={s.input}
          />

          {/* Notes */}
          <label style={s.label}>Field Notes <span style={s.opt}>(optional)</span></label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Describe damage, scope of work, or any relevant details…"
            rows={4}
            disabled={submitting}
            style={{ ...s.input, resize: 'vertical' }}
          />

          {/* Drop zone */}
          <label style={s.label}>
            Files <span style={s.opt}>(jpg, png, pdf, txt · max 10 files)</span>
          </label>
          <div
            style={{ ...s.dropzone, ...(dragging ? s.dropzoneDragging : {}) }}
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
            <p style={s.dropPrimary}>
              {dragging ? 'Drop files here' : 'Drag & drop files here, or click to browse'}
            </p>
            <p style={s.dropSub}>Max 20 MB per file · 100 MB total</p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <ul style={s.fileList}>
              {files.map(({ file, error: fileError }, i) => (
                <li key={i} style={s.fileRow}>
                  <div style={s.fileInfo}>
                    <span style={s.fileName}>{file.name}</span>
                    <span style={s.fileSize}>{formatBytes(file.size)}</span>
                  </div>

                  {fileError ? (
                    <p style={s.fileError}>{fileError}</p>
                  ) : submitting ? (
                    <div style={s.progressTrack}>
                      <div style={{ ...s.progressFill, width: `${progress}%` }} />
                    </div>
                  ) : null}

                  {!submitting && (
                    <button
                      type="button"
                      onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      style={s.removeBtn}
                      aria-label={`Remove ${file.name}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {totalSizeError && <p style={s.error}>{totalSizeError}</p>}
          {submitError && <p style={s.error}>{submitError}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{ ...s.submitBtn, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.45 }}
          >
            {submitting ? `Uploading… ${progress}%` : 'Submit Job'}
          </button>
        </form>
      </div>
    </div>
  )
}

const s = {
  page: { minHeight: '100vh', background: '#f5f5f5', display: 'flex', justifyContent: 'center', padding: '40px 16px', fontFamily: 'system-ui, sans-serif' },
  card: { background: '#fff', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,.08)', padding: 40, width: '100%', maxWidth: 600, alignSelf: 'flex-start' },
  title: { margin: '0 0 28px', fontSize: 24 },
  label: { display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6 },
  req: { color: '#c00' },
  opt: { color: '#888', fontWeight: 400 },
  input: { display: 'block', width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #ddd', borderRadius: 6, marginBottom: 20, boxSizing: 'border-box', fontFamily: 'inherit' },
  dropzone: { border: '2px dashed #ccc', borderRadius: 8, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, transition: 'border-color .15s, background .15s' },
  dropzoneDragging: { borderColor: '#1a1a1a', background: '#f0f0f0' },
  dropPrimary: { margin: '0 0 6px', fontSize: 14, color: '#333' },
  dropSub: { margin: 0, fontSize: 12, color: '#888' },
  fileList: { listStyle: 'none', padding: 0, margin: '0 0 16px' },
  fileRow: { display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderBottom: '1px solid #f0f0f0', position: 'relative' },
  fileInfo: { display: 'flex', alignItems: 'center', gap: 12 },
  fileName: { fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileSize: { fontSize: 12, color: '#888', whiteSpace: 'nowrap' },
  fileError: { margin: '2px 0 0', fontSize: 12, color: '#c00' },
  progressTrack: { height: 4, background: '#eee', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#1a1a1a', borderRadius: 2, transition: 'width .1s' },
  removeBtn: { position: 'absolute', top: 10, right: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#999', lineHeight: 1, padding: '0 4px' },
  error: { color: '#c00', fontSize: 14, margin: '0 0 16px' },
  submitBtn: { display: 'block', width: '100%', padding: 12, fontSize: 15, fontWeight: 600, background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 6, marginTop: 8 }
}
