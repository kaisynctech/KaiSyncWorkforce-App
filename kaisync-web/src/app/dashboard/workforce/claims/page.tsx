'use client'

/**
 * Workforce → Claims (board "The team side", 1 and 2). Managers approve, query or reject; HR marks approved claims paid
 * (outside payroll for now), which books money out. The km rate lives here too. Standard table: status tabs, column filters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { signWorkforceMedia } from '@/lib/media-read'
import { formatCurrency } from '@/lib/currencies'
import { KIND_LABEL, STATUS, claimStatus, decideClaims, markClaimsPaid, setKmRate, todaySA, type Claim } from '@/lib/claims'
import { loadPayVia, savePayVia, type PayVia } from '@/lib/pay-on-payslip'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab } from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter, MoneyHeaderFilter, DateHeaderFilter, StatusHeaderFilter, ResetFiltersButton, matchText, matchMoney, inDateRange, statusTab,
} from '@/components/ui/MoneyListFilters'

type Row = Claim & { who: string }
const TABS = [
  TAB_ALL,
  statusTab('decide', 'To decide', ['submitted', 'queried'], 'amber'),
  statusTab('topay', 'Approved', ['approved'], 'blue'),
  statusTab('paid', 'Paid', ['paid'], 'green'),
  statusTab('rejected', 'Rejected', ['rejected'], 'gray'),
]
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([id, label]) => ({ id, label }))
const STATUS_OPTIONS = (['submitted', 'queried', 'approved', 'paid', 'rejected'] as const).map(id => ({ id, label: STATUS[id].label }))
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
type Cols = { who: string; kinds: string[]; details: string; statuses: string[]; from: string; to: string; min: string; max: string }
const EMPTY: Cols = { who: '', kinds: [], details: '', statuses: [], from: '', to: '', min: '', max: '' }
const detailsOf = (c: Row) => c.kind === 'travel'
  ? [`${Number(c.km ?? 0)} km`, c.vehicle === 'company' ? 'company car' : c.rate_per_km != null ? `@ ${formatCurrency(Number(c.rate_per_km), 'ZAR')}` : null,
     (c.from_place || c.to_place) ? `${c.from_place ?? '…'} → ${c.to_place ?? '…'}` : null].filter(Boolean).join(' · ')
  : c.description ?? ''

export default function StaffClaimsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [tab, setTab] = useState('decide')
  const [cols, setCols] = useState<Cols>(EMPTY)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState<null | { kind: 'query' | 'reject' } | { kind: 'pay' } | { kind: 'rate' }>(null)
  const [busy, setBusy] = useState(false)
  const [payVia, setPayVia] = useState<PayVia>('separately')
  const patch = (p: Partial<Cols>) => setCols(c => ({ ...c, ...p }))

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Could not find your company. Please sign in again.'); setRows([]); return }
    setCompanyId(member.companyId)
    const [claims, emps, co] = await Promise.all([
      supabase.from('staff_claims').select('*').eq('company_id', member.companyId).neq('status', 'cancelled').order('claim_date', { ascending: false }).limit(2000),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).limit(5000),
      supabase.from('companies').select('claim_km_rate').eq('id', member.companyId).maybeSingle(),
    ])
    if (claims.error) { setError(claims.error.message); setRows([]); return }
    const names = new Map((emps.data ?? []).map(e => [e.id as string, [e.name, e.surname].filter(Boolean).join(' ')]))
    const jobIds = [...new Set((claims.data ?? []).map(c => c.job_id).filter(Boolean))] as string[]
    const jobs = jobIds.length ? (await supabase.from('jobs').select('id, job_code').in('id', jobIds)).data ?? [] : []
    const codes = new Map(jobs.map(j => [j.id as string, j.job_code as string | null]))
    setRows((claims.data ?? []).map(c => ({ ...(c as Claim), job_code: c.job_id ? codes.get(c.job_id) ?? null : null, who: names.get(c.employee_id) || 'Someone' })))
    setPayVia((await loadPayVia(supabase, member.companyId)).claims)
    const r = (co.data as { claim_km_rate: number | null } | null)?.claim_km_rate
    setRate(r == null ? null : Number(r))
    setError(null)
  }, [])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const afterCols = useMemo(() => (rows ?? []).filter(c =>
    matchText(c.who, cols.who) && (cols.kinds.length === 0 || cols.kinds.includes(c.kind)) && matchText(detailsOf(c), cols.details)
    && (cols.statuses.length === 0 || cols.statuses.includes(c.status)) && inDateRange(c.claim_date, cols.from, cols.to)
    && matchMoney(Number(c.amount), cols.min, cols.max)
    && (!search.trim() || [c.who, KIND_LABEL[c.kind], detailsOf(c), c.job_code, c.manager_note].some(v => matchText(v, search.trim())))), [rows, cols, search])
  const counts = useMemo(() => countByStatusTab(afterCols, TABS), [afterCols])
  const shown = useMemo(() => filterByStatusTab(afterCols, TABS, tab), [afterCols, tab])
  const sel = shown.filter(c => picked.has(c.id))
  const selTotal = sel.reduce((s, c) => s + Number(c.amount), 0)
  const allDecide = sel.length > 0 && sel.every(c => c.status === 'submitted' || c.status === 'queried')
  const allPay = sel.length > 0 && sel.every(c => c.status === 'approved')
  const pickable = (c: Row) => c.status === 'submitted' || c.status === 'queried' || (c.status === 'approved' && !c.payment_approval_id && payVia === 'separately')
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const anyFilter = search !== '' || JSON.stringify(cols) !== JSON.stringify(EMPTY)

  async function decide(decision: 'approve' | 'query' | 'reject', text?: string) {
    setBusy(true); setError(null)
    const r = await decideClaims(createClient(), sel.map(c => c.id), decision, text)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    setSheet(null); setPicked(new Set())
    setNote(decision === 'approve' ? `${r.count} approved. They’re under To pay now.` : decision === 'query' ? `${r.count} sent back with your question.` : `${r.count} rejected.`)
    await load()
  }

  async function openReceipt(path: string) {
    const u = await signWorkforceMedia(createClient(), path)
    if (u) window.open(u, '_blank', 'noopener'); else setError('Could not open the receipt.')
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Staff claims</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">{shown.length} claim{shown.length !== 1 ? 's' : ''} · travel and receipts your team paid for</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11.5px] text-text-secondary inline-flex items-center gap-1.5">Paid
          <select value={payVia} aria-label="How claims are paid" className="form-input h-8 text-[12px] py-0"
            onChange={async e => {
              if (!companyId) return
              const v = e.target.value as PayVia
              const r = await savePayVia(createClient(), companyId, v, null)
              if (!r.ok) { setError(r.message); return }
              setPayVia(v); setPicked(new Set())
              setNote(v === 'payslip' ? 'Approved claims now go on each person’s next payslip (not taxed) and count as paid when the payslip is approved.' : 'Approved claims are now paid separately: tick them under To pay and mark them paid.')
            }}>
            <option value="separately">separately</option>
            <option value="payslip">on the payslip</option>
          </select>
        </label>
        <button type="button" onClick={() => setSheet({ kind: 'rate' })} className="btn-outlined h-8 px-3 text-[12px]">
          <span className="material-icons text-[16px] mr-1">directions_car</span>{rate == null ? 'Set km rate' : `${formatCurrency(rate, 'ZAR')}/km`}
        </button>
        </div>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search claims" placeholder="Search person, type, place or job…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]" />
        <ResetFiltersButton disabled={!anyFilter} onReset={() => { setCols(EMPTY); setSearch('') }} />
        <StatusFilterTabs tabs={TABS} value={tab} counts={counts} onChange={id => { setTab(id); setPicked(new Set()); setNote(null) }} />
      </div>
      {rate == null && rows && <p className="text-[12.5px] text-amber-900 bg-amber-50 px-4 py-2 border-b border-divider">Set a rate per km so staff can claim travel in their own cars.</p>}
      {error && <p className="text-[12.5px] text-error bg-error/10 px-4 py-2 border-b border-divider" role="alert">{error}</p>}
      {note && <p className="text-[12.5px] text-emerald-800 bg-emerald-50 px-4 py-2 border-b border-divider" role="status">{note}</p>}

      <div className="flex-1 overflow-auto">
        {rows === null ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : (
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} w-8`}><span className="sr-only">Pick</span></th>
                <th className={`${MONEY_TH} text-left`}><DateHeaderFilter label="Date" from={cols.from} to={cols.to} onChange={p => patch(p)} /></th>
                <th className={`${MONEY_TH} text-left`}><TextHeaderFilter label="Person" value={cols.who} onChange={v => patch({ who: v })} placeholder="Name…" /></th>
                <th className={`${MONEY_TH} text-left`}><StatusHeaderFilter label="Type" options={KIND_OPTIONS} selected={cols.kinds} onChange={kinds => patch({ kinds })} /></th>
                <th className={`${MONEY_TH} text-left`}><TextHeaderFilter label="Details" value={cols.details} onChange={v => patch({ details: v })} placeholder="Place, km, what for…" /></th>
                <th className={`${MONEY_TH} text-left`}>Job</th>
                <th className={`${MONEY_TH} text-left`}>Receipt</th>
                <th className={`${MONEY_TH} text-left`}><StatusHeaderFilter label="Status" options={STATUS_OPTIONS} selected={cols.statuses} onChange={statuses => patch({ statuses })} /></th>
                <th className={`${MONEY_TH} text-right`}><MoneyHeaderFilter label="Amount" min={cols.min} max={cols.max} onChange={p => patch({ min: p.min, max: p.max })} /></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} className={`border-b border-divider transition-colors ${picked.has(c.id) ? 'bg-primary/5' : 'hover:bg-surface-elevated'} ${pickable(c) ? 'cursor-pointer' : ''}`}
                  onClick={() => { if (pickable(c)) toggle(c.id) }}>
                  <td className={MONEY_TD} onClick={e => e.stopPropagation()}>
                    {pickable(c) && <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="w-4 h-4" aria-label={`Pick ${c.who}’s claim`} />}
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{fmtDay(c.claim_date)}</td>
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{c.who}</td>
                  <td className={MONEY_TD}>{KIND_LABEL[c.kind]}{c.bill_to_client ? <span className="ml-1 text-[10px] font-semibold text-violet-700">· bill client</span> : null}</td>
                  <td className={`${MONEY_TD} text-text-secondary max-w-[280px] truncate`} title={[detailsOf(c), c.manager_note ? `Note: ${c.manager_note}` : ''].filter(Boolean).join(' — ')}>
                    {detailsOf(c) || '—'}{c.manager_note ? <span className="text-text-primary"> · “{c.manager_note}”</span> : null}
                  </td>
                  <td className={MONEY_TD}>{c.job_code ?? '—'}</td>
                  <td className={MONEY_TD} onClick={e => e.stopPropagation()}>
                    {c.receipt_path ? <button type="button" className="text-primary font-medium" onClick={() => void openReceipt(c.receipt_path!)}>View</button> : '—'}
                  </td>
                  <td className={MONEY_TD}><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${claimStatus(c).cls}`}>{claimStatus(c).label}</span></td>
                  <td className={`${MONEY_TD} text-right font-medium`}>{formatCurrency(Number(c.amount), 'ZAR')}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={9} className="text-center text-[13px] text-text-secondary py-10">
                  {(rows ?? []).length === 0 ? 'No claims yet' : tab === 'decide' && !anyFilter ? 'Nothing waiting for a decision' : 'No claims match these filters'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {sel.length > 0 && (
        <div className="shrink-0 bg-background border-t border-divider px-4 py-2.5 flex flex-wrap items-center gap-2 [&>*]:shrink-0">
          <span className="text-[12.5px] flex-1 min-w-[120px]">{sel.length} picked · <b>{formatCurrency(selTotal, 'ZAR')}</b></span>
          {allDecide && (
            <>
              <button type="button" disabled={busy} onClick={() => setSheet({ kind: 'reject' })} className="btn-outlined h-9 px-3 text-[12.5px]">Reject</button>
              <button type="button" disabled={busy} onClick={() => setSheet({ kind: 'query' })} className="btn-outlined h-9 px-3 text-[12.5px]">Query</button>
              <button type="button" disabled={busy} onClick={() => void decide('approve')} className="btn-primary h-9 px-4 text-[12.5px]">{busy ? 'Saving…' : 'Approve'}</button>
            </>
          )}
          {allPay && <button type="button" onClick={() => setSheet({ kind: 'pay' })} className="btn-primary h-9 px-4 text-[12.5px]">Mark paid</button>}
          {!allDecide && !allPay && <span className="text-[12px] text-text-secondary">Pick claims that are all waiting, or all approved.</span>}
        </div>
      )}

      {sheet?.kind === 'query' || sheet?.kind === 'reject' ? (
        <NoteSheet kind={sheet.kind} count={sel.length} busy={busy} onClose={() => setSheet(null)} onSend={t => void decide(sheet.kind as 'query' | 'reject', t)} />
      ) : null}
      {sheet?.kind === 'pay' && (
        <PaySheet count={sel.length} total={selTotal} onClose={() => setSheet(null)} onPay={async (on, method, ref) => {
          const r = await markClaimsPaid(createClient(), sel.map(c => c.id), on, method, ref)
          if (!r.ok) return r.message
          setSheet(null); setPicked(new Set()); setNote(`${r.count} marked paid and booked as money out.`); await load(); return null
        }} />
      )}
      {sheet?.kind === 'rate' && companyId && (
        <RateSheet rate={rate} onClose={() => setSheet(null)} onSave={async v => {
          const r = await setKmRate(createClient(), companyId, v)
          if (!r.ok) return r.message
          setSheet(null); setNote(v == null ? 'Km rate cleared.' : `Km rate set to ${formatCurrency(v, 'ZAR')}.`); await load(); return null
        }} />
      )}
    </div>
  )
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-background w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <header className="flex items-center px-4 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[16px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close"><span className="material-icons">close</span></button>
        </header>
        <div className="px-4 py-4 flex flex-col gap-3 overflow-y-auto">{children}</div>
        <footer className="px-4 py-3 border-t border-divider flex gap-2 justify-end shrink-0">{footer}</footer>
      </div>
    </div>
  )
}
const field = 'mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]'

function NoteSheet({ kind, count, busy, onClose, onSend }: { kind: 'query' | 'reject'; count: number; busy: boolean; onClose: () => void; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Sheet title={kind === 'query' ? `Ask about ${count} claim${count > 1 ? 's' : ''}` : `Reject ${count} claim${count > 1 ? 's' : ''}`} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => onSend(text.trim())} className="btn-primary h-11 px-4 text-[14px] disabled:opacity-50">{kind === 'query' ? 'Send back' : 'Reject'}</button></>}>
      <label className="text-[12px] font-medium text-text-secondary">{kind === 'query' ? 'What should they fix or explain?' : 'Why is it rejected?'}
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={500} className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-xl text-[15px]"
          placeholder={kind === 'query' ? 'e.g. Please add the toll slip' : 'e.g. This trip was in the company bakkie'} />
      </label>
      <p className="text-[12.5px] text-text-secondary">They’ll see this note on the claim.</p>
    </Sheet>
  )
}

function PaySheet({ count, total, onClose, onPay }: { count: number; total: number; onClose: () => void; onPay: (on: string, method: string, ref: string) => Promise<string | null> }) {
  const [on, setOn] = useState(todaySA())
  const [method, setMethod] = useState('eft')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Sheet title={`Mark ${count} paid · ${formatCurrency(total, 'ZAR')}`} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(await onPay(on, method, ref.trim())); setBusy(false) }} className="btn-primary h-11 px-4 text-[14px] disabled:opacity-50">{busy ? 'Saving…' : 'Mark paid'}</button></>}>
      {err && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{err}</p>}
      <p className="text-[12.5px] text-text-secondary">Pay them from the bank first; this records it and books each claim as money out.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[12px] font-medium text-text-secondary">Paid on<input type="date" value={on} max={todaySA()} onChange={e => setOn(e.target.value)} className={field} /></label>
        <label className="text-[12px] font-medium text-text-secondary">How
          <select value={method} onChange={e => setMethod(e.target.value)} className={field}>
            <option value="eft">EFT</option><option value="cash">Cash</option><option value="card">Card</option>
          </select>
        </label>
      </div>
      <label className="text-[12px] font-medium text-text-secondary">Reference (optional)<input value={ref} onChange={e => setRef(e.target.value)} maxLength={100} className={field} placeholder="e.g. Claims Nov wk3" /></label>
    </Sheet>
  )
}

function RateSheet({ rate, onClose, onSave }: { rate: number | null; onClose: () => void; onSave: (v: number | null) => Promise<string | null> }) {
  const [v, setV] = useState(rate == null ? '' : String(rate))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const n = v.trim() === '' ? null : Number(v.replace(',', '.'))
  return (
    <Sheet title="Travel rate per km" onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
        <button type="button" disabled={busy || (n != null && !(n >= 0))} onClick={async () => { setBusy(true); setErr(await onSave(n)); setBusy(false) }} className="btn-primary h-11 px-4 text-[14px] disabled:opacity-50">Save</button></>}>
      {err && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{err}</p>}
      <label className="text-[12px] font-medium text-text-secondary">Rand per km (own car)
        <input value={v} onChange={e => setV(e.target.value)} inputMode="decimal" className={field} placeholder="e.g. 4.50" />
      </label>
      <p className="text-[12.5px] text-text-secondary">Many companies use SARS’s simplified rate. New claims use this rate; claims already sent keep theirs. Leave empty to stop travel claims.</p>
    </Sheet>
  )
}
