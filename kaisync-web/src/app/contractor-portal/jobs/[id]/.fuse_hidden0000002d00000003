'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ContractorPortalShell } from '@/components/ContractorPortalShell'
import { useRequireContractorPortalSession } from '@/lib/contractor-portal/use-session'
import {
  buildVisitSessions,
  createIncident,
  getJobMessages,
  getOpenVisit,
  getVisitHistory,
  jobStatusLabel,
  listJobs,
  sendJobMessage,
  siteSignIn,
  siteSignOut,
  submitInvoice,
  uploadJobPhoto,
} from '@/lib/contractor-portal/api'
import { captureLocation } from '@/lib/contractor-portal/geo'
import { moneyZAR } from '@/lib/contractor-portal/types'
import type {
  ContractorJob,
  JobMessage,
  JobSiteSessionRow,
  OpenVisit,
} from '@/lib/contractor-portal/types'

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function ContractorJobDetailPage() {
  const { session, ready } = useRequireContractorPortalSession()
  const params = useParams()
  const router = useRouter()
  const jobId = params.id as string

  const [job, setJob] = useState<ContractorJob | null>(null)
  const [openVisit, setOpenVisit] = useState<OpenVisit | null>(null)
  const [sessions, setSessions] = useState<JobSiteSessionRow[]>([])
  const [messages, setMessages] = useState<JobMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)
  const [siteBusy, setSiteBusy] = useState(false)
  const [siteHint, setSiteHint] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState<'before' | 'after' | null>(null)
  const [incidentText, setIncidentText] = useState('')
  const [incidentBusy, setIncidentBusy] = useState(false)
  const [incidentDone, setIncidentDone] = useState(false)
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceDone, setInvoiceDone] = useState(false)
  const beforeRef = useRef<HTMLInputElement>(null)
  const afterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!session || !jobId) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.contractor_id, jobId])

  async function load() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const [jobs, visit, history, msgs] = await Promise.all([
        listJobs(session.company_code, session.contractor_code),
        getOpenVisit(session.company_code, session.contractor_code).catch(() => null),
        getVisitHistory(session.company_code, session.contractor_code, jobId),
        getJobMessages(session.company_code, session.contractor_code, jobId).catch(() => []),
      ])
      const found = jobs.find(j => j.id === jobId) ?? null
      setJob(found)
      setOpenVisit(visit)
      setSessions(buildVisitSessions(history))
      setMessages(msgs)
      if (!found) setError('This job is not available on your portal.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load job.')
    }
    setLoading(false)
  }

  const isOnThisJob = openVisit?.job_id === jobId
  const siteStatus = isOnThisJob && openVisit?.sign_in_at
    ? `On site since ${new Date(openVisit.sign_in_at).toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' })}`
    : openVisit?.job_id
      ? 'Signed in on another job'
      : 'Not on site'

  const totalHours = useMemo(
    () => sessions.reduce((s, x) => s + x.total_hours, 0),
    [sessions],
  )
  const hoursLabel = totalHours > 0
    ? `${totalHours.toFixed(1)} hours on this job`
    : 'No completed visits yet'

  async function onSend() {
    if (!session || !msgText.trim()) return
    setSending(true)
    setError(null)
    try {
      await sendJobMessage(
        session.company_code,
        session.contractor_code,
        jobId,
        msgText,
        session.contractor_name,
      )
      setMsgText('')
      const msgs = await getJobMessages(session.company_code, session.contractor_code, jobId)
      setMessages(msgs)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send message.')
    }
    setSending(false)
  }

  async function onSignIn() {
    if (!session || siteBusy) return
    // MAUI DisplayPromptAsync — cancel aborts
    const name = window.prompt('Who is on site? (optional)', session.contractor_name || '')
    if (name === null) return

    setSiteBusy(true)
    setSiteHint('Getting location…')
    setError(null)
    try {
      const loc = await captureLocation()
      setSiteHint(loc.address ? `Signing in · ${loc.address}` : 'Signing in…')
      await siteSignIn(session.company_code, session.contractor_code, jobId, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        address: loc.address,
        reportedByName: name.trim() || null,
      })
      setSiteHint(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setSiteHint(null)
    }
    setSiteBusy(false)
  }

  async function onSignOut() {
    if (!session || siteBusy) return
    setSiteBusy(true)
    setSiteHint('Getting location…')
    setError(null)
    try {
      const loc = await captureLocation()
      setSiteHint(loc.address ? `Signing out · ${loc.address}` : 'Signing out…')
      await siteSignOut(session.company_code, session.contractor_code, jobId, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        address: loc.address,
      })
      setSiteHint(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-out failed.')
      setSiteHint(null)
    }
    setSiteBusy(false)
  }

  async function onPhotoSelected(phase: 'before' | 'after', file: File | null) {
    if (!session || !file) return
    setPhotoBusy(phase)
    setError(null)
    try {
      await uploadJobPhoto({
        companyCode: session.company_code,
        contractorCode: session.contractor_code,
        companyId: session.company_id,
        jobId,
        phase,
        file,
      })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Photo upload failed.')
    }
    setPhotoBusy(null)
    if (phase === 'before' && beforeRef.current) beforeRef.current.value = ''
    if (phase === 'after' && afterRef.current) afterRef.current.value = ''
  }

  async function onReportIncident() {
    if (!session) return
    const desc = incidentText.trim()
    if (!desc) {
      setError('Describe the incident before reporting.')
      return
    }
    const name = window.prompt('Your name (optional):', session.contractor_name || '')
    if (name === null) return

    setIncidentBusy(true)
    setError(null)
    setIncidentDone(false)
    try {
      await createIncident({
        companyCode: session.company_code,
        contractorCode: session.contractor_code,
        jobId,
        description: desc,
        severity: 'medium',
        reportedByName: name.trim() || null,
      })
      setIncidentText('')
      setIncidentDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not report incident.')
    }
    setIncidentBusy(false)
  }

  async function onSubmitInvoice() {
    if (!session) return
    const amount = Number(invoiceAmount)
    if (!(amount > 0)) {
      setError('Enter the invoice amount before submitting.')
      return
    }
    if (!window.confirm(`Submit an invoice for R${amount.toFixed(2)} on this job?`)) return

    setInvoiceBusy(true)
    setError(null)
    setInvoiceDone(false)
    try {
      await submitInvoice({
        companyCode: session.company_code,
        contractorCode: session.contractor_code,
        jobId,
        amount,
        invoiceReference: invoiceRef.trim() || null,
        notes: invoiceNotes.trim() || null,
      })
      setInvoiceAmount('')
      setInvoiceRef('')
      setInvoiceNotes('')
      setInvoiceDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not submit invoice.')
    }
    setInvoiceBusy(false)
  }

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <ContractorPortalShell session={session}>
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-16">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/contractor-portal/home?tab=jobs')}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-icons">arrow_back</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-white text-[18px] font-bold truncate">{job?.title ?? 'Job'}</h1>
            {job?.job_code && <p className="text-[12px] text-slate-500">{job.job_code}</p>}
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p className="text-[13px] text-red-400 font-semibold">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-[14px]">Loading…</div>
        ) : !job ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-slate-400 text-[14px]">Job not found.</p>
            <button type="button" onClick={() => router.push('/contractor-portal/home?tab=jobs')} className="text-blue-400 text-[13px] hover:underline">
              Back to jobs
            </button>
          </div>
        ) : (
          <>
            <Section title="Overview">
              <Row label="Status" value={jobStatusLabel(job.status)} />
              <Row label="Job code" value={job.job_code || '—'} />
              <Row label="Your rate / cost" value={moneyZAR(job.contractor_cost)} />
            </Section>

            <Section title="Site sign-in">
              <p className="text-[14px] text-white font-medium">{siteStatus}</p>
              <p className="text-[12px] text-slate-500 mt-1">{hoursLabel}</p>
              {siteHint && (
                <p className="text-[12px] text-blue-300 mt-2">{siteHint}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {!isOnThisJob && (
                  <button
                    type="button"
                    onClick={() => void onSignIn()}
                    disabled={siteBusy}
                    className="h-10 px-4 rounded-xl bg-blue-600 text-white font-semibold text-[13px] disabled:opacity-50"
                  >
                    {siteBusy ? 'Working…' : 'Sign in on site'}
                  </button>
                )}
                {isOnThisJob && (
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    disabled={siteBusy}
                    className="h-10 px-4 rounded-xl font-semibold text-[13px] text-white disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
                  >
                    {siteBusy ? 'Working…' : 'Sign out'}
                  </button>
                )}
              </div>
              {openVisit?.job_id && !isOnThisJob && (
                <p className="text-[12px] text-amber-300/90 mt-2">
                  Signed in on another job{openVisit.job_title ? `: ${openVisit.job_title}` : ''}. Sign out there before signing in here.
                </p>
              )}
            </Section>

            <Section title="Visit history">
              {sessions.length === 0 ? (
                <p className="text-[13px] text-slate-500">No visits recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s, i) => (
                    <div
                      key={`${s.sign_in_at}-${i}`}
                      className="flex justify-between gap-3 text-[13px] rounded-lg px-3 py-2"
                      style={{ background: 'rgba(255,255,255,0.04)' }}
                    >
                      <div>
                        <p className="text-slate-200">{fmtDT(s.sign_in_at)} → {s.is_open ? 'On site' : fmtDT(s.sign_out_at)}</p>
                      </div>
                      <p className={`font-semibold whitespace-nowrap ${s.is_open ? 'text-green-300' : 'text-slate-300'}`}>
                        {s.hours_display}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Photos">
              <PhotoGrid label="Before" urls={job.photo_urls_before ?? []} />
              <PhotoGrid label="After" urls={job.photo_urls_after ?? []} />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className={`h-10 rounded-xl flex items-center justify-center text-[13px] font-semibold cursor-pointer ${
                  photoBusy === 'before' ? 'opacity-50' : 'bg-blue-600 text-white'
                }`}>
                  {photoBusy === 'before' ? 'Uploading…' : 'Add before'}
                  <input
                    ref={beforeRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={photoBusy != null}
                    onChange={e => void onPhotoSelected('before', e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className={`h-10 rounded-xl flex items-center justify-center text-[13px] font-semibold cursor-pointer ${
                  photoBusy === 'after' ? 'opacity-50' : ''
                }`} style={photoBusy === 'after' ? undefined : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}>
                  {photoBusy === 'after' ? 'Uploading…' : 'Add after'}
                  <input
                    ref={afterRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={photoBusy != null}
                    onChange={e => void onPhotoSelected('after', e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </Section>

            <Section title="Message manager">
              <div className="space-y-2 max-h-64 overflow-y-auto mb-3">
                {messages.length === 0 ? (
                  <p className="text-[13px] text-slate-500">No messages yet.</p>
                ) : (
                  messages.map(m => (
                    <div
                      key={m.id || `${m.created_at}-${m.body.slice(0, 8)}`}
                      className={`rounded-xl px-3 py-2 max-w-[90%] ${m.is_contractor ? 'ml-auto bg-blue-600/30' : 'mr-auto'}`}
                      style={!m.is_contractor ? { background: 'rgba(255,255,255,0.06)' } : undefined}
                    >
                      <p className="text-[11px] font-semibold text-slate-400 mb-0.5">
                        {m.is_contractor ? 'You' : (m.sender_display_name || 'Manager')} · {fmtDT(m.created_at)}
                      </p>
                      <p className="text-[13px] text-white whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <textarea
                  className="flex-1 min-h-[44px] max-h-28 px-3 py-2 rounded-xl text-[13px] text-white resize-y"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  placeholder="Type a message…"
                  value={msgText}
                  onChange={e => setMsgText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void onSend()}
                  disabled={sending || !msgText.trim()}
                  className="h-11 px-4 rounded-xl bg-blue-600 text-white font-semibold text-[13px] disabled:opacity-50 shrink-0"
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            </Section>

            <Section title="Incident">
              <textarea
                className="w-full min-h-[80px] px-3 py-2 rounded-xl text-[13px] text-white resize-y"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                placeholder="Describe issue…"
                value={incidentText}
                onChange={e => { setIncidentText(e.target.value); setIncidentDone(false) }}
              />
              <button
                type="button"
                onClick={() => void onReportIncident()}
                disabled={incidentBusy || !incidentText.trim()}
                className="h-10 px-4 rounded-xl font-semibold text-[13px] text-white disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                {incidentBusy ? 'Reporting…' : 'Report incident'}
              </button>
              {incidentDone && (
                <p className="text-[12px] text-green-300">Incident sent to the manager.</p>
              )}
            </Section>

            <Section title="Submit invoice">
              <p className="text-[12px] text-slate-500">
                Creates a pending payout for HR review. Use your agreed rate for this job.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase">Amount (ZAR) *</label>
                  <input
                    className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    inputMode="decimal"
                    value={invoiceAmount}
                    onChange={e => { setInvoiceAmount(e.target.value); setInvoiceDone(false) }}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase">Invoice reference</label>
                  <input
                    className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    value={invoiceRef}
                    onChange={e => setInvoiceRef(e.target.value)}
                    placeholder="INV-001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase">Notes</label>
                  <textarea
                    className="w-full min-h-[60px] px-3 py-2 rounded-xl text-[13px] text-white resize-y"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    value={invoiceNotes}
                    onChange={e => setInvoiceNotes(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void onSubmitInvoice()}
                  disabled={invoiceBusy}
                  className="h-10 px-4 rounded-xl bg-blue-600 text-white font-semibold text-[13px] disabled:opacity-50"
                >
                  {invoiceBusy ? 'Submitting…' : 'Submit invoice'}
                </button>
                {invoiceDone && (
                  <p className="text-[12px] text-green-300">
                    Invoice submitted for HR review. Track it under Payments.
                  </p>
                )}
              </div>
            </Section>
          </>
        )}
      </div>
    </ContractorPortalShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  )
}

function PhotoGrid({ label, urls }: { label: string; urls: string[] }) {
  return (
    <div className="mb-3">
      <p className="text-[12px] font-semibold text-slate-400 mb-1.5">{label}</p>
      {urls.length === 0 ? (
        <p className="text-[12px] text-slate-600">None</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url, i) => (
            <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" className="rounded-lg overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`${label} ${i + 1}`} className="w-full h-20 object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
