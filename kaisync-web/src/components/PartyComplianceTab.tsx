'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { signWorkforceMedia } from '@/lib/media-read'
import {
  assignPack, buildChecklist, DOC_STATUS_LABEL, getPartyCompliance, hrUploadDocument, reviewDocument, setGrade,
  STATUS_LABEL, statusTone, type ChecklistRow, type Direction, type PartyCompliance, type PartyKind,
} from '@/lib/compliance/api'

const STATE_LABEL: Record<ChecklistRow['state'], string> = {
  missing: 'Missing', pending: 'Waiting for review', approved: 'Approved', expiring: 'Expires soon', expired: 'Expired', rejected: 'Rejected',
}
const STATE_CLASS: Record<ChecklistRow['state'], string> = {
  missing: 'bg-surface-elevated text-text-secondary', pending: 'bg-warning/15 text-warning', approved: 'bg-success/15 text-success',
  expiring: 'bg-warning/15 text-warning', expired: 'bg-error/15 text-error', rejected: 'bg-error/15 text-error',
}
const TONE_CLASS = { success: 'text-success', warning: 'text-warning', error: 'text-error', muted: 'text-text-secondary' }

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** HR Compliance tab for a client (and, from step C5, a contractor). */
export function PartyComplianceTab({ companyId, kind, partyId, partyLabel }: {
  companyId: string; kind: PartyKind; partyId: string; partyLabel: string
}) {
  const [data, setData] = useState<PartyCompliance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadFor, setUploadFor] = useState<{ code: string; direction: Direction; label: string } | null>(null)
  const [rejectFor, setRejectFor] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [gradeOpen, setGradeOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await getPartyCompliance(createClient(), companyId, kind, partyId))
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load compliance.')
    }
  }, [companyId, kind, partyId])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => data ? buildChecklist(data.items, data.documents) : [], [data])
  const fromRows = rows.filter(r => r.item.direction === 'from_party')
  const toRows = rows.filter(r => r.item.direction === 'to_party')

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try { await fn(); await load() } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    setBusy(false)
  }

  async function view(path: string) {
    const url = await signWorkforceMedia(createClient(), path, 120, null)
    if (url) window.open(url, '_blank', 'noopener')
    else setError('Could not open the file.')
  }

  if (!data) {
    return <div className="p-4 text-[13px] text-text-secondary">{error ?? 'Loading…'}</div>
  }
  const s = data.summary
  const partyWord = kind === 'client' ? 'client' : 'contractor'

  return (
    <div className="space-y-4 p-4">
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">{error}</div>}

      <div className="card p-4 grid gap-4 md:grid-cols-3">
        <div>
          <p className="section-label">COMPLIANCE SCORE</p>
          <p className={`text-[32px] font-bold ${TONE_CLASS[statusTone(s.status)]}`}>{s.status === 'not_configured' ? '—' : `${s.score}%`}</p>
          <p className={`text-[13px] font-semibold ${TONE_CLASS[statusTone(s.status)]}`}>{STATUS_LABEL[s.status]}</p>
          <p className="text-[11px] text-text-secondary mt-1">
            {s.complete_count}/{s.required_count} required approved · {s.pending_count} waiting · {s.missing_count} missing
            {s.expired_count ? ` · ${s.expired_count} expired` : ''}{s.expiring_count ? ` · ${s.expiring_count} expiring soon` : ''}
          </p>
        </div>
        <div>
          <p className="section-label">REQUIREMENT PACK</p>
          {data.can_edit ? (
            <select
              className="dark-entry appearance-none mt-1"
              value={s.pack_id ?? ''}
              disabled={busy}
              onChange={e => void run(() => assignPack(createClient(), companyId, kind, partyId, e.target.value || null))}
            >
              <option value="">No pack</option>
              {data.packs.map(p => <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''}</option>)}
            </select>
          ) : (
            <p className="text-[13px] text-text-primary mt-1">{data.pack?.name ?? 'No pack'}</p>
          )}
          {data.packs.length === 0 && (
            <p className="text-[11px] text-text-secondary mt-1">Create packs under Client Compliance → Packs.</p>
          )}
          {s.obligations_open > 0 && (
            <p className="text-[12px] text-warning mt-2">{s.obligations_open} document(s) we still owe this {partyWord}.</p>
          )}
        </div>
        <div>
          <p className="section-label">HR RISK GRADE (INTERNAL)</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[24px] font-bold text-text-primary">{s.hr_grade ?? '—'}</span>
            {data.can_edit && (
              <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => setGradeOpen(v => !v)}>
                {s.hr_grade ? 'Change' : 'Set grade'}
              </button>
            )}
            {data.grade_history.length > 0 && (
              <button type="button" className="text-[12px] text-text-secondary hover:underline" onClick={() => setShowHistory(v => !v)}>History</button>
            )}
          </div>
          {s.hr_grade_reason && <p className="text-[11px] text-text-secondary">{s.hr_grade_reason}</p>}
          <p className="text-[10px] text-text-secondary mt-1">A = low risk, D = high risk. Never shown to the {partyWord}.</p>
          {gradeOpen && (
            <GradeForm busy={busy} current={s.hr_grade} onCancel={() => setGradeOpen(false)}
              onSave={(g, r) => void run(async () => { await setGrade(createClient(), companyId, kind, partyId, g, r); setGradeOpen(false) })} />
          )}
          {showHistory && (
            <div className="mt-2 space-y-1">
              {data.grade_history.map((h, i) => (
                <p key={i} className="text-[11px] text-text-secondary">
                  <span className="font-semibold text-text-primary">{h.grade ?? 'cleared'}</span> · {fmtDate(h.set_at)}
                  {h.set_by_name ? ` · ${h.set_by_name}` : ''} — {h.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <ChecklistSection
        title={`NEEDED FROM THE ${partyWord.toUpperCase()}`}
        empty={s.pack_id ? 'Nothing required in this pack.' : `Assign a pack to see what this ${partyWord} must provide.`}
        rows={fromRows}
        data={data}
        busy={busy}
        onView={view}
        onUpload={r => setUploadFor({ code: r.item.document_type_code, direction: r.item.direction, label: r.item.label ?? r.item.document_type_code })}
        onApprove={id => void run(() => reviewDocument(createClient(), id, true))}
        onReject={id => { setRejectFor(id); setRejectReason('') }}
      />
      {(toRows.length > 0 || s.pack_id) && (
        <ChecklistSection
          title={`OUR OBLIGATIONS (DOCUMENTS WE GIVE THE ${partyWord.toUpperCase()})`}
          empty="No documents from us in this pack."
          rows={toRows}
          data={data}
          busy={busy}
          onView={view}
          onUpload={r => setUploadFor({ code: r.item.document_type_code, direction: r.item.direction, label: r.item.label ?? r.item.document_type_code })}
          onApprove={id => void run(() => reviewDocument(createClient(), id, true))}
          onReject={id => { setRejectFor(id); setRejectReason('') }}
        />
      )}

      {rejectFor && (
        <div className="card p-4 space-y-2 border border-error/30">
          <p className="section-label">REJECT DOCUMENT</p>
          <input className="dark-entry" placeholder={`Reason (the ${partyWord} will see this)`} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !rejectReason.trim()} className="h-9 px-4 rounded-lg bg-error text-white text-[12px] font-semibold disabled:opacity-50"
              onClick={() => void run(async () => { await reviewDocument(createClient(), rejectFor, false, rejectReason.trim()); setRejectFor(null) })}>Reject</button>
            <button type="button" className="h-9 px-4 rounded-lg border border-border text-[12px]" onClick={() => setRejectFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {uploadFor && (
        <UploadForm
          label={uploadFor.label}
          busy={busy}
          onCancel={() => setUploadFor(null)}
          onSubmit={(file, issue, expiry, notes) => void run(async () => {
            await hrUploadDocument(createClient(), {
              companyId, kind, partyId, uploadPrefix: data.upload_prefix, file, typeCode: uploadFor.code,
              direction: uploadFor.direction, name: file.name, issueDate: issue, expiryDate: expiry, notes,
            })
            setUploadFor(null)
          })}
        />
      )}

      <div className="card p-4 space-y-2">
        <p className="section-label">ALL DOCUMENTS (INCLUDING OLD VERSIONS)</p>
        {data.documents.length === 0 ? (
          <p className="text-[12px] text-text-secondary">No compliance documents yet for {partyLabel}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[560px]">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="py-1 pr-2">Document</th><th className="py-1 pr-2">Direction</th><th className="py-1 pr-2">Status</th>
                  <th className="py-1 pr-2">Expiry</th><th className="py-1 pr-2">Uploaded</th><th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map(d => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-1.5 pr-2 text-text-primary">{d.document_name}</td>
                    <td className="py-1.5 pr-2 text-text-secondary">{d.direction === 'from_party' ? `From ${partyWord}` : 'From us'}</td>
                    <td className="py-1.5 pr-2">{DOC_STATUS_LABEL[d.status]}{!d.is_current && d.status !== 'superseded' ? ' (old)' : ''}
                      {d.rejected_reason ? <span className="text-error"> — {d.rejected_reason}</span> : null}</td>
                    <td className="py-1.5 pr-2 text-text-secondary">{fmtDate(d.expiry_date)}</td>
                    <td className="py-1.5 pr-2 text-text-secondary">{fmtDate(d.created_at)} · {d.uploaded_by_kind === 'hr' ? 'HR' : 'Portal'}</td>
                    <td className="py-1.5"><button type="button" className="text-primary hover:underline" onClick={() => void view(d.storage_path)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ChecklistSection({ title, empty, rows, data, busy, onView, onUpload, onApprove, onReject }: {
  title: string; empty: string; rows: ChecklistRow[]; data: PartyCompliance; busy: boolean
  onView: (path: string) => void; onUpload: (r: ChecklistRow) => void; onApprove: (id: string) => void; onReject: (id: string) => void
}) {
  return (
    <div className="card p-4 space-y-2">
      <p className="section-label">{title}</p>
      {rows.length === 0 ? <p className="text-[12px] text-text-secondary">{empty}</p> : rows.map(r => (
        <div key={`${r.item.direction}-${r.item.document_type_code}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 first:border-0 first:pt-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">
              {r.item.label ?? r.item.document_type_code}
              <span className="ml-2 text-[10px] font-normal text-text-secondary">{r.item.requirement === 'required' ? 'Required' : 'Recommended'}</span>
            </p>
            <p className="text-[11px] text-text-secondary">
              {r.doc ? `${r.doc.document_name} · uploaded ${fmtDate(r.doc.created_at)}` : 'No document yet'}
              {r.doc?.expiry_date ? ` · expires ${fmtDate(r.doc.expiry_date)}` : ''}
              {r.doc?.rejected_reason ? ` · ${r.doc.rejected_reason}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${STATE_CLASS[r.state]}`}>{STATE_LABEL[r.state]}</span>
            {r.doc && <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => onView(r.doc!.storage_path)}>View</button>}
            {r.doc?.status === 'pending' && data.can_review && (
              <>
                <button type="button" disabled={busy} className="text-[12px] font-semibold text-success hover:underline" onClick={() => onApprove(r.doc!.id)}>Approve</button>
                <button type="button" disabled={busy} className="text-[12px] font-semibold text-error hover:underline" onClick={() => onReject(r.doc!.id)}>Reject</button>
              </>
            )}
            {data.can_edit && (
              <button type="button" disabled={busy} className="text-[12px] text-primary hover:underline" onClick={() => onUpload(r)}>
                {r.doc ? 'Replace' : 'Upload'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function GradeForm({ current, busy, onSave, onCancel }: {
  current: string | null; busy: boolean; onSave: (g: string | null, reason: string) => void; onCancel: () => void
}) {
  const [grade, setG] = useState<string>(current ?? '')
  const [reason, setReason] = useState('')
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {['A', 'B', 'C', 'D', ''].map(g => (
          <button key={g || 'none'} type="button" onClick={() => setG(g)}
            className={`h-8 min-w-8 px-2 rounded-lg border text-[12px] font-semibold ${grade === g ? 'bg-primary text-white border-primary' : 'border-border text-text-primary'}`}>
            {g || 'Clear'}
          </button>
        ))}
      </div>
      <input className="dark-entry" placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" disabled={busy || !reason.trim()} onClick={() => onSave(grade || null, reason.trim())}
          className="h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-50">Save grade</button>
        <button type="button" onClick={onCancel} className="h-8 px-3 rounded-lg border border-border text-[12px]">Cancel</button>
      </div>
    </div>
  )
}

function UploadForm({ label, busy, onSubmit, onCancel }: {
  label: string; busy: boolean
  onSubmit: (file: File, issue: string | null, expiry: string | null, notes: string | null) => void; onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [issue, setIssue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [notes, setNotes] = useState('')
  return (
    <div className="card p-4 space-y-2 border border-primary/30">
      <p className="section-label">UPLOAD: {label.toUpperCase()}</p>
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-text-secondary">Issue date<input type="date" className="dark-entry" value={issue} onChange={e => setIssue(e.target.value)} /></label>
        <label className="text-[11px] text-text-secondary">Expiry date<input type="date" className="dark-entry" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
      </div>
      <input className="dark-entry" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" disabled={busy || !file} onClick={() => file && onSubmit(file, issue || null, expiry || null, notes || null)}
          className="h-9 px-4 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-50">{busy ? 'Uploading…' : 'Upload'}</button>
        <button type="button" onClick={onCancel} className="h-9 px-4 rounded-lg border border-border text-[12px]">Cancel</button>
      </div>
    </div>
  )
}
