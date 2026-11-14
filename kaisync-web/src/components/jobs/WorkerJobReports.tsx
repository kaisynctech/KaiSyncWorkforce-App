'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { enqueueJobCard, enqueueVisitSignoff } from '@/lib/offline/job-queue'
import { networkLooksDown } from '@/lib/offline/meta'
import { ReportForm, ReportView, inputFromReport } from '@/components/jobs/ReportParts'
import { workerListReports, workerSaveReport, type JobReport, type ReportInput } from '@/lib/job-reports'
import { sastDate, signoffError } from '@/lib/job-report'
import { SignaturePad } from '@/components/SignaturePad'

type VisitSign = { id: string; scope: 'visit' | 'job'; report_id: string | null; visit_date: string | null; status: string; client_name: string | null; client_comment: string | null }
/** What the client signs for at the end of a visit (kept with the sign-off). */
type VisitTarget = { reportId: string | null; date: string; work: string }

type Props = { companyId: string; employeeId: string; jobId: string; sessionToken: string | null; onJobFinished?: () => void }

/**
 * Technician: every report on this job (theirs and their team's), a new report per visit, and edit their own.
 * Without signal the report is kept on the phone and sent as a job card when back online
 * (the database turns that job card into a report).
 */
export function WorkerJobReports({ companyId, employeeId, jobId, sessionToken, onJobFinished }: Props) {
  const [reports, setReports] = useState<JobReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<JobReport | 'new' | null>(null)
  // Client sign-off at the end of each visit (when the job or company asks for it).
  const [signOn, setSignOn] = useState(false)
  const [signs, setSigns] = useState<VisitSign[]>([])
  const [signing, setSigning] = useState<VisitTarget | null>(null)

  const load = useCallback(async () => {
    const res = await workerListReports(createClient(), companyId, employeeId, jobId, sessionToken)
    if (!res.ok) {
      setError(networkLooksDown(res.message) ? 'No signal: reports will show when you are back online.' : res.message)
      setReports(prev => prev ?? [])
      return
    }
    setError(null)
    setReports(res.data)
    setEditing(prev => prev ?? (res.data.length === 0 ? 'new' : null))
    const so = await createClient().rpc('employee_list_job_signoffs', {
      p_company_id: companyId, p_employee_id: employeeId, p_job_id: jobId, p_session_token: sessionToken,
    })
    if (!so.error && so.data) {
      const d = so.data as { visit_signoff: boolean; signoffs: VisitSign[] }
      setSignOn(!!d.visit_signoff)
      setSigns((d.signoffs ?? []).filter(x => x.scope === 'visit'))
    }
    return res.data
  }, [companyId, employeeId, jobId, sessionToken])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  async function saveOffline(value: ReportInput) {
    await enqueueJobCard({
      companyId, employeeId, jobId,
      payload: {
        work_performed: value.workPerformed, materials_used: value.materialsUsed || null,
        start_time: value.startTime, end_time: value.endTime, is_completed: value.marksJobComplete,
        photo_urls: [], client_signature_url: null,
      },
    })
    setEditing(null)
    setNotice('No signal: the report is saved on this phone and will be sent when you are back online.')
    if (signOn) setSigning({ reportId: null, date: sastDate(new Date().toISOString()), work: value.workPerformed })
  }

  async function save(value: ReportInput) {
    setBusy(true); setError(null); setNotice(null)
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) { await saveOffline(value); return }
      const res = await workerSaveReport(createClient(), companyId, employeeId, jobId, value, sessionToken,
        editing && editing !== 'new' ? editing.id : undefined)
      if (!res.ok) {
        if (networkLooksDown(res.message)) { await saveOffline(value); return }
        setError(res.message); return
      }
      const wasNew = editing === 'new'
      setEditing(null)
      setNotice('Report saved. The office can see it now.')
      const fresh = await load()
      if (signOn && wasNew && fresh) {
        const mine = fresh.filter(r => r.mine).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
        if (mine) setSigning({ reportId: mine.id, date: mine.report_date, work: mine.work_performed })
      }
      if (value.marksJobComplete) onJobFinished?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface border border-divider rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <p className="section-label">Work reports</p>
        {editing === null && (
          <button type="button" onClick={() => { setNotice(null); setEditing('new') }}
            className="bg-primary text-white font-semibold text-[12px] px-3 h-8 rounded-lg">
            New report
          </button>
        )}
      </div>
      <div className="px-4 py-2">
        <p className="text-[12px] text-text-secondary py-1">
          Write a report for each visit: what you did, what you found and what is still outstanding. The office (and the client) can read it.
        </p>
        {error && <p className="text-[12px] text-error py-1" role="alert">{error}</p>}
        {notice && !error && <p className="text-[12px] text-success py-1" aria-live="polite">{notice}</p>}
        {editing !== null && (
          <div className="py-2">
            <ReportForm busy={busy} onSave={v => void save(v)}
              initial={editing === 'new' ? undefined : inputFromReport(editing)}
              saveLabel={editing === 'new' ? 'Submit report' : 'Save changes'}
              onCancel={reports && reports.length > 0 ? () => setEditing(null) : undefined} />
          </div>
        )}
        {reports === null ? (
          <p className="text-[13px] text-text-secondary py-2">Loading…</p>
        ) : (
          <div className="divide-y divide-divider">
            {reports.map(r => {
              const so = signs.find(x => x.report_id === r.id)
              return (
                <div key={r.id}>
                  <ReportView report={r} actions={r.mine && editing === null ? (
                    <button type="button" className="text-primary" onClick={() => { setNotice(null); setEditing(r) }}>Edit</button>
                  ) : undefined} />
                  {so ? (
                    <p className={`text-[12px] pb-2 ${so.status === 'not_happy' ? 'text-error' : 'text-success'}`}>
                      {so.status === 'not_happy' ? `${so.client_name ?? 'Client'} is not happy${so.client_comment ? `: ${so.client_comment}` : ''}` : `Signed by ${so.client_name ?? 'the client'}`}
                    </p>
                  ) : signOn && r.mine && editing === null ? (
                    <button type="button" onClick={() => setSigning({ reportId: r.id, date: r.report_date, work: r.work_performed })}
                      className="mb-2 h-10 px-3 rounded-lg border border-divider text-[13px] font-semibold text-primary">Client sign-off for this visit</button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {signing && (
        <VisitSignSheet target={signing} companyId={companyId} employeeId={employeeId} jobId={jobId} sessionToken={sessionToken}
          onClose={() => setSigning(null)}
          onDone={async (msg) => { setSigning(null); setNotice(msg); await load() }} />
      )}
    </div>
  )
}

const SIG_KEY = (employeeId: string) => `kaisync.techsig.${employeeId}`
function rememberedSignature(employeeId: string): string | null {
  try { return window.localStorage.getItem(SIG_KEY(employeeId)) } catch { return null }
}

/**
 * End of visit: the client types their name, signs (or says they are not happy, with the reason), then the technician
 * signs (kept on this phone so it is one tap next time). Works without signal: it is sent when back online.
 */
function VisitSignSheet({ target, companyId, employeeId, jobId, sessionToken, onClose, onDone }: {
  target: VisitTarget; companyId: string; employeeId: string; jobId: string; sessionToken: string | null
  onClose: () => void; onDone: (message: string) => Promise<void>
}) {
  const [clientName, setClientName] = useState('')
  const [clientSig, setClientSig] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [saved] = useState<string | null>(() => typeof window === 'undefined' ? null : rememberedSignature(employeeId))
  const [useSaved, setUseSaved] = useState(true)
  const [techSig, setTechSig] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notHappy, setNotHappy] = useState(false)

  async function finish(outcome: 'signed' | 'not_happy') {
    setBusy(true); setError(null)
    const tech = useSaved && saved ? saved : techSig
    if (tech && !(useSaved && saved)) { try { window.localStorage.setItem(SIG_KEY(employeeId), tech) } catch { /* not kept */ } }
    const payload = {
      report_id: target.reportId, visit_date: target.date, content: { work: target.work },
      technician_signature: tech, client_name: clientName.trim(), client_signature: outcome === 'signed' ? clientSig : null,
      client_comment: comment.trim() || null, outcome,
    }
    const done = outcome === 'signed' ? 'Signed by the client. The office can see it.' : 'Saved. The office has been told the client is not happy.'
    const queue = async () => {
      await enqueueVisitSignoff({ companyId, employeeId, jobId, payload })
      await onDone('No signal: the sign-off is saved on this phone and will be sent when you are back online.')
    }
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) { await queue(); return }
      const { error: e } = await createClient().rpc('employee_save_visit_signoff', {
        p_company_id: companyId, p_employee_id: employeeId, p_job_id: jobId, p_report_id: payload.report_id,
        p_visit_date: payload.visit_date, p_content: payload.content, p_technician_signature: payload.technician_signature,
        p_client_name: payload.client_name, p_client_signature: payload.client_signature, p_client_comment: payload.client_comment,
        p_outcome: outcome, p_session_token: sessionToken,
      })
      if (e) {
        if (networkLooksDown(e.message)) { await queue(); return }
        setError(signoffError(e.message)); return
      }
      await onDone(done)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the sign-off.')
    } finally {
      setBusy(false)
    }
  }

  const nameOk = clientName.trim().length >= 2
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-background w-full sm:max-w-lg max-h-[94vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[16px] font-semibold">Client sign-off · this visit</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close"><span className="material-icons">close</span></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
          <div className="rounded-xl bg-surface border border-divider px-3 py-2">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Work done today</p>
            <p className="text-[13.5px] whitespace-pre-line line-clamp-6">{target.work || '—'}</p>
          </div>
          <p className="text-[13px] text-text-secondary">Hand the phone to the client.</p>
          <label className="text-[12px] font-medium text-text-secondary">Name of the person signing
            <input className="mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]" value={clientName} onChange={e => setClientName(e.target.value)} autoComplete="off" />
          </label>
          {!notHappy && <SignaturePad onChange={setClientSig} label="Client signs here" />}
          <label className="text-[12px] font-medium text-text-secondary">{notHappy ? 'What is wrong? (the office is told)' : 'Comment (optional)'}
            <textarea rows={notHappy ? 3 : 2} className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-xl text-[14px]" value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} />
          </label>
          <p className="text-[12px] font-medium text-text-secondary">Your signature</p>
          {saved && useSaved ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={saved} alt="Your saved signature" className="h-14 bg-white rounded-lg border border-divider px-2" />
              <button type="button" className="text-[13px] text-primary" onClick={() => setUseSaved(false)}>Sign again</button>
            </div>
          ) : <SignaturePad onChange={setTechSig} label="You sign here" height={120} />}
          {notHappy ? (
            <>
              <button type="button" disabled={busy || !nameOk || comment.trim().length < 3} onClick={() => void finish('not_happy')} className="h-12 rounded-xl bg-error text-white text-[15px] font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save: not happy'}</button>
              <button type="button" onClick={() => setNotHappy(false)} className="h-11 text-[14px] text-text-secondary">Back</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || !nameOk || !clientSig} onClick={() => void finish('signed')} className="h-12 rounded-xl bg-primary text-white text-[15px] font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Sign'}</button>
              <button type="button" onClick={() => setNotHappy(true)} className="h-11 rounded-xl border border-divider text-[14px]">Not happy</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
