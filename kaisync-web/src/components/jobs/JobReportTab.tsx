'use client'

/**
 * The Job report tab (board R2): put together from the job, checked, then signed by the client on this phone
 * (signing from a link comes with the online documents release). "Download PDF" works at any time for HR and the office. Signed versions are kept
 * and locked; changes after signing make a new version. "Not happy" shows the client's reason; the job's status
 * does not change (decided 14 Nov 2026).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { companyLetterhead } from '@/lib/letterhead'
import { signWorkforceMediaMany } from '@/lib/media-read'
import {
  buildJobReportContent, fmtClock, fmtDay, fmtMinutes, loadJobReportSources, signoffError,
  type JobReportContent, type Signoff,
} from '@/lib/job-report'
import { buildJobReportPdf, loadPdfImage } from '@/lib/job-report-pdf'
import { SignaturePad } from '@/components/SignaturePad'

type Sources = Awaited<ReturnType<typeof loadJobReportSources>>
type Edits = { work: Record<string, string>; photos: string[]; still_to_do: string }

const STATUS: Record<Signoff['status'], { label: string; cls: string }> = {
  draft: { label: 'Not sent yet', cls: 'bg-slate-100 text-slate-700' },
  awaiting_client: { label: 'Waiting for the client', cls: 'bg-blue-50 text-blue-800' },
  signed: { label: 'Signed', cls: 'bg-emerald-50 text-emerald-800' },
  not_happy: { label: 'Client not happy', cls: 'bg-red-50 text-red-800' },
}

export function JobReportTab({ companyId, jobId, canEdit, myName }: {
  companyId: string
  jobId: string
  canEdit: boolean
  /** The signed-in person (signs as the technician / for the company). */
  myName: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [src, setSrc] = useState<Sources | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [edits, setEdits] = useState<Edits>({ work: {}, photos: [], still_to_do: '' })
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [editingWork, setEditingWork] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await loadJobReportSources(supabase, companyId, jobId)
      setSrc(s)
      const open = s.signoffs.find(x => x.scope === 'job' && x.status !== 'signed')
      const e = (open?.content as JobReportContent & { edits?: Edits } | undefined)?.edits
      setEdits(e ?? { work: {}, photos: s.photos.filter(p => p.phase !== 'before').slice(0, 4).map(p => p.path), still_to_do: '' })
      if (s.photos.length) setThumbs(await signWorkforceMediaMany(supabase, s.photos.map(p => p.path)))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The job report could not be loaded.')
    }
  }, [supabase, companyId, jobId])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const open = src?.signoffs.find(x => x.scope === 'job' && x.status !== 'signed') ?? null
  const signed = (src?.signoffs ?? []).filter(x => x.scope === 'job' && x.status === 'signed').reverse()
  const visitSignoffs = (src?.signoffs ?? []).filter(x => x.scope === 'visit')
  const content: JobReportContent | null = src ? buildJobReportContent({
    job: src.job, reports: src.reports, punches: src.punches, checklist: src.checklist, parts: src.parts,
    photos: edits.photos, stillToDo: edits.still_to_do, workEdits: edits.work,
  }) : null
  // Waiting for the client: what they see is what was sent.
  const shown: JobReportContent | null = open && open.status === 'awaiting_client' ? open.content : content

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(null); setNote(null)
    try { await fn() } catch (e) { setError(signoffError(e instanceof Error ? e.message : String(e))) } finally { setBusy(null) }
  }

  /** Saves the report as it is now (with the office's choices) and returns its id. */
  async function saveDraft(status: Signoff['status'] = 'draft', extra: Partial<Signoff> = {}): Promise<string> {
    if (!content) throw new Error('Nothing to save yet.')
    const row = { content: { ...content, edits }, status, ...extra }
    if (open) {
      const { error: e } = await supabase.from('job_signoffs').update(row).eq('id', open.id)
      if (e) throw new Error(e.message)
      return open.id
    }
    const version = Math.max(0, ...(src?.signoffs ?? []).filter(x => x.scope === 'job').map(x => x.version)) + 1
    const { data, error: e } = await supabase.from('job_signoffs')
      .insert({ company_id: companyId, job_id: jobId, scope: 'job', version, ...row }).select('id').single()
    if (e) throw new Error(e.message)
    return (data as { id: string }).id
  }

  async function downloadPdf(s: Signoff | null) {
    await run('pdf', async () => {
      const lh = await companyLetterhead(supabase, companyId)
      const c = s ? s.content : content
      if (!c) return
      const urls = await signWorkforceMediaMany(supabase, c.photos)
      const photos = (await Promise.all(c.photos.map(p => urls.get(p)).filter((u): u is string => !!u).map(loadPdfImage))).filter(x => x !== null)
      const doc = buildJobReportPdf({
        letterhead: lh, content: c, status: s?.status ?? 'draft', version: s?.version, photos,
        technician: s ? { name: s.technician_name, signature: s.technician_signature, at: s.technician_signed_at } : undefined,
        client: s ? { name: s.client_name, signature: s.client_signature, at: s.client_signed_at, comment: s.client_comment } : undefined,
      })
      doc.save(`Job_report_${(c.job.code ?? 'job').replace(/[^\w.-]+/g, '_')}${s?.status === 'signed' ? '_signed' : ''}.pdf`)
    })
  }

  async function setVisitSignoff(on: boolean | null) {
    await run('visit', async () => {
      const { error: e } = await supabase.from('jobs').update({ visit_signoff: on }).eq('id', jobId).eq('company_id', companyId)
      if (e) throw new Error(e.message)
      await load()
    })
  }

  if (error && !src) return <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>
  if (!src || !shown) return <p className="text-[13px] text-text-secondary py-6 text-center">Putting the report together…</p>

  const editable = canEdit && (!open || open.status !== 'awaiting_client')
  const card = 'bg-surface rounded-xl p-4 border border-divider flex flex-col gap-2'
  const sec = 'text-[11px] font-semibold text-text-secondary tracking-wider uppercase'

  return (
    <div className="flex flex-col gap-3 pb-6">
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>}
      {note && <p className="text-[13px] text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">{note}</p>}

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-text-primary">{shown.job.code ? `${shown.job.code} · ` : ''}{shown.job.title}</p>
            <p className="text-[13px] text-text-secondary">{[shown.job.client, shown.job.address, shown.job.service].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          <span className={`text-[12px] font-semibold rounded-full px-2.5 py-1 ${STATUS[open?.status ?? 'draft'].cls}`}>{open ? STATUS[open.status].label : signed.length ? 'Signed' : STATUS.draft.label}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void downloadPdf(open && open.status !== 'draft' ? open : null)} className="btn-outlined h-11 px-4 text-[14px]">
            <span className="material-icons text-[18px] mr-1">picture_as_pdf</span>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          {editable && <button type="button" disabled={busy !== null} onClick={() => void run('save', async () => { await saveDraft(open?.status === 'not_happy' ? 'not_happy' : 'draft'); setNote('Saved.'); await load() })} className="btn-outlined h-11 px-4 text-[14px]">{busy === 'save' ? 'Saving…' : 'Save'}</button>}
        </div>
      </div>

      {open?.status === 'not_happy' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[14px] font-semibold text-red-900">{open.client_name || 'The client'} is not happy</p>
          <p className="text-[13px] text-red-900 whitespace-pre-line">{open.client_comment || 'No reason given.'}</p>
          <p className="text-[12px] text-red-800 mt-1">Put it right (add a visit if needed), then send it for signing again. The job’s status was not changed.</p>
        </div>
      )}
      {open?.status === 'awaiting_client' && (
        <p className="text-[12.5px] text-blue-900 bg-blue-50 rounded-lg px-3 py-2">Sent for signing. This is what the client sees. To change it, <button type="button" className="underline font-medium" onClick={() => void run('unsend', async () => { await supabase.from('job_signoffs').update({ status: 'draft' }).eq('id', open.id); await load() })}>take it back</button>, edit and send again.</p>
      )}

      <div className={card}>
        <p className={sec}>Visits and time</p>
        {shown.visits.length === 0 ? <p className="text-[13px] text-text-secondary">No visits yet: they come from visit reports and clock-ins on this job.</p> : (
          <ul className="flex flex-col divide-y divide-divider">
            {shown.visits.map(d => {
              const vs = visitSignoffs.find(x => x.visit_date === d.date)
              return (
                <li key={d.date} className="py-2 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-medium text-text-primary">{fmtDay(d.date)}</span>
                    <span className="flex items-center gap-2 text-[13px]">
                      {vs && <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${STATUS[vs.status].cls}`}>Visit {STATUS[vs.status].label.toLowerCase()}</span>}
                      <b>{fmtMinutes(d.minutes)}</b>
                    </span>
                  </div>
                  {d.people.map(p => (
                    <span key={p.name} className="text-[12.5px] text-text-secondary">{p.name} · {fmtClock(p.arrived)} – {fmtClock(p.left)} · {fmtMinutes(p.minutes)}</span>
                  ))}
                </li>
              )
            })}
            <li className="pt-2 flex justify-between text-[14px] font-semibold"><span>Total on site</span><span>{fmtMinutes(shown.total_minutes)}</span></li>
          </ul>
        )}
        <label className="flex items-center justify-between gap-3 border-t border-divider pt-2 mt-1 min-h-[44px]">
          <span className="text-[13px] text-text-primary">Ask the client to sign at the end of each visit</span>
          <select disabled={!canEdit || busy !== null} value={src.visitSignoff === null ? '' : src.visitSignoff ? 'on' : 'off'}
            onChange={e => void setVisitSignoff(e.target.value === '' ? null : e.target.value === 'on')}
            className="h-10 rounded-lg border border-divider bg-surface px-2 text-[13px]">
            <option value="">Company default</option><option value="on">Yes</option><option value="off">No</option>
          </select>
        </label>
      </div>

      <div className={card}>
        <p className={sec}>Work done</p>
        {src.reports.length === 0 ? <p className="text-[13px] text-text-secondary">No visit reports yet.</p> : src.reports.map(r => (
          <div key={r.id} className="text-[13.5px]">
            <p className="text-[12px] text-text-secondary">{fmtDay(r.report_date)}{r.author ? ` · ${r.author}` : ''}</p>
            {editingWork === r.id ? (
              <div className="flex flex-col gap-1.5">
                <textarea rows={3} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-[14px]"
                  value={edits.work[r.id] ?? r.work_performed} onChange={e => setEdits(p => ({ ...p, work: { ...p.work, [r.id]: e.target.value } }))} />
                <button type="button" className="self-start text-[13px] text-primary" onClick={() => setEditingWork(null)}>Done</button>
              </div>
            ) : (
              <p className="whitespace-pre-line text-text-primary">
                {edits.work[r.id] ?? r.work_performed}
                {editable && <button type="button" className="ml-2 text-[12px] text-primary" onClick={() => setEditingWork(r.id)}>Tidy wording</button>}
              </p>
            )}
          </div>
        ))}
        {editable && Object.keys(edits.work).length > 0 && <p className="text-[11.5px] text-text-secondary">Tidied wording is for this report only; the visit reports stay as written.</p>}
      </div>

      {shown.checklist.length > 0 && (
        <div className={card}>
          <p className={sec}>Checklist</p>
          {shown.checklist.map((c, i) => (
            <div key={i} className="flex justify-between gap-2 text-[13.5px]"><span>{c.text}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${c.done ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{c.done ? 'Done' : 'To do'}</span></div>
          ))}
        </div>
      )}

      {(shown.parts.length > 0 || shown.materials.length > 0) && (
        <div className={card}>
          <p className={sec}>Parts and materials</p>
          {shown.parts.map((p, i) => <div key={i} className="flex justify-between text-[13.5px]"><span>{p.name}</span><span>{p.qty}{p.unit && p.unit !== 'each' ? ` ${p.unit}` : ''}</span></div>)}
          {shown.materials.map((m, i) => <p key={`m${i}`} className="text-[13px] text-text-secondary">{m}</p>)}
          <p className="text-[11.5px] text-text-secondary">No prices on the report: the invoice has them.</p>
        </div>
      )}

      {src.photos.length > 0 && (
        <div className={card}>
          <p className={sec}>Photos for the client <span className="normal-case font-normal">· {edits.photos.length} of {src.photos.length} chosen</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {src.photos.map(p => {
              const on = (open?.status === 'awaiting_client' ? shown.photos : edits.photos).includes(p.path)
              return (
                <button key={p.path} type="button" disabled={!editable} aria-pressed={on}
                  onClick={() => setEdits(prev => ({ ...prev, photos: on ? prev.photos.filter(x => x !== p.path) : [...prev.photos, p.path] }))}
                  className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 ${on ? 'border-primary' : 'border-transparent opacity-60'}`}>
                  {thumbs.get(p.path)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={thumbs.get(p.path)} alt={`${p.phase} photo`} className="w-full h-full object-cover" />
                    : <span className="w-full h-full bg-surface-elevated block" />}
                  <span className="absolute left-1 top-1 rounded bg-black/60 text-white text-[10.5px] px-1.5 capitalize">{p.phase}</span>
                  {on && <span className="material-icons absolute right-1 top-1 text-white bg-primary rounded-full text-[18px]">check</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className={card}>
        <p className={sec}>Still to do</p>
        {editable
          ? <textarea rows={2} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-[14px]" placeholder="Anything left for later (optional)"
              value={edits.still_to_do} onChange={e => setEdits(p => ({ ...p, still_to_do: e.target.value }))} maxLength={2000} />
          : <p className="text-[13.5px] whitespace-pre-line">{shown.still_to_do || '—'}</p>}
      </div>

      {canEdit && (
        <div className={card}>
          <p className={sec}>Get it signed</p>
          <p className="text-[12.5px] text-text-secondary">The client signs here and you sign for {myName ? `the company (${myName})` : 'the company'}. Once signed, the report is locked and the signed PDF is kept.</p>
          <button type="button" disabled={busy !== null} onClick={() => setSigning(true)} className="btn-primary h-12 px-4 text-[14px] sm:self-start">Sign on this phone (client is here)</button>
        </div>
      )}

      {signed.length > 0 && (
        <div className={card}>
          <p className={sec}>Signed reports</p>
          {signed.map(s => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-divider last:border-0">
              <span className="text-[13.5px]"><b>Version {s.version}</b> · {s.client_name} · {s.client_signed_at ? new Date(s.client_signed_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}{s.signed_via === 'link' ? ' · from the link' : ''}{s.client_comment ? ` · “${s.client_comment}”` : ''}</span>
              <button type="button" disabled={busy !== null} onClick={() => void downloadPdf(s)} className="btn-outlined h-10 px-3 text-[13px]">Signed PDF</button>
            </div>
          ))}
        </div>
      )}

      {signing && (
        <SignSheet myName={myName} onClose={() => setSigning(false)}
          onDone={async (r) => {
            await saveDraft(r.outcome, {
              technician_name: myName || null, technician_signature: r.techSig, technician_signed_at: r.techSig ? new Date().toISOString() : null,
              client_name: r.clientName, client_signature: r.outcome === 'signed' ? r.clientSig : null, client_comment: r.comment || null,
              client_signed_at: new Date().toISOString(), signed_via: 'on_site',
            } as Partial<Signoff>)
            setNote(r.outcome === 'signed' ? 'Signed. The report is locked and the signed PDF is ready.' : 'Saved as not happy. The office has been told.')
            await load()
          }} />
      )}
    </div>
  )
}

function SignSheet({ myName, onClose, onDone }: {
  myName: string
  onClose: () => void
  onDone: (r: { techSig: string | null; clientName: string; clientSig: string | null; comment: string; outcome: 'signed' | 'not_happy' }) => Promise<void>
}) {
  const [techSig, setTechSig] = useState<string | null>(null)
  const [clientSig, setClientSig] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finish(outcome: 'signed' | 'not_happy') {
    setBusy(true); setError(null)
    try {
      await onDone({ techSig, clientName, clientSig, comment, outcome })
      onClose()
    } catch (e) { setError(signoffError(e instanceof Error ? e.message : String(e))) } finally { setBusy(false) }
  }
  const input = 'w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-background w-full sm:max-w-lg max-h-[94vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[16px] font-semibold">Client signs</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close"><span className="material-icons">close</span></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 [&>*]:shrink-0">
          {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-[13px] text-text-secondary">Hand the phone to the client. They see the report above; no prices.</p>
          <label className="text-[12px] font-medium text-text-secondary">Name of the person signing
            <input className={`${input} mt-1`} value={clientName} onChange={e => setClientName(e.target.value)} autoComplete="off" />
          </label>
          <SignaturePad onChange={setClientSig} label="Client signs here" />
          <label className="text-[12px] font-medium text-text-secondary">Comment (optional)
            <textarea rows={2} className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-xl text-[14px]" value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} />
          </label>
          <p className="text-[12px] text-text-secondary">You sign for the company{myName ? ` (${myName})` : ''}:</p>
          <SignaturePad onChange={setTechSig} label="Your signature" height={120} />
          <button type="button" disabled={busy || clientName.trim().length < 2 || !clientSig} onClick={() => void finish('signed')} className="btn-primary h-12 text-[15px]">{busy ? 'Saving…' : 'Sign'}</button>
          <button type="button" disabled={busy || clientName.trim().length < 2} onClick={() => void finish('not_happy')} className="btn-outlined h-12 text-[14px]">Not happy · save their reason</button>
        </div>
      </div>
    </div>
  )
}
