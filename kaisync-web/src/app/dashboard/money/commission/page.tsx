'use client'

/**
 * Money out → Pay out → Commission (board "The team side", 3). How commission is worked out, who sells, and paying out
 * what reps have earned (outside payroll for now; each payout books money out).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatCurrency } from '@/lib/currencies'
import { todaySA } from '@/lib/claims'
import {
  BASIS_LABEL, howWorkedOut, loadCommission, markCommissionPaid, parsePercent, saveCommissionSettings, setRep, totals,
  type CommissionBasis, type CommissionRep, type CommissionRow, type CommissionSettings, type EarnedOn,
} from '@/lib/commission'
import { cn } from '@/lib/utils'

type Tab = 'topay' | 'open' | 'paid' | 'all'
const TABS: { key: Tab; label: string }[] = [
  { key: 'topay', label: 'To pay' }, { key: 'open', label: 'Waiting for client' }, { key: 'paid', label: 'Paid' }, { key: 'all', label: 'All' },
]
const inTab = (r: CommissionRow, t: Tab) =>
  t === 'all' ? true : t === 'topay' ? r.to_pay > 0 : t === 'open' ? r.status === 'open' && r.to_pay <= 0 && r.earned < r.commission_amount
    : r.paid_amount > 0 && r.paid_amount >= r.commission_amount
const R = (n: number) => formatCurrency(n, 'ZAR')
const pct = (n: number) => `${Math.round(n * 100)}%`
const field = 'mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]'

export default function CommissionPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [settings, setSettings] = useState<CommissionSettings | null>(null)
  const [reps, setReps] = useState<CommissionRep[]>([])
  const [rows, setRows] = useState<CommissionRow[] | null>(null)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [tab, setTab] = useState<Tab>('topay')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState<null | 'setup' | 'pay'>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Could not find your company. Please sign in again.'); setRows([]); return }
    setCompanyId(member.companyId)
    const [r, emps] = await Promise.all([
      loadCommission(supabase, member.companyId),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name').limit(5000),
    ])
    if (!r.ok) { setError(r.message); setRows([]); return }
    setError(null); setSettings(r.settings); setReps(r.reps); setRows(r.rows)
    setStaff((emps.data ?? []).map(e => ({ id: e.id as string, name: [e.name, e.surname].filter(Boolean).join(' ') })))
  }, [])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const shown = useMemo(() => (rows ?? []).filter(r => inTab(r, tab)), [rows, tab])
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, (rows ?? []).filter(r => inTab(r, t.key)).length])) as Record<Tab, number>, [rows])
  const sel = shown.filter(r => picked.has(r.id) && r.to_pay > 0)
  const selTotal = sel.reduce((s, r) => s + r.to_pay, 0)
  const t = totals(rows ?? [])
  const setUp = settings?.percent != null || reps.some(r => r.percent != null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col gap-3 pb-28">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Commission</h1>
            <p className="text-[12.5px] text-text-secondary">
              {settings ? <>On {BASIS_LABEL[settings.basis]} excl. VAT · {settings.percent != null ? `${settings.percent}% default` : 'no default %'} · earned {settings.earned_on === 'payment' ? 'as the client pays' : 'when paid in full'} · {reps.filter(r => r.active).length} rep{reps.filter(r => r.active).length === 1 ? '' : 's'}</> : ' '}
            </p>
          </div>
          <button type="button" onClick={() => setSheet('setup')} className="btn-outlined h-10 px-3 text-[13px] shrink-0">
            <span className="material-icons text-[18px] mr-1">tune</span>Set up
          </button>
        </div>
        {settings && !setUp && <p className="text-[13px] text-amber-900 bg-amber-50 rounded-lg px-3 py-2">Tap Set up to choose how commission works and who your sales reps are. Then pick the sales rep on each quote.</p>}
        {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
        {note && <p className="text-[13px] text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">{note}</p>}

        {rows && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[['Earned', t.earned], ['Paid out', t.paid], ['To pay now', t.toPay]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-divider bg-surface px-3 py-2">
                <p className="text-[11.5px] text-text-secondary">{l}</p>
                <p className="text-[15px] font-semibold tabular-nums">{R(v as number)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto -mx-1 px-1" role="tablist">
          {TABS.map(x => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => { setTab(x.key); setPicked(new Set()); setNote(null) }}
              className={cn('h-10 px-3 rounded-full text-[13px] font-medium whitespace-nowrap', tab === x.key ? 'bg-primary text-white' : 'bg-surface border border-divider text-text-secondary')}>
              {x.label}{counts[x.key] ? ` · ${counts[x.key]}` : ''}
            </button>
          ))}
        </div>

        {rows === null ? <p className="py-10 text-center text-[13px] text-text-secondary">Loading…</p> : shown.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-text-secondary">{tab === 'topay' ? 'Nothing earned and unpaid.' : 'Nothing here.'}</p>
        ) : shown.map(r => (
          <section key={r.id} className={cn('rounded-xl border bg-surface p-3 flex gap-3', picked.has(r.id) ? 'border-primary' : 'border-divider', r.status === 'cancelled' && 'opacity-60')}>
            {r.to_pay > 0 ? (
              <input type="checkbox" checked={picked.has(r.id)} className="w-5 h-5 mt-1 shrink-0" aria-label={`Pick ${r.quote_number}`}
                onChange={() => setPicked(p => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} />
            ) : <span className="material-icons text-[20px] text-primary mt-0.5">trending_up</span>}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[14px] font-semibold text-text-primary min-w-0">{r.rep_name || 'Rep'} · {[r.quote_number, r.client_name || r.quote_title].filter(Boolean).join(' · ')}</p>
                <b className="text-[14px] tabular-nums shrink-0">{R(r.commission_amount)}</b>
              </div>
              <p className="text-[12.5px] text-text-secondary">{howWorkedOut(r, R)}{r.status === 'cancelled' ? ' · quote no longer accepted' : ''}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[12.5px]">
                <span className="text-text-secondary">Client paid {pct(r.paid_share)}</span>
                <span>Earned <b className="tabular-nums">{R(r.earned)}</b></span>
                <span>Paid <b className="tabular-nums">{R(r.paid_amount)}</b></span>
                {r.to_pay > 0 && <span className="font-semibold text-emerald-800">To pay {R(r.to_pay)}</span>}
              </div>
            </div>
          </section>
        ))}
      </div>

      {sel.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-background border-t border-divider px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <span className="text-[13px] flex-1">{sel.length} picked · <b>{R(selTotal)}</b></span>
            <button type="button" onClick={() => setSheet('pay')} className="btn-primary h-11 px-4 text-[13px] shrink-0">Mark paid</button>
          </div>
        </div>
      )}

      {sheet === 'pay' && (
        <PaySheet count={sel.length} total={selTotal} onClose={() => setSheet(null)} onPay={async (on, method, ref) => {
          const r = await markCommissionPaid(createClient(), sel.map(x => x.id), on, method, ref)
          if (!r.ok) return r.message
          setSheet(null); setPicked(new Set()); setNote(`${r.count} paid and booked as money out.`); await load(); return null
        }} />
      )}
      {sheet === 'setup' && settings && companyId && (
        <SetupSheet companyId={companyId} settings={settings} reps={reps} staff={staff} onClose={() => setSheet(null)}
          onDone={async text => { setSheet(null); setNote(text); await load() }} />
      )}
    </div>
  )
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-background w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center px-4 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[16px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close"><span className="material-icons">close</span></button>
        </header>
        <div className="px-4 py-4 flex flex-col gap-3 overflow-y-auto [&>*]:shrink-0">{children}</div>
        <footer className="px-4 py-3 border-t border-divider flex gap-2 justify-end shrink-0">{footer}</footer>
      </div>
    </div>
  )
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; hint: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      <p className="text-[12px] font-medium text-text-secondary">{label}</p>
      {options.map(o => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn('text-left rounded-xl border px-3 py-2', value === o.v ? 'border-primary bg-primary/5' : 'border-divider')}>
          <span className="text-[14px] font-semibold">{o.label}</span><br /><span className="text-[12.5px] text-text-secondary">{o.hint}</span>
        </button>
      ))}
    </div>
  )
}

function SetupSheet({ companyId, settings, reps, staff, onClose, onDone }: {
  companyId: string; settings: CommissionSettings; reps: CommissionRep[]; staff: { id: string; name: string }[]
  onClose: () => void; onDone: (text: string) => Promise<void>
}) {
  const [basis, setBasis] = useState<CommissionBasis>(settings.basis)
  const [earnedOn, setEarnedOn] = useState<EarnedOn>(settings.earned_on)
  const [def, setDef] = useState(settings.percent == null ? '' : String(settings.percent))
  const [list, setList] = useState(reps.map(r => ({ ...r, pctText: r.percent == null ? '' : String(r.percent) })))
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const defN = parsePercent(def)
  const bad = (defN != null && Number.isNaN(defN)) || list.some(r => { const n = parsePercent(r.pctText); return n != null && Number.isNaN(n) })
  const free = staff.filter(s => !list.some(r => r.employee_id === s.id))

  async function save() {
    setBusy(true); setErr(null)
    const s = createClient()
    const a = await saveCommissionSettings(s, companyId, { basis, percent: defN, earned_on: earnedOn })
    if (!a.ok) { setErr(a.message); setBusy(false); return }
    for (const r of list) {
      const before = reps.find(x => x.employee_id === r.employee_id)
      const p = parsePercent(r.pctText)
      if (before && before.percent === p && before.active === r.active) continue
      const b = await setRep(s, companyId, r.employee_id, p, r.active)
      if (!b.ok) { setErr(b.message); setBusy(false); return }
    }
    setBusy(false)
    await onDone('Commission set up saved. New accepted quotes use it; ones already accepted keep their %.')
  }

  return (
    <Sheet title="Commission set up" onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
        <button type="button" disabled={busy || bad} onClick={() => void save()} className="btn-primary h-11 px-4 text-[14px] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{err}</p>}
      <Choice label="Work it out on" value={basis} onChange={setBasis} options={[
        { v: 'profit', label: 'Profit', hint: 'Selling price minus cost, excl. VAT. Discounts come out of commission too.' },
        { v: 'sale', label: 'Sale value', hint: 'The quote total excl. VAT.' },
      ]} />
      <label className="text-[12px] font-medium text-text-secondary">Default % (reps without their own %)
        <input value={def} onChange={e => setDef(e.target.value)} inputMode="decimal" className={field} placeholder="e.g. 5" />
      </label>
      <Choice label="Earned" value={earnedOn} onChange={setEarnedOn} options={[
        { v: 'payment', label: 'As the client pays', hint: 'Half paid = half the commission earned. Fair on deposits.' },
        { v: 'paid_in_full', label: 'Only when paid in full', hint: 'Nothing is earned until the client has paid everything.' },
      ]} />

      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-text-secondary">Sales reps (picked on quotes)</p>
        {list.length === 0 && <p className="text-[12.5px] text-text-secondary">No reps yet. Add the people who sell.</p>}
        {list.map((r, i) => (
          <div key={r.employee_id} className={cn('flex items-center gap-2 rounded-xl border border-divider px-3 py-2', !r.active && 'opacity-60')}>
            <span className="flex-1 min-w-0 text-[14px] font-medium truncate">{r.name || 'Staff member'}</span>
            <input value={r.pctText} inputMode="decimal" aria-label={`${r.name} %`} placeholder={def ? `${def}` : '%'}
              onChange={e => setList(l => l.map((x, j) => j === i ? { ...x, pctText: e.target.value } : x))}
              className="w-16 h-10 px-2 bg-background border border-border rounded-lg text-[14px] text-right" />
            <span className="text-[13px] text-text-secondary">%</span>
            <button type="button" onClick={() => setList(l => l.map((x, j) => j === i ? { ...x, active: !x.active } : x))}
              className="text-[12.5px] text-primary font-medium h-10 px-1 w-14 text-right">{r.active ? 'Remove' : 'Add back'}</button>
          </div>
        ))}
        <div className="flex gap-2">
          <select value={adding} onChange={e => setAdding(e.target.value)} className="flex-1 h-12 px-3 bg-background border border-border rounded-xl text-[15px]" aria-label="Add a sales rep">
            <option value="">Add a sales rep…</option>
            {free.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" disabled={!adding} className="btn-outlined h-12 px-4 text-[14px] disabled:opacity-50" onClick={() => {
            const s = staff.find(x => x.id === adding); if (!s) return
            setList(l => [...l, { employee_id: s.id, name: s.name, percent: null, active: true, pctText: '' }]); setAdding('')
          }}>Add</button>
        </div>
        <p className="text-[12px] text-text-secondary">Leave a rep’s % empty to use the default. Removing a rep keeps what they’ve already earned.</p>
      </div>
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
    <Sheet title={`Pay ${count} · ${R(total)}`} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(await onPay(on, method, ref.trim())); setBusy(false) }} className="btn-primary h-11 px-4 text-[14px] disabled:opacity-50">{busy ? 'Saving…' : 'Mark paid'}</button></>}>
      {err && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{err}</p>}
      <p className="text-[12.5px] text-text-secondary">Pay the reps from the bank first; this records it and books each payment as money out. Only what’s earned so far is paid.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[12px] font-medium text-text-secondary">Paid on<input type="date" value={on} max={todaySA()} onChange={e => setOn(e.target.value)} className={field} /></label>
        <label className="text-[12px] font-medium text-text-secondary">How
          <select value={method} onChange={e => setMethod(e.target.value)} className={field}>
            <option value="eft">EFT</option><option value="cash">Cash</option>
          </select>
        </label>
      </div>
      <label className="text-[12px] font-medium text-text-secondary">Reference (optional)<input value={ref} onChange={e => setRef(e.target.value)} maxLength={100} className={field} placeholder="e.g. Commission Nov" /></label>
    </Sheet>
  )
}
