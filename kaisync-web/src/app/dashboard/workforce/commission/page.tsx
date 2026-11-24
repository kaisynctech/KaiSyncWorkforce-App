'use client'

/**
 * Workforce → Commission (board "The team side", 3). How commission is worked out, who sells, and paying out what reps
 * have earned (outside payroll for now; each payout books money out). Standard table: status tabs, column filters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatCurrency } from '@/lib/currencies'
import { todaySA } from '@/lib/claims'
import {
  BASIS_LABEL, loadCommission, markCommissionPaid, parsePercent, saveCommissionSettings, setRep, totals,
  type CommissionBasis, type CommissionRep, type CommissionRow, type CommissionSettings, type EarnedOn,
} from '@/lib/commission'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab } from '@/components/ui/StatusFilterTabs'
import { TextHeaderFilter, MoneyHeaderFilter, StatusHeaderFilter, ResetFiltersButton, matchText, matchMoney, statusTab } from '@/components/ui/MoneyListFilters'
import { cn } from '@/lib/utils'

/** A commission's place in the flow: to pay (earned, unpaid), waiting (client still paying), paid, cancelled. */
type State = 'topay' | 'waiting' | 'paid' | 'cancelled'
const commissionState = (r: CommissionRow): State =>
  r.status === 'cancelled' && r.paid_amount <= 0 ? 'cancelled'
    : r.to_pay > 0 ? 'topay'
      : r.paid_amount > 0 && r.paid_amount >= r.commission_amount ? 'paid' : 'waiting'
