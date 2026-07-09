'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Doc {
  id: string; document_name: string; type_label: string
  type_icon: string; storage_path: string; created_display: string
}

const DOC_TYPES = [
  'Contract', 'Invoice', 'Safety Certificate', 'Insurance',
  'Compliance Document', 'Photo', 'Other',
]

function ContractorDocsContent() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const jobId = params.id
  const contractorId = searchParams.get('contractorId') ?? ''

  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [isDocsBusy, setIsDocsBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedDocType, setSelectedDocType] = useState(DOC_TYPES[0])
  const [jobTitle, setJobTitle] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [{ data: jobData }, { data: docData }] = await Promise.all([
      supabase.from('jobs').select('title').eq('id', jobId).maybeSingle(),
      contractorId
        ? supabase.from('job_contractor_documents')
            .select('*')
            .eq('job_id', jobId)
            .eq('contractor_id', contractorId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])

    if (jobData) setJobTitle((jobData as Record<string, unknown>).title as string)
    setDocs((docData ?? []) as Doc[])
    setLoading(false)
  }, [jobId, contractorId])

  useEffect(() => { load() }, [load])

  async function upload(file: File) {
    if (!contractorId) return
    setIsDocsBusy(true)
    setErrorMsg('')
    const supabase = createClient()
    const path = `contractor-docs/${jobId}/${contractorId}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file)
    if (upErr) { setErrorMsg(upErr.message); setIsDocsBusy(false); return }

    const { data } = await supabase.from('job_contractor_documents').insert({
      job_id: jobId,
      contractor_id: contractorId,
      document_name: file.name,
      type_label: selectedDocType,
      type_icon: '📄',
      storage_path: path,
    }).select().single()
    if (data) setDocs(prev => [data as Doc, ...prev])
    setIsDocsBusy(false)
  }

  async function openDoc(doc: Doc) {
    const supabase = createClient()
    const { data } = await supabase.storage.from('workforce-media').createSignedUrl(doc.storage_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(id: string, path: string) {
    const supabase = createClient()
    await supabase.storage.from('workforce-media').remove([path])
    await supabase.from('job_contractor_documents').delete().eq('id', id)
    setDocs(prev => prev.filter(d => d.id !== id))
    setConfirmDeleteId(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href={`/dashboard/jobs/${jobId}`}
          className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary">Contractor Documents</h1>
          {jobTitle && <p className="text-[13px] text-text-secondary truncate">{jobTitle}</p>}
        </div>
      </div>

      {errorMsg && (
        <p className="px-4 py-1 text-[13px] font-semibold" style={{ color: '#FCA5A5' }}>{errorMsg}</p>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="card p-4 space-y-3">
          {/* Card header */}
          <div className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <p className="section-label">ASSIGNMENT DOCUMENTS</p>
            {isDocsBusy && (
              <span className="text-[12px] text-text-secondary">Uploading…</span>
            )}
            <button
              disabled={isDocsBusy}
              onClick={() => fileRef.current?.click()}
              className="btn-primary h-[36px] px-3.5 text-[12px] disabled:opacity-50"
            >
              Upload
            </button>
          </div>

          <input ref={fileRef} type="file" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />

          {/* Doc type picker */}
          <div className="flex items-center gap-2">
            <label className="text-[12px] text-text-secondary shrink-0">Type:</label>
            <select value={selectedDocType} onChange={e => setSelectedDocType(e.target.value)}
              className="flex-1 dark-entry text-[13px] appearance-none">
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <hr className="border-divider" />

          {/* Docs list */}
          {loading ? (
            <p className="text-text-secondary text-[13px] text-center py-4">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-text-secondary text-[13px] py-2">No documents uploaded yet.</p>
          ) : (
            <div className="flex flex-col gap-0">
              {docs.map(doc => (
                <div key={doc.id}
                  className="grid items-center gap-2 py-1.5"
                  style={{ gridTemplateColumns: '30px 1fr auto auto' }}>
                  <span className="text-[18px]">{doc.type_icon || '📄'}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[13px] text-text-primary truncate">{doc.document_name}</p>
                    <p className="text-[11px] text-primary">{doc.type_label}</p>
                    <p className="text-[10px] text-text-secondary">{doc.created_display}</p>
                  </div>
                  <button onClick={() => openDoc(doc)}
                    className="btn-outlined text-[11px] h-[32px] px-2.5 shrink-0">
                    Open
                  </button>
                  <button onClick={() => setConfirmDeleteId(doc.id)}
                    className="w-9 h-8 p-0 text-text-secondary text-[12px] hover:text-error transition-colors shrink-0">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDeleteId && (() => {
        const doc = docs.find(d => d.id === confirmDeleteId)!
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-xl shadow-lg w-full max-w-xs p-5 space-y-3">
              <p className="font-semibold text-text-primary">Delete Document?</p>
              <p className="text-sm text-text-secondary">
                &ldquo;{doc.document_name}&rdquo; will be permanently removed.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmDeleteId(null)} className="btn-outlined h-9 px-4 text-[13px]">
                  Cancel
                </button>
                <button onClick={() => deleteDoc(doc.id, doc.storage_path)}
                  className="h-9 px-4 text-[13px] rounded-lg bg-error text-white font-medium">
                  Delete
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function ContractorDocsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    }>
      <ContractorDocsContent />
    </Suspense>
  )
}
