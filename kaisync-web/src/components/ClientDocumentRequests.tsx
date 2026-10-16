'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { portalStorageObjectName } from '@/lib/client-portal/api'

const DOC_TYPES = [
  { value: 'contract', label: 'Contract' },
  { value: 'msa', label: 'MSA' },
  { value: 'nda', label: 'NDA' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'purchase_order', label: 'Purchase order' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'other', label: 'Other' },
]

type RequestRow = {
  id: string
  document_name: string
  document_type: string
  request_note: string | null
  status: string
  review_note: string | null
  storage_path: string | null
  submitted_at: string | null
  created_at: string
}

function statusLabel(status: string): string {
  if (status === 'submitted') return 'Received'
  if (status === 'accepted') return 'Accepted'
  if (status === 'changes_requested') return 'Asked again'
  return 'Waiting'
}

export function ClientDocumentRequests({
  clientId,
  companyId,
  canEdit,
}: {
  clientId: string
  companyId: string
  canEdit: boolean
}) {
  const [rows, setRows] = useState<RequestRow[]>([])
  const [name, setName] = useState('')
  const [docType, setDocType] = useState('other')
  const [note, setNote] = useState('')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error: loadError } = await supabase
      .from('client_document_requests')
      .select('id, document_name, document_type, request_note, status, review_note, storage_path, submitted_at, created_at')
      .eq('client_id', clientId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
    if (loadError) {
      setError(loadError.message)
      return
    }
    setRows((data ?? []) as RequestRow[])
  }, [clientId, companyId])

  useEffect(() => {
    void load()
  }, [load])

  async function openFile(path: string | null) {
    const nameOnDisk = path ? portalStorageObjectName(path) : null
    if (!nameOnDisk) return
    const supabase = createClient()
    const { data, error: signError } = await supabase.storage.from('workforce-media').createSignedUrl(nameOnDisk, 3600)
    if (signError || !data?.signedUrl) {
      setError(signError?.message ?? 'Could not open the file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function requestDocument() {
    if (!canEdit || !name.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: insertError } = await supabase.from('client_document_requests').insert({
      company_id: companyId,
      client_id: clientId,
      document_name: name.trim(),
      document_type: docType,
      request_note: note.trim() || null,
      status: 'requested',
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setName('')
    setNote('')
    setDocType('other')
    await load()
  }

  async function accept(row: RequestRow) {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('client_document_requests')
      .update({ status: 'accepted', reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('company_id', companyId)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await load()
  }

  async function askAgain(row: RequestRow) {
    if (!canEdit) return
    const review = (reviewNotes[row.id] ?? '').trim()
    if (!review) {
      setError('Add a note so the client knows what to send again.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('client_document_requests')
      .update({
        status: 'changes_requested',
        review_note: review,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('company_id', companyId)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await load()
  }

  return (
    <div className="space-y-3">
      <p className="section-label">REQUESTED FROM CLIENT</p>
      {error && <p className="text-[12px] text-error">{error}</p>}
      {canEdit && (
        <div className="bg-surface border border-divider rounded-lg p-3 grid gap-2 md:grid-cols-[1fr_160px_1fr_auto] md:items-end">
          <label className="block">
            <span className="text-[11px] text-text-secondary">Document</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Signed contract"
              className="mt-1 w-full h-[34px] px-2 rounded border border-divider bg-background text-[13px]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-text-secondary">Type</span>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="mt-1 w-full h-[34px] px-2 rounded border border-divider bg-background text-[13px]"
            >
              {DOC_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-text-secondary">Note</span>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional"
              className="mt-1 w-full h-[34px] px-2 rounded border border-divider bg-background text-[13px]"
            />
          </label>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void requestDocument()}
            className="h-[34px] px-3 rounded bg-primary text-white text-[12px] font-semibold disabled:opacity-50"
          >
            Request
          </button>
        </div>
      )}
      <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
        <table className="w-full" style={{ minWidth: 640 }}>
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className="data-th">Document</th>
              <th className="data-th">Status</th>
              <th className="data-th">Note</th>
              <th className="data-th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="data-td text-text-secondary text-[13px]">No documents requested yet.</td>
              </tr>
            ) : rows.map(row => (
              <tr key={row.id} className="border-b border-divider last:border-0 align-top">
                <td className="data-td text-[13px] text-text-primary">
                  <p className="font-medium">{row.document_name}</p>
                  <p className="text-[11px] text-text-secondary">{row.document_type.replace(/_/g, ' ')}</p>
                </td>
                <td className="data-td text-[12px] text-text-primary whitespace-nowrap">{statusLabel(row.status)}</td>
                <td className="data-td text-[12px] text-text-secondary">
                  {row.request_note || '—'}
                  {row.review_note ? <p className="mt-1">Asked again: {row.review_note}</p> : null}
                </td>
                <td className="data-td">
                  <div className="flex flex-col items-start gap-1">
                    {row.storage_path && (
                      <button type="button" onClick={() => void openFile(row.storage_path)} className="text-primary text-[11px] font-medium">
                        Open
                      </button>
                    )}
                    {canEdit && row.status === 'submitted' && (
                      <>
                        <button type="button" disabled={busy} onClick={() => void accept(row)} className="text-[11px] font-medium text-primary disabled:opacity-50">
                          Accept
                        </button>
                        <input
                          value={reviewNotes[row.id] ?? ''}
                          onChange={e => setReviewNotes(prev => ({ ...prev, [row.id]: e.target.value }))}
                          placeholder="What to send again"
                          className="h-[30px] w-[180px] px-2 rounded border border-divider bg-background text-[12px]"
                        />
                        <button type="button" disabled={busy} onClick={() => void askAgain(row)} className="text-[11px] font-medium text-text-primary disabled:opacity-50">
                          Ask again
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