const STATE_LABEL: Record<State, string> = { topay: 'To pay', waiting: 'Waiting for client', paid: 'Paid', cancelled: 'Cancelled' }
const STATE_BADGE: Record<State, string> = { topay: 'bg-blue-100 text-blue-700', waiting: 'bg-amber-100 text-amber-700', paid: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-500' }
const TABS = [
  TAB_ALL,
  statusTab('topay', 'To pay', ['topay'], 'blue'),
  statusTab('waiting', 'Waiting for client', ['waiting'], 'amber'),
  statusTab('paid', 'Paid', ['paid'], 'green'),
  statusTab('cancelled', 'Cancelled', ['cancelled'], 'gray'),
]
type Row = Omit<CommissionRow, 'status'> & { state: State; status: State }
const R = (n: number) => formatCurrency(n, 'ZAR')
const pct = (n: number) => `${Math.round(n * 100)}%`
const field = 'mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]'
/** Someone who could be added as a rep; position and employee number tell people with the same name apart. */
type Staff = { id: string; name: string; detail: string }
/** Paid out more than earned so far (the quote's price or the client's payments went down after a payout). */
const overpaid = (r: Pick<CommissionRow, 'paid_amount' | 'earned'>) => Math.max(0, Math.round((r.paid_amount - r.earned) * 100) / 100)
type Cols = { rep: string; quote: string; client: string; bases: string[]; min: string; max: string }
const EMPTY: Cols = { rep: '', quote: '', client: '', bases: [], min: '', max: '' }

export default function CommissionPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [settings, setSettings] = useState<CommissionSettings | null>(null)
  const [reps, setReps] = useState<CommissionRep[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [staff, setStaff] = useState<Staff[]>([])
  const [tab, setTab] = useState('topay')
  const [cols, setCols] = useState<Cols>(EMPTY)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState<null | 'setup' | 'pay'>(null)
  const patch = (p: Partial<Cols>) => setCols(c => ({ ...c, ...p }))

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Could not find your company. Please sign in again.'); setRows([]); return }
    setCompanyId(member.companyId)
    const [r, emps] = await Promise.all([
      loadCommission(supabase, member.companyId),
      supabase.from('employees').select('id, name, surname, position, employee_number').eq('company_id', member.companyId).eq('is_active', true).order('name').limit(5000),
    ])
    if (!r.ok) { setError(r.message); setRows([]); return }
    setError(null); setSettings(r.settings); setReps(r.reps)
    setRows(r.rows.map((x): Row => { const st = commissionState(x); return { ...x, state: st, status: st } }))
    setStaff((emps.data ?? []).map(e => ({
      id: e.id as string, name: [e.name, e.surname].filter(Boolean).join(' ') || 'Staff member',
      detail: [e.position, e.employee_number ? `#${e.employee_number}` : null].filter(Boolean).join(' · '),
    })))
  }, [])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const afterCols = useMemo(() => (rows ?? []).filter(r =>
    matchText(r.rep_name, cols.rep) && matchText(r.quote_number, cols.quote) && matchText(r.client_name ?? r.quote_title, cols.client)
    && (cols.bases.length === 0 || cols.bases.includes(r.basis)) && matchMoney(r.commission_amount, cols.min, cols.max)
    && (!search.trim() || [r.rep_name, r.quote_number, r.client_name, r.quote_title].some(v => matchText(v, search.trim())))), [rows, cols, search])
  const counts = useMemo(() => countByStatusTab(afterCols, TABS), [afterCols])
  const shown = useMemo(() => filterByStatusTab(afterCols, TABS, tab), [afterCols, tab])
  const sel = shown.filter(r => picked.has(r.id) && r.to_pay > 0)
  const selTotal = sel.reduce((s, r) => s + r.to_pay, 0)
  const t = totals(shown.map(r => ({ ...r, status: r.state === 'cancelled' ? 'cancelled' as const : 'open' as const })))
  const setUp = settings?.percent != null || reps.some(r => r.percent != null)
  const anyFilter = search !== '' || JSON.stringify(cols) !== JSON.stringify(EMPTY)
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const activeReps = reps.filter(r => r.active).length
  const overpaidRows = (rows ?? []).filter(r => overpaid(r) > 0)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Commission</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">
            {settings ? <>On {BASIS_LABEL[settings.basis]} excl. VAT · {settings.percent != null ? `${settings.percent}% default` : 'no default %'} · earned {settings.earned_on === 'payment' ? 'as the client pays' : 'when paid in full'} · {activeReps} rep{activeReps === 1 ? '' : 's'}</> : ' '}
          </p>
        </div>
        <button type="button" onClick={() => setSheet('setup')} className="btn-outlined h-8 px-3 text-[12px]">
          <span className="material-icons text-[16px] mr-1">tune</span>Set up
        </button>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search commission" placeholder="Search rep, quote or client…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]" />
        <ResetFiltersButton disabled={!anyFilter} onReset={() => { setCols(EMPTY); setSearch('') }} />
        <StatusFilterTabs tabs={TABS} value={tab} counts={counts} onChange={id => { setTab(id); setPicked(new Set()); setNote(null) }} />
      </div>
      {settings && !setUp && <p className="text-[12.5px] text-amber-900 bg-amber-50 px-4 py-2 border-b border-divider">Tap Set up to choose how commission works and who your sales reps are. Then pick the sales rep on each quote.</p>}
      {error && <p className="text-[12.5px] text-error bg-error/10 px-4 py-2 border-b border-divider" role="alert">{error}</p>}
      {note && <p className="text-[12.5px] text-emerald-800 bg-emerald-50 px-4 py-2 border-b border-divider" role="status">{note}</p>}
      {overpaidRows.length > 0 && (
        <p className="text-[12.5px] text-amber-900 bg-amber-50 px-4 py-2 border-b border-divider" role="status">
          {overpaidRows.length === 1 ? '1 rep has' : `${overpaidRows.length} reps have`} been paid {R(overpaidRows.reduce((s, r) => s + overpaid(r), 0))} more than they’ve earned, because a quote’s price or the client’s payments went down after a payout. Agree with the rep how it’s paid back; it isn’t taken off automatically.
        </p>
      )}

      <div className="flex-1 overflow-auto">
        {rows === null ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : (
          <table className="w-full" style={{ minWidth: 980 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} w-8`}><span className="sr-only">Pick</span></th>
                <th className={`${MONEY_TH} text-left`}><TextHeaderFilter label="Rep" value={cols.rep} onChange={v => patch({ rep: v })} placeholder="Name…" /></th>
                <th className={`${MONEY_TH} text-left`}><TextHeaderFilter label="Quote" value={cols.quote} onChange={v => patch({ quote: v })} placeholder="Quote #…" /></th>
                <th className={`${MONEY_TH} text-left`}><TextHeaderFilter label="Client" value={cols.client} onChange={v => patch({ client: v })} placeholder="Client…" /></th>
                <th className={`${MONEY_TH} text-left`}><StatusHeaderFilter label="Worked out on" options={[{ id: 'profit', label: 'Profit' }, { id: 'sale', label: 'Sale value' }]} selected={cols.bases} onChange={bases => patch({ bases })} /></th>
                <th className={`${MONEY_TH} text-right`}><MoneyHeaderFilter label="Commission" min={cols.min} max={cols.max} onChange={p => patch({ min: p.min, max: p.max })} /></th>
                <th className={`${MONEY_TH} text-right`}>Client paid</th>
                <th className={`${MONEY_TH} text-right`}>Earned</th>
                <th className={`${MONEY_TH} text-right`}>Paid out</th>
                <th className={`${MONEY_TH} text-right`}>To pay</th>
                <th className={`${MONEY_TH} text-left`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} className={`border-b border-divider transition-colors ${picked.has(r.id) ? 'bg-primary/5' : 'hover:bg-surface-elevated'} ${r.to_pay > 0 ? 'cursor-pointer' : ''}`}
                  onClick={() => { if (r.to_pay > 0) toggle(r.id) }}>
                  <td className={MONEY_TD} onClick={e => e.stopPropagation()}>
                    {r.to_pay > 0 && <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="w-4 h-4" aria-label={`Pick ${r.quote_number}`} />}
                  </td>
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{r.rep_name || '—'}</td>
                  <td className={`${MONEY_TD} text-primary`}>{r.quote_number ?? '—'}</td>
                  <td className={MONEY_TD}>{r.client_name || r.quote_title || '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{Number(r.percent)}% of {BASIS_LABEL[r.basis]} {R(r.base_amount)}</td>
                  <td className={`${MONEY_TD} text-right font-medium`}>{R(r.commission_amount)}</td>
                  <td className={`${MONEY_TD} text-right`}>{pct(r.paid_share)}</td>
                  <td className={`${MONEY_TD} text-right`}>{R(r.earned)}</td>
                  <td className={`${MONEY_TD} text-right`}>{R(r.paid_amount)}</td>
                  <td className={`${MONEY_TD} text-right font-semibold ${r.to_pay > 0 ? 'text-emerald-700' : 'text-text-secondary'}`}>
                    {R(r.to_pay)}
                    {overpaid(r) > 0 && <span className="block text-[11px] font-semibold text-amber-700">Overpaid {R(overpaid(r))}</span>}
                  </td>
                  <td className={MONEY_TD}><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATE_BADGE[r.state]}`}>{STATE_LABEL[r.state]}</span></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={11} className="text-center text-[13px] text-text-secondary py-10">
                  {(rows ?? []).length === 0 ? 'No commission yet. Pick a sales rep on a quote; it shows here once the quote is accepted.' : tab === 'topay' && !anyFilter ? 'Nothing earned and unpaid' : 'No commission matches these filters'}
                </td></tr>
              )}
            </tbody>
            {shown.length > 0 && (
              <tfoot>
                <tr className="bg-surface-elevated border-t border-divider font-semibold">
                  <td className={MONEY_TD} colSpan={5}>Total</td>
                  <td className={`${MONEY_TD} text-right`}>{R(t.total)}</td>
                  <td className={MONEY_TD} />
                  <td className={`${MONEY_TD} text-right`}>{R(t.earned)}</td>
                  <td className={`${MONEY_TD} text-right`}>{R(t.paid)}</td>
                  <td className={`${MONEY_TD} text-right`}>{R(t.toPay)}</td>
                  <td className={MONEY_TD} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {sel.length > 0 && (
        <div className="shrink-0 bg-background border-t border-divider px-4 py-2.5 flex items-center gap-2">
          <span className="text-[12.5px] flex-1">{sel.length} picked · <b>{R(selTotal)}</b></span>
          <button type="button" onClick={() => setSheet('pay')} className="btn-primary h-9 px-4 text-[12.5px] shrink-0">Mark paid</button>
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
  companyId: string; settings: CommissionSettings; reps: CommissionRep[]; staff: Staff[]
  onClose: () => void; onDone: (text: string) => Promise<void>
}) {
  const [basis, setBasis] = useState<CommissionBasis>(settings.basis)
  const [earnedOn, setEarnedOn] = useState<EarnedOn>(settings.earned_on)
  const [def, setDef] = useState(settings.percent == null ? '' : String(settings.percent))
  const [list, setList] = useState(reps.map(r => ({ ...r, pctText: r.percent == null ? '' : String(r.percent) })))
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const defN = parsePercent(def)
  const bad = (defN != null && Number.isNaN(defN)) || list.some(r => { const n = parsePercent(r.pctText); return n != null && Number.isNaN(n) })
  const free = staff.filter(s => !list.some(r => r.employee_id === s.id))
  const q = find.trim().toLowerCase()
  const matches = q ? free.filter(s => `${s.name} ${s.detail}`.toLowerCase().includes(q)).slice(0, 8) : []
  const addRep = (s: Staff) => { setList(l => [...l, { employee_id: s.id, name: s.name, percent: null, active: true, pctText: '' }]); setFind('') }

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
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-medium truncate">{r.name || 'Staff member'}</span>
              {staff.find(x => x.id === r.employee_id)?.detail && <span className="block text-[12px] text-text-secondary truncate">{staff.find(x => x.id === r.employee_id)?.detail}</span>}
            </span>
            <input value={r.pctText} inputMode="decimal" aria-label={`${r.name} %`} placeholder={def ? `${def}` : '%'}
              onChange={e => setList(l => l.map((x, j) => j === i ? { ...x, pctText: e.target.value } : x))}
              className="w-16 h-10 px-2 bg-background border border-border rounded-lg text-[14px] text-right" />
            <span className="text-[13px] text-text-secondary">%</span>
            <button type="button" onClick={() => setList(l => l.map((x, j) => j === i ? { ...x, active: !x.active } : x))}
              className="text-[12.5px] text-primary font-medium h-10 px-1 w-14 text-right">{r.active ? 'Remove' : 'Add back'}</button>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <input value={find} onChange={e => setFind(e.target.value)} aria-label="Find someone to add as a sales rep"
            placeholder="Add a sales rep: type a name, position or number…" className={field.replace('mt-1 ', '')} />
          {q && (
            <ul className="rounded-xl border border-divider divide-y divide-divider overflow-hidden" aria-label="Matching staff">
              {matches.map(s => (
                <li key={s.id}>
                  <button type="button" onClick={() => addRep(s)} className="w-full text-left px-3 py-2 hover:bg-surface-elevated flex items-center gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-medium text-text-primary truncate">{s.name}</span>
                      {s.detail && <span className="block text-[12px] text-text-secondary truncate">{s.detail}</span>}
                    </span>
                    <span className="text-[12.5px] text-primary font-medium shrink-0">Add</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-2 text-[12.5px] text-text-secondary">No one matches “{find.trim()}”.</li>}
            </ul>
          )}
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
