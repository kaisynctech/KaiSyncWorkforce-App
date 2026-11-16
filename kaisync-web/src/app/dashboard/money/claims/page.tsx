'use client'

/**
 * Money out → Pay out → Staff claims (board "The team side", 1 and 2). Managers approve, query or reject; HR marks
 * approved claims paid (outside payroll for now), which books the money out. The km rate lives here too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { signWorkforceMedia } from '@/lib/media-read'
import { formatCurrency } from '@/lib/currencies'
import { KIND_ICON, KIND_LABEL, STATUS, decideClaims, markClaimsPaid, setKmRate, todaySA, type Claim } from '@/lib/claims'
import { cn } from '@/lib/utils'

type Row = Claim & { who: string }
type Tab = 'waiting' | 'topay' | 'paid' | 'all'
const TABS: { key: Tab; label: string }[] = [
  { key: 'waiting', label: 'To decide' }, { key: 'topay', label: 'To pay' }, { key: 'paid', label: 'Paid' }, { key: 'all', label: 'All' },
]
const inTab = (c: Claim, t: Tab) =>
  t === 'all' ? true : t === 'waiting' ? c.status === 'submitted' || c.status === 'queried' : t === 'topay' ? c.status === 'approved' : c.status === 'paid'
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })

export default function StaffClaimsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('waiting')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState<null | { kind: 'query' | 'reject' } | { kind: 'pay' } | { kind: 'rate' }>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Could not find your company. Please sign in again.'); setRows([]); return }
    setCompanyId(member.companyId)
    const [claims, emps, co] = await Promise.all([
      supabase.from('staff_claims').select('*').eq('company_id', member.companyId).neq('status', 'cancelled').order('claim_date', { ascending: false }).limit(1000),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).limit(5000),
      supabase.from('companies').select('claim_km_rate').eq('id', member.companyId).maybeSingle(),
    ])
    if (claims.error) { setError(claims.error.message); setRows([]); return }
    const names = new Map((emps.data ?? []).map(e => [e.id as string, [e.name, e.surname].filter(Boolean).join(' ')]))
    const jobIds = [...new Set((claims.data ?? []).map(c => c.job_id).filter(Boolean))] as string[]
    const jobs = jobIds.length ? (await supabase.from('jobs').select('id, job_code').in('id', jobIds)).data ?? [] : []
    const codes = new Map(jobs.map(j => [j.id as string, j.job_code as string | null]))
    setRows((claims.data ?? []).map(c => ({ ...(c as Claim), job_code: c.job_id ? codes.get(c.job_id) ?? null : null, who: names.get(c.employee_id) || 'Someone' })))
    const r = (co.data as { claim_km_rate: number | null } | null)?.claim_km_rate
    setRate(r == null ? null : Number(r))
    setError(null)
  }, [])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const shown = useMemo(() => (rows ?? []).filter(c => inTab(c, tab)), [rows, tab])
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, (rows ?? []).filter(c => inTab(c, t.key)).length])) as Record<Tab, number>, [rows])
  const sel = shown.filter(c => picked.has(c.id))
  const selTotal = sel.reduce((s, c) => s + Number(c.amount), 0)
  const changeTab = (t: Tab) => { setTab(t); setPicked(new Set()); setNote(null) }
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function decide(decision: 'approve' | 'query' | 'reject', text?: string) {
    setBusy(true); setError(null)
    const r = await decideClaims(createClient(), sel.map(c => c.id), decision, text)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    setSheet(null); setPicked(new Set())
    setNote(decision === 'approve' ? `${r.count} approved. They’re under To pay now.` : decision === 'query' ? `${r.count} sent back with your question.` : `${r.count} rejected.`)
    await load()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col gap-3 pb-28">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Staff claims</h1>
            <p className="text-[12.5px] text-text-secondary">Travel and receipts your team paid for. Paid outside payroll for now.</p>
          </div>
          <button type="button" onClick={() => setSheet({ kind: 'rate' })} className="btn-outlined h-10 px-3 text-[13px] shrink-0">
            <span className="material-icons text-[18px] mr-1">directions_car</span>{rate == null ? 'Set km rate' : `${formatCurrency(rate, 'ZAR')}/km`}
          </button>
        </div>
        {rate == null && <p className="text-[13px] text-amber-900 bg-amber-50 rounded-lg px-3 py-2">Set a rate per km so staff can claim travel in their own cars.</p>}
        {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
        {note && <p className="text-[13px] text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">{note}</p>}

        <div className="flex gap-1 overflow-x-auto -mx-1 px-1" role="tablist">
          {TABS.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => changeTab(t.key)}
              className={cn('h-10 px-3 rounded-full text-[13px] font-medium whitespace-nowrap', tab === t.key ? 'bg-primary text-white' : 'bg-surface border border-divider text-text-secondary')}>
              {t.label}{counts[t.key] ? ` · ${counts[t.key]}` : ''}
            </button>
          ))}
        </div>

        {rows === null ? <p className="py-10 text-center text-[13px] text-text-secondary">Loading…</p> : shown.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-text-secondary">{tab === 'waiting' ? 'Nothing waiting for a decision.' : tab === 'topay' ? 'Nothing approved and unpaid.' : 'No claims here.'}</p>
        ) : shown.map(c => <ClaimCard key={c.id} c={c} picked={picked.has(c.id)} pickable={tab === 'waiting' || tab === 'topay'} onPick={() => toggle(c.id)} />)}
      </div>

      {sel.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-background border-t border-divider px-4 py-3">
          <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-2 [&>*]:shrink-0">
            <span className="text-[13px] flex-1 min-w-[120px]">{sel.length} picked · <b>{formatCurrency(selTotal, 'ZAR')}</b></span>
            {tab === 'waiting' ? (
              <>
                <button type="button" disabled={busy} onClick={() => setSheet({ kind: 'reject' })} className="btn-outlined h-11 px-3 text-[13px]">Reject</button>
                <button type="button" disabled={busy} onClick={() => setSheet({ kind: 'query' })} className="btn-outlined h-11 px-3 text-[13px]">Query</button>
                <button type="button" disabled={busy} onClick={() => void decide('approve')} className="btn-primary h-11 px-4 text-[13px]">{busy ? 'Saving…' : 'Approve'}</button>
              </>
            ) : (
              <button type="button" onClick={() => setSheet({ kind: 'pay' })} className="btn-primary h-11 px-4 text-[13px]">Mark paid</button>
            )}
          </div>
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

function ClaimCard({ c, picked, pickable, onPick }: { c: Row; picked: boolean; pickable: boolean; onPick: () => void }) {
  const [opening, setOpening] = useState(false)
  const st = STATUS[c.status]
  const detail = c.kind === 'travel'
    ? [`${Number(c.km ?? 0)} km`, c.vehicle === 'company' ? 'company car' : c.rate_per_km != null ? `@ ${formatCurrency(Number(c.rate_per_km), 'ZAR')}` : null, (c.from_place || c.to_place) ? `${c.from_place ?? '…'} → ${c.to_place ?? '…'}` : null]
    : [c.description]
  return (
    <section className={cn('rounded-xl border bg-surface p-3 flex gap-3', picked ? 'border-primary' : 'border-divider')}>
      {pickable ? (
        <input type="checkbox" checked={picked} onChange={onPick} className="w-5 h-5 mt-1 shrink-0" aria-label={`Pick ${c.who}’s claim`} />
      ) : <span className="material-icons text-[20px] text-primary mt-0.5">{KIND_ICON[c.kind]}</span>}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-semibold text-text-primary">{c.who} · {KIND_LABEL[c.kind]}</p>
          <b className="text-[14px] tabular-nums shrink-0">{formatCurrency(Number(c.amount), 'ZAR')}</b>
        </div>
        <p className="text-[12.5px] text-text-secondary">{[fmtDay(c.claim_date), ...detail, c.job_code].filter(Boolean).join(' · ')}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className={cn('text-[11px] font-semibold rounded-full px-2 py-0.5', st.cls)}>{st.label}</span>
          {c.bill_to_client && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-violet-50 text-violet-800">Bill the client</span>}
          {c.receipt_path && (
            <button type="button" disabled={opening} className="text-[12.5px] text-primary font-medium h-8" onClick={async () => {
              setOpening(true)
              const u = await signWorkforceMedia(createClient(), c.receipt_path)
              setOpening(false)
              if (u) window.open(u, '_blank', 'noopener')
            }}>{opening ? 'Opening…' : 'View receipt'}</button>
          )}
          {c.status === 'paid' && c.payment_reference && <span className="text-[12px] text-text-secondary">Ref {c.payment_reference}</span>}
        </div>
        {c.manager_note && <p className="text-[12.5px] text-text-secondary mt-1">Note: “{c.manager_note}”</p>}
      </div>
    </section>
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
