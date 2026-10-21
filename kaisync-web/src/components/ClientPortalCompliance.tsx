'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCompliance, signPortalMedia, submitComplianceDocument, type ClientComplianceView } from '@/lib/client-portal/api'
import { fmtDate } from '@/lib/client-portal/format'
import type { ClientPortalSession } from '@/lib/client-portal/session'

type Doc = ClientComplianceView['documents'][number]
type State = 'missing' | 'pending' | 'approved' | 'expiring' | 'expired' | 'rejected'

const STATE: Record<State, { label: string; cls: string }> = {
  missing: { label: 'Needed', cls: 'bg-surface-elevated text-text-secondary' },
  pending: { label: 'Waiting for review', cls: 'bg-warning/15 text-warning' },
  approved: { label: 'Approved', cls: 'bg-success/15 text-success' },
  expiring: { label: 'Expires soon', cls: 'bg-warning/15 text-warning' },
  expired: { label: 'Expired — please replace', cls: 'bg-error/15 text-error' },
  rejected: { label: 'Not accepted — please replace', cls: 'bg-error/15 text-error' },
}
const STATUS_TEXT = {
  not_configured: '', compliant: 'All required documents are in order.', near: 'Almost complete.',
  partial: 'Some documents are still needed.', non_compliant: 'Several documents are still needed.',
}

function stateOf(doc: Doc | undefined): State {
  if (!doc) return 'missing'
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  if (doc.status === 'approved') {
    if (doc.expiry_date && doc.expiry_date < today) return 'expired'
    if (doc.expiry_date && doc.expiry_date <= in30) return 'expiring'
    return 'approved'
  }
  if (doc.status === 'expired') return 'expired'
  if (doc.status === 'pending') return 'pending'
  if (doc.status === 'rejected') return 'rejected'
  return 'missing'
}

