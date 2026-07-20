'use client'

import { useRef, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface EmployeeDocument {
  id: string
  document_type: string
  document_name: string
  file_url: string
  uploaded_by_role: string
  created_at: string
}

const DOC_TYPES = ['id_document', 'contract', 'certificate', 'payslip', 'other']

function fmtDocType(raw: string): string {
  const map: Record<string, string> = {
    id_document: 'ID Document',
    contract:    'Contract',
    certificate: 'Certificate',
    payslip:     'Payslip',
    other:       'Other',
  }
  return map[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function DocumentsPage() {
  const [docs,          setDocs]          = useState<EmployeeDocument[]>([])
  const [loading,       setLoading]       = useState(true)
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [employeeId,    setEmployeeId]    = useState<string | null>(null)
  const [tok,           setTok]           = useState<string | null>(null)
  const [companyName,   setCompanyName]   = useState<string>('')
  const tokRef        = useRef<string | null>(null)
  const isCodeAuthRef = useRef<boolean>(false)

  // Upload modal
  const [showUpload,    setShowUpload]    = useState(false)
  const [upDocType,     setUpDocType]     = useState('')
  const [upDocName,     setUpDocName]     = useState('')
  const [uploading,     setUploading]     = useState(false)
  const [uploadError,   setUploadError]   = useState<string | null>(null)
  const uploadFileRef   = useRef<HTMLInputElement>(null)

  // Replace modal
  const [replaceDoc,    setReplaceDoc]    = useState<EmployeeDocument | null>(null)
  const [repDocName,    setRepDocName]    = useState('')
  const [replacing,     setReplacing]     = useState(false)
  const [replaceError,  setReplaceError]  = useState<string | null>(null)
  const replaceFileRef  = useRef<HTMLInputElement>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const token = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    setTok(token)
    tokRef.current        = token
    isCodeAuthRef.current = member.sessionToken !== null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_documents', {
      p_company_id:    member.companyId,
      p_employee_id:   member.employeeId,
      p_session_token: token,
    })
    setDocs((data as EmployeeDocument[]) ?? [])

    if (isCodeAuthRef.current) {
      try {
        const kfcs = JSON.parse(localStorage.getItem('kf_cs') ?? '{}')
        if (kfcs.company?.name) setCompanyName(kfcs.company.name)
      } catch { /* ignore */ }
    } else {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('name')
        .eq('id', member.companyId)
        .maybeSingle()
      if (companyRow?.name) setCompanyName(companyRow.name)
    }

    setLoading(false)
  }

  async function getSignedUrl(path: string): Promise<string | null> {
    const supabase = createClient()
    const { data } = await supabase.storage.from('workforce-media').createSignedUrl(path, 60)
    return data?.signedUrl ?? null
  }

  async function openDoc(doc: EmployeeDocument) {
    const url = await getSignedUrl(doc.file_url)
    if (url) window.open(url, '_blank')
  }

  async function downloadDoc(doc: EmployeeDocument) {
    const url = await getSignedUrl(doc.file_url)
    if (!url) return
    const a = document.createElement('a')
    a.href     = url
    a.download = doc.document_name
    a.click()
  }

  // ── Upload ────────────────────────────────────────────────────────────
  function openUploadModal() {
    setUpDocType('')
    setUpDocName('')
    setUploadError(null)
    if (uploadFileRef.current) uploadFileRef.current.value = ''
    setShowUpload(true)
  }

  async function submitUpload() {
    const file = uploadFileRef.current?.files?.[0]
    if (!file || !upDocType || !upDocName.trim()) {
      setUploadError('All fields are required.')
      return
    }
    if (!companyId || !employeeId) return
    setUploading(true)
    setUploadError(null)

    const supabase = createClient()
    const path = `employee-documents/${companyId}/${employeeId}/${Date.now()}_${file.name}`

    try {
      const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: false })
      if (upErr) throw upErr

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_submit_document', {
        p_company_id:    companyId,
        p_employee_id:   employeeId,
        p_document_type: upDocType,
        p_document_name: upDocName.trim(),
        p_file_url:      path,
        p_session_token: tokRef.current,
      })
      if (rpcErr) throw rpcErr

      setShowUpload(false)
      await init()
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.')
    }
    setUploading(false)
  }

  // ── Replace ───────────────────────────────────────────────────────────
  function openReplaceModal(doc: EmployeeDocument) {
    setReplaceDoc(doc)
    setRepDocName(doc.document_name)
    setReplaceError(null)
    if (replaceFileRef.current) replaceFileRef.current.value = ''
  }

  async function submitReplace() {
    if (!replaceDoc) return
    const file = replaceFileRef.current?.files?.[0]
    if (!file || !repDocName.trim()) {
      setReplaceError('Please select a file and provide a name.')
      return
    }
    if (!companyId || !employeeId) return
    setReplacing(true)
    setReplaceError(null)

    const supabase = createClient()
    const newPath = `employee-documents/${companyId}/${employeeId}/${Date.now()}_${file.name}`

    try {
      const { error: upErr } = await supabase.storage.from('workforce-media').upload(newPath, file, { upsert: false })
      if (upErr) throw upErr

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_update_document', {
        p_document_id:   replaceDoc.id,
        p_company_id:    companyId,
        p_employee_id:   employeeId,
        p_document_type: replaceDoc.document_type,
        p_document_name: repDocName.trim(),
        p_file_url:      newPath,
        p_session_token: tokRef.current,
      })
      if (rpcErr) throw rpcErr

      setReplaceDoc(null)
      await init()
    } catch (e: unknown) {
      setReplaceError(e instanceof Error ? e.message : 'Replace failed.')
    }
    setReplacing(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Documents</h1>
        <button onClick={openUploadModal}
          className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">
          <span className="material-icons text-[16px]">add</span>Upload
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">folder_open</span>
            <p className="text-[14px]">No documents uploaded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-start gap-3 px-4 py-4">
                <span className="material-icons text-text-disabled text-[24px] mt-0.5 shrink-0">description</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-text-primary truncate">{doc.document_name}</p>
                  <p className="text-[11px] text-text-secondary">{fmtDocType(doc.document_type)}</p>
                  <p className="text-[11px] text-text-disabled mt-0.5">
                    {companyName && <span>{companyName} · </span>}
                    {fmtDate(doc.created_at)}
                    {doc.uploaded_by_role === 'employee' && (
                      <span className="ml-1 text-warning">(pending review)</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openDoc(doc)} title="Open"
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-divider text-text-secondary hover:text-primary hover:border-primary transition-colors">
                    <span className="material-icons text-[16px]">open_in_new</span>
                  </button>
                  <button onClick={() => downloadDoc(doc)} title="Download"
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-divider text-text-secondary hover:text-primary hover:border-primary transition-colors">
                    <span className="material-icons text-[16px]">download</span>
                  </button>
                  <button onClick={() => openReplaceModal(doc)} title="Replace"
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-divider text-text-secondary hover:text-warning hover:border-warning transition-colors">
                    <span className="material-icons text-[16px]">swap_horiz</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">Upload Document</h2>
              <button onClick={() => setShowUpload(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>

            {uploadError && (
              <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
                <p className="text-[13px] text-error font-semibold">{uploadError}</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Document Type *</label>
              <select className="input" value={upDocType} onChange={e => setUpDocType(e.target.value)}>
                <option value="">Select type…</option>
                {DOC_TYPES.map(t => <option key={t} value={t}>{fmtDocType(t)}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Document Name *</label>
              <input className="input" type="text" placeholder="e.g. My ID Document"
                value={upDocName} onChange={e => setUpDocName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">File *</label>
              <input ref={uploadFileRef} type="file" className="text-[13px] text-text-secondary" />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowUpload(false)} disabled={uploading}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitUpload} disabled={uploading}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-bold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace modal */}
      {replaceDoc && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">Replace Document</h2>
              <button onClick={() => setReplaceDoc(null)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>

            {replaceError && (
              <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
                <p className="text-[13px] text-error font-semibold">{replaceError}</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Document Name</label>
              <input className="input" type="text"
                value={repDocName} onChange={e => setRepDocName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">New File *</label>
              <input ref={replaceFileRef} type="file" className="text-[13px] text-text-secondary" />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setReplaceDoc(null)} disabled={replacing}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitReplace} disabled={replacing}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-bold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {replacing ? 'Replacing…' : 'Replace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
