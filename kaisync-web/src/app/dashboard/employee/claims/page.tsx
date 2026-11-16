'use client'

/**
 * My claims (board "The team side", 1 and 2): travel and receipts, phone first. Travel trips are suggested from the
 * day's clock-ins when they have positions; the person confirms the km. Waiting or queried claims can be changed.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import { signWorkforceMedia } from '@/lib/media-read'
import { formatCurrency } from '@/lib/currencies'
import {
  KIND_ICON, KIND_LABEL, STATUS, cancelClaim, claimDay, listMyClaims, saveClaim, suggestTrips, todaySA, uploadReceipt,
  type Claim, type ClaimInput, type ClaimKind, type TripSuggestion,
} from '@/lib/claims'
import { cn } from '@/lib/utils'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab } from '@/components/ui/StatusFilterTabs'
import { statusTab } from '@/components/ui/MoneyListFilters'

const MY_TABS = [
  TAB_ALL,
  statusTab('waiting', 'Waiting', ['submitted'], 'amber'),
  statusTab('queried', 'Queried', ['queried'], 'red'),
  statusTab('approved', 'Approved', ['approved'], 'blue'),
  statusTab('paid', 'Paid', ['paid'], 'green'),
  statusTab('rejected', 'Rejected', ['rejected', 'cancelled'], 'gray'),
]

type Who = { companyId: string; employeeId: string; sessionToken: string | null }
type Job = { id: string; job_code: string | null; title: string | null }

const KINDS: ClaimKind[] = ['travel', 'toll', 'parking', 'meal', 'parts', 'other']
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })

export default function MyClaimsPage() {
  const allowed = useEmployeeModuleGate('payroll')
  const [who, setWho] = useState<Who | null>(null)
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [kmRate, setKmRate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [editing, setEditing] = useState<Claim | 'new' | null>(null)
  const [tab, setTab] = useState('all')

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member?.employeeId) { setError('Could not find your employee profile. Please sign in again.'); setClaims([]); return }
    const w = { companyId: member.companyId, employeeId: member.employeeId, sessionToken: getCodeSession()?.session_token ?? member.sessionToken ?? null }
    setWho(w)
    const r = await listMyClaims(supabase, w)
    if (!r.ok) { setError(r.message); setClaims([]); return }
    setError(null); setClaims(r.claims); setJobs(r.jobs); setKmRate(r.kmRate)
  }, [])

  useEffect(() => {
    if (!allowed) return
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [allowed, load])

  const owed = (claims ?? []).filter(c => c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0)
  const counts = countByStatusTab(claims ?? [], MY_TABS)
  const shown = filterByStatusTab(claims ?? [], MY_TABS, tab)
  const canChange = (c: Claim) => c.status === 'submitted' || c.status === 'queried'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">My claims</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">
            Travel in your own car, tolls, parking, meals away and parts you paid for{owed > 0 ? ` · approved, still to be paid to you: ${formatCurrency(owed, 'ZAR')}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => { setNote(null); setEditing('new') }} className="btn-primary h-9 px-3 text-[13px]">+ New claim</button>
      </div>
      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <StatusFilterTabs tabs={MY_TABS} value={tab} counts={counts} onChange={setTab} />
      </div>
      {error && <p className="text-[12.5px] text-error bg-error/10 px-4 py-2 border-b border-divider" role="alert">{error}</p>}
      {note && <p className="text-[12.5px] text-emerald-800 bg-emerald-50 px-4 py-2 border-b border-divider" role="status">{note}</p>}

      <div className="flex-1 overflow-auto">
        {claims === null ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : (
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>Date</th>
                <th className={`${MONEY_TH} text-left`}>Type</th>
                <th className={`${MONEY_TH} text-left`}>Details</th>
                <th className={`${MONEY_TH} text-left`}>Job</th>
                <th className={`${MONEY_TH} text-left`}>Status</th>
                <th className={`${MONEY_TH} text-right`}>Amount</th>
                <th className={`${MONEY_TH} text-right`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} className={cn('border-b border-divider transition-colors', canChange(c) ? 'cursor-pointer hover:bg-surface-elevated' : '')}
                  onClick={() => { if (canChange(c)) { setNote(null); setEditing(c) } }}>
                  <td className={`${MONEY_TD} text-text-secondary`}>{fmtDay(c.claim_date)}</td>
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{KIND_LABEL[c.kind]}</td>
                  <td className={`${MONEY_TD} text-text-secondary max-w-[260px] truncate`}>
                    {c.kind === 'travel'
                      ? [`${Number(c.km ?? 0)} km`, c.vehicle === 'company' ? 'company car' : null, (c.from_place || c.to_place) ? `${c.from_place ?? '…'} → ${c.to_place ?? '…'}` : null].filter(Boolean).join(' · ')
                      : c.description || '—'}
                    {c.manager_note && <span className="block text-red-800 whitespace-normal">“{c.manager_note}”</span>}
                  </td>
                  <td className={MONEY_TD}>{c.job_code ?? '—'}</td>
                  <td className={MONEY_TD}><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span></td>
                  <td className={`${MONEY_TD} text-right font-medium`}>{c.kind === 'travel' && c.vehicle === 'company' ? '—' : formatCurrency(Number(c.amount), 'ZAR')}</td>
                  <td className={`${MONEY_TD} text-right`} onClick={e => e.stopPropagation()}>
                    {canChange(c) && (
                      <span className="inline-flex gap-3">
                        <button type="button" className="text-primary font-medium" onClick={() => { setNote(null); setEditing(c) }}>{c.status === 'queried' ? 'Fix' : 'Change'}</button>
                        <button type="button" className="text-text-secondary" onClick={async () => {
                          if (!who) return
                          const r = await cancelClaim(createClient(), who, c.id)
                          if (!r.ok) setError(r.message); else { setNote('Claim cancelled.'); await load() }
                        }}>Cancel</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={7} className="text-center text-[13px] text-text-secondary py-10">
                  {(claims ?? []).length === 0 ? 'No claims yet. Tap New claim after a trip or when you pay for something for work.' : 'No claims here'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editing && who && (
        <ClaimSheet who={who} claim={editing === 'new' ? null : editing} jobs={jobs} kmRate={kmRate}
          onClose={() => setEditing(null)}
          onSaved={async (text) => { setEditing(null); setNote(text); await load() }} />
      )}
    </div>
  )
}

function ClaimSheet({ who, claim, jobs, kmRate, onClose, onSaved }: {
  who: Who; claim: Claim | null; jobs: Job[]; kmRate: number | null; onClose: () => void; onSaved: (text: string) => Promise<void>
}) {
  const [kind, setKind] = useState<ClaimKind>(claim?.kind ?? 'travel')
  const [date, setDate] = useState(claim?.claim_date ?? todaySA())
  const [jobId, setJobId] = useState(claim?.job_id ?? '')
  const [from, setFrom] = useState(claim?.from_place ?? '')
  const [to, setTo] = useState(claim?.to_place ?? '')
  const [km, setKm] = useState(claim?.km != null ? String(claim.km) : '')
  const [vehicle, setVehicle] = useState<'own' | 'company'>(claim?.vehicle ?? 'own')
  const [amount, setAmount] = useState(claim && claim.kind !== 'travel' ? String(claim.amount) : '')
  const [desc, setDesc] = useState(claim?.description ?? '')
  const [receipt, setReceipt] = useState<string | null>(claim?.receipt_path ?? null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [billClient, setBillClient] = useState(claim?.bill_to_client ?? false)
  const [trips, setTrips] = useState<TripSuggestion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Suggested trips for the chosen day (travel only).
  useEffect(() => {
    if (kind !== 'travel') return
    let live = true
    void claimDay(createClient(), who, date).then(p => { if (live) setTrips(suggestTrips(p)) })
    return () => { live = false }
  }, [kind, date, who])

  useEffect(() => {
    if (!receipt) return
    let live = true
    void signWorkforceMedia(createClient(), receipt).then(u => { if (live) setReceiptUrl(u) })
    return () => { live = false }
  }, [receipt])

  const kmN = Number(km.replace(',', '.'))
  const amtN = Number(amount.replace(/\s/g, '').replace(',', '.'))
  const travelAmount = kind === 'travel' && vehicle === 'own' && kmRate != null && kmN > 0 ? Math.round(kmN * kmRate * 100) / 100 : null
  const valid = kind === 'travel' ? kmN > 0 && (vehicle === 'company' || kmRate != null) : amtN > 0
  const input = 'mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]'

  async function save() {
    setBusy(true); setError(null)
    const body: ClaimInput = {
      ...(claim ? { id: claim.id } : {}), kind, claim_date: date, job_id: jobId || null, description: desc,
      from_place: kind === 'travel' ? from : undefined, to_place: kind === 'travel' ? to : undefined,
      km: kind === 'travel' ? kmN : null, vehicle: kind === 'travel' ? vehicle : undefined,
      amount: kind === 'travel' ? null : amtN, receipt_path: receipt, bill_to_client: billClient,
    }
    const r = await saveClaim(createClient(), who, body)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    await onSaved(claim ? 'Claim updated and sent again.' : 'Claim sent. Your manager will see it.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Claim">
      <div className="bg-background w-full sm:max-w-lg max-h-[94vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[16px] font-semibold">{claim ? 'Change claim' : 'New claim'}</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close"><span className="material-icons">close</span></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 [&>*]:shrink-0">
          {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
          {claim?.manager_note && <p className="text-[13px] text-red-800 bg-red-50 rounded-lg px-3 py-2">Your manager asked: “{claim.manager_note}”</p>}

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What are you claiming?">
            {KINDS.map(k => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={cn('h-16 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium',
                  kind === k ? 'border-primary bg-primary/5 text-primary' : 'border-divider text-text-primary')}>
                <span className="material-icons text-[20px]">{KIND_ICON[k]}</span>{KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12px] font-medium text-text-secondary">Date
              <input type="date" value={date} max={todaySA()} onChange={e => setDate(e.target.value)} className={input} />
            </label>
            <label className="text-[12px] font-medium text-text-secondary">Job (optional)
              <select value={jobId} onChange={e => setJobId(e.target.value)} className={input}>
                <option value="">No job</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{[j.job_code, j.title].filter(Boolean).join(' · ')}</option>)}
              </select>
            </label>
          </div>

          {kind === 'travel' ? (
            <>
              {trips && trips.length > 0 && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2">
                  <p className="text-[12.5px] font-semibold text-text-primary">Trips from your clock-ins that day</p>
                  {trips.map((t, i) => (
                    <button key={i} type="button" onClick={() => { setFrom(t.from); setTo(t.to); setKm(String(t.km)); if (t.job_id) setJobId(t.job_id) }}
                      className="text-left rounded-lg bg-surface border border-divider px-3 py-2 text-[13px]">
                      <b>{t.from} → {t.to}</b><br />
                      <span className="text-text-secondary">about {t.km} km{t.job_code ? ` · ${t.job_code}` : ''} · tap to use, then check the km</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[12px] font-medium text-text-secondary">From
                  <input value={from} onChange={e => setFrom(e.target.value)} className={input} placeholder="e.g. Office" maxLength={200} />
                </label>
                <label className="text-[12px] font-medium text-text-secondary">To
                  <input value={to} onChange={e => setTo(e.target.value)} className={input} placeholder="e.g. Apex Mine" maxLength={200} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 items-end">
                <label className="text-[12px] font-medium text-text-secondary">Kilometres
                  <input value={km} onChange={e => setKm(e.target.value)} inputMode="decimal" className={input} placeholder="0" />
                </label>
                <div className="flex rounded-xl border border-divider overflow-hidden h-12" role="radiogroup" aria-label="Which vehicle">
                  {(['own', 'company'] as const).map(v => (
                    <button key={v} type="button" role="radio" aria-checked={vehicle === v} onClick={() => setVehicle(v)}
                      className={cn('flex-1 text-[12.5px] font-semibold', vehicle === v ? 'bg-primary text-white' : 'bg-surface text-text-secondary')}>
                      {v === 'own' ? 'My car' : 'Company car'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[12.5px] text-text-secondary bg-surface-elevated rounded-lg px-3 py-2">
                {vehicle === 'company' ? 'A company vehicle counts as travel time and job cost, but nothing is paid out per km.'
                  : kmRate == null ? 'Your company hasn’t set a rate per km yet, so travel in your own car can’t be claimed yet. Ask the office.'
                  : <>{kmN > 0 ? `${kmN} km × ${formatCurrency(kmRate, 'ZAR')}/km = ` : `${formatCurrency(kmRate, 'ZAR')} per km`}{travelAmount != null && <b>{formatCurrency(travelAmount, 'ZAR')}</b>}</>}
              </p>
            </>
          ) : (
            <>
              <label className="text-[12px] font-medium text-text-secondary">Amount (incl. VAT)
                <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={input} placeholder="0,00" />
              </label>
              <label className="text-[12px] font-medium text-text-secondary">What was it for?
                <input value={desc} onChange={e => setDesc(e.target.value)} className={input} placeholder={kind === 'parts' ? 'e.g. fittings for the geyser' : 'e.g. N1 toll'} maxLength={500} />
              </label>
              <div className="flex items-center gap-3">
                <label className={cn('h-12 px-4 rounded-xl border border-divider flex items-center gap-2 text-[14px] font-medium cursor-pointer', uploading && 'opacity-60')}>
                  <span className="material-icons text-[20px]">photo_camera</span>{receipt ? 'Change receipt' : 'Photo of the receipt'}
                  <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" disabled={uploading}
                    onChange={async e => {
                      const f = e.target.files?.[0]; if (!f) return
                      setUploading(true); setError(null)
                      const p = await uploadReceipt(createClient(), who, f)
                      setUploading(false)
                      if (!p) setError('The receipt could not be uploaded. Check your signal and try again.'); else { setReceiptUrl(null); setReceipt(p) }
                    }} />
                </label>
                {uploading && <span className="text-[12.5px] text-text-secondary">Uploading…</span>}
                {receiptUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={receiptUrl} target="_blank" rel="noreferrer"><img src={receiptUrl} alt="Receipt" className="h-12 w-12 object-cover rounded-lg border border-divider" /></a>
                )}
              </div>
            </>
          )}

          {jobId && (
            <label className="flex items-center gap-3 min-h-[44px] text-[13.5px]">
              <input type="checkbox" checked={billClient} onChange={e => setBillClient(e.target.checked)} className="w-5 h-5" />
              The client pays this back (put it on their invoice)
            </label>
          )}
        </div>
        <footer className="px-4 py-3 border-t border-divider flex gap-2 justify-end shrink-0">
          <button type="button" onClick={onClose} className="btn-outlined h-12 px-4 text-[14px]">Cancel</button>
          <button type="button" disabled={busy || uploading || !valid} onClick={() => void save()} className="btn-primary h-12 px-5 text-[14px] disabled:opacity-50">{busy ? 'Sending…' : claim ? 'Save and send' : 'Send claim'}</button>
        </footer>
      </div>
    </div>
  )
}