/** Client portal: compliance checklist ("we need from you") and documents from us. */
export function ClientPortalCompliance({ session }: { session: ClientPortalSession }) {
  const [view, setView] = useState<ClientComplianceView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setView(await getCompliance(session.company_code, session.client_code)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not load your compliance checklist.') }
  }, [session.company_code, session.client_code])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const current = useMemo(() => {
    const m = new Map<string, Doc>()
    for (const d of view?.documents ?? []) {
      const k = `${d.direction}:${d.document_type_code}`
      if (d.is_current && d.status !== 'superseded' && !m.has(k)) m.set(k, d)
    }
    return m
  }, [view])

  async function open(path: string) {
    const signed = await signPortalMedia([path])
    const url = signed[path]
    if (url) window.open(url, '_blank', 'noopener')
    else setError('Could not open the file.')
  }

  if (!view) return error ? <p className="text-[13px] text-error">{error}</p> : <p className="text-[13px] text-text-secondary">Loading…</p>
  if (!view.summary.has_pack) return null

  const needed = view.items.filter(i => i.direction === 'from_party')
  const fromUs = view.documents.filter(d => d.direction === 'to_party')
  const s = view.summary

  return (
    <div className="space-y-4">
      <section className="border-divider bg-surface rounded-xl border overflow-hidden">
        <div className="border-divider px-4 py-2.5 border-b flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Compliance — we need from you</p>
          <p className="text-[12px] font-semibold text-text-primary">{s.complete_count}/{s.required_count} required done</p>
        </div>
        <div className="px-4 py-3 space-y-3">
          {STATUS_TEXT[s.status] && <p className="text-[12px] text-text-secondary">{STATUS_TEXT[s.status]}</p>}
          {error && <p className="text-[12px] text-error">{error}</p>}
          {done && <p className="text-[12px] text-success font-semibold">{done}</p>}
          {needed.length === 0 && <p className="text-[12px] text-text-secondary">Nothing is needed from you right now.</p>}
          {needed.map(item => {
            const doc = current.get(`from_party:${item.document_type_code}`)
            const st = stateOf(doc)
            return (
              <div key={item.document_type_code} className="border-divider border-t pt-3 first:border-0 first:pt-0 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-text-primary">
                      {item.label}{item.requirement === 'recommended' && <span className="ml-2 text-[11px] font-normal text-text-secondary">optional</span>}
                    </p>
                    {item.notes && <p className="text-[12px] text-text-secondary">{item.notes}</p>}
                    {doc && (
                      <p className="text-[12px] text-text-secondary">
                        {doc.document_name} · sent {fmtDate(doc.created_at)}{doc.expiry_date ? ` · expires ${fmtDate(doc.expiry_date)}` : ''}
                      </p>
                    )}
                    {doc?.status === 'rejected' && doc.rejected_reason && (
                      <p className="text-[12px] text-error">Reason: {doc.rejected_reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STATE[st].cls}`}>{STATE[st].label}</span>
                    {doc && <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => void open(doc.storage_path)}>View</button>}
                    {(
                      <button type="button" className="text-[12px] font-semibold text-primary hover:underline"
                        onClick={() => { setUploading(uploading === item.document_type_code ? null : item.document_type_code); setDone(null); setError(null) }}>
                        {doc ? 'Replace' : 'Upload'}
                      </button>
                    )}
                  </div>
                </div>
                {uploading === item.document_type_code && (
                  <UploadBox
                    expiryRequired={item.expiry_required}
                    busy={busy}
                    onCancel={() => setUploading(null)}
                    onSubmit={async (file, issue, expiry, notes) => {
                      setBusy(true); setError(null)
                      try {
                        await submitComplianceDocument({
                          companyCode: session.company_code, clientCode: session.client_code, uploadPrefix: view.upload_prefix,
                          typeCode: item.document_type_code, file, issueDate: issue, expiryDate: expiry, notes,
                        })
                        setUploading(null)
                        setDone(`${item.label} was sent. Our team will review it.`)
                        await load()
                      } catch (e: unknown) {
                        setError(e instanceof Error ? e.message : 'Could not upload the document.')
                      }
                      setBusy(false)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </section>

      {fromUs.length > 0 && (
        <section className="border-divider bg-surface rounded-xl border overflow-hidden">
          <div className="border-divider px-4 py-2.5 border-b">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Documents from us</p>
          </div>
          <div className="px-4 py-3 space-y-2">
            {fromUs.map(d => {
              const label = view.items.find(i => i.document_type_code === d.document_type_code)?.label ?? d.document_name
              return (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">{label}</p>
                    <p className="text-[11px] text-text-secondary">{d.expiry_date ? `Valid until ${fmtDate(d.expiry_date)}` : `Shared ${fmtDate(d.created_at)}`}</p>
                  </div>
                  <button type="button" className="text-[12px] font-semibold text-primary hover:underline shrink-0" onClick={() => void open(d.storage_path)}>Download</button>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function UploadBox({ expiryRequired, busy, onSubmit, onCancel }: {
  expiryRequired: boolean; busy: boolean
  onSubmit: (file: File, issue: string | null, expiry: string | null, notes: string | null) => void; onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [issue, setIssue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [notes, setNotes] = useState('')
  const ok = !!file && (!expiryRequired || !!expiry)
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx" className="text-[12px]" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-text-secondary">Issue date
          <input type="date" className="bg-surface border border-divider text-text-primary w-full h-9 px-2 rounded-lg text-[12px]" value={issue} onChange={e => setIssue(e.target.value)} />
        </label>
        <label className="text-[11px] text-text-secondary">Expiry date{expiryRequired ? ' *' : ''}
          <input type="date" className="bg-surface border border-divider text-text-primary w-full h-9 px-2 rounded-lg text-[12px]" value={expiry} onChange={e => setExpiry(e.target.value)} />
        </label>
      </div>
      <input className="bg-surface border border-divider text-text-primary w-full h-9 px-2 rounded-lg text-[12px]" placeholder="Note for our team (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" disabled={busy || !ok} onClick={() => file && onSubmit(file, issue || null, expiry || null, notes || null)}
          className="h-9 px-4 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
        <button type="button" onClick={onCancel} className="h-9 px-4 rounded-lg border border-divider text-[12px] text-text-primary">Cancel</button>
      </div>
    </div>
  )
}
