'use client'

/**
 * Money: how the business is doing. Overview (charts), Totals (income and expenses), client, supplier and
 * contractor accounts, payroll, and subscriptions & expenses — all for one period.
 * Owner, HR and admins (the same people who can see payslips).
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatRand } from '@/lib/line-items'
import { loadMoneyOverview, totals, type MoneyOverview } from '@/lib/money/overview'
import { presetRange, describeRange, type DateRange, type PresetKey } from '@/lib/insights/period'
import { moneyShort } from '@/lib/insights/format'
import { DateRangePicker } from '@/components/insights/DateRangePicker'
import { ColumnChart } from '@/components/insights/viz'
import { ExpensesManager } from '@/components/money/ExpensesManager'
import { RemindButton, StatementButton } from '@/components/money/StatementActions'

type Tab = 'overview' | 'totals' | 'clients' | 'suppliers' | 'contractors' | 'payroll' | 'expenses'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'totals', label: 'Totals' },
  { key: 'clients', label: 'Client accounts' },
  { key: 'suppliers', label: 'Supplier accounts' },
  { key: 'contractors', label: 'Contractor accounts' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'expenses', label: 'Subscriptions & expenses' },
]
const HEADINGS: Record<Tab, string> = {
  overview: 'How the business is doing', totals: 'Everything in and out', clients: 'Client accounts', suppliers: 'Supplier accounts',
  contractors: 'Contractor accounts', payroll: 'Payroll', expenses: 'Subscriptions & expenses',
}
const QUICK: { key: Exclude<PresetKey, 'custom'>; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'Quarter' },
  { key: 'ytd', label: 'Year' },
]
const OUT_COLORS = { payroll: '#2563EB', contractors: '#7C3AED', suppliers: '#0EA5E9', expenses: '#F59E0B', refunds: '#DC2626' }

const R = formatRand
const dash = (n: number) => (Math.abs(n) > 0.004 ? R(n) : '—')
const day = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const monthShort = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-ZA', { month: 'short' })
const initials = (s: string) => s.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

export default function MoneyPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <MoneyInner />
    </Suspense>
  )
}

function MoneyInner() {
  const router = useRouter()
  const params = useSearchParams()
  const tab = (TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview') as Tab
  const [preset, setPreset] = useState<PresetKey>('this_month')
  const [range, setRange] = useState<DateRange>(() => presetRange('this_month'))
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [data, setData] = useState<MoneyOverview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void resolveCurrentMember(createClient()).then(m => { if (m) setCompanyId(m.companyId) })
  }, [])

  const load = useCallback(async () => {
    if (!companyId) return
    try {
      const o = await loadMoneyOverview(createClient(), companyId, range.from, range.to)
      setData(o); setState('ready')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load'
      if (msg === 'NOT_ALLOWED') setState('denied')
      else { setError(msg); setState('error') }
    }
  }, [companyId, range])

  useEffect(() => { void load() }, [load])

  function setTab(t: Tab) {
    const q = new URLSearchParams(params.toString())
    if (t === 'overview') q.delete('tab'); else q.set('tab', t)
    router.replace(`/dashboard/money${q.toString() ? `?${q}` : ''}`, { scroll: false })
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 pb-14 flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Money</p>
            <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">{HEADINGS[tab]}</h1>
            <p className="text-[12.5px] text-text-secondary mt-0.5">{describeRange(range)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-surface-card border border-divider rounded-xl p-1">
              {QUICK.map(q => (
                <button key={q.key} type="button" onClick={() => { setPreset(q.key); setRange(presetRange(q.key)) }}
                  className={`h-8 px-3 rounded-lg text-[12.5px] font-medium ${preset === q.key ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                  {q.label}
                </button>
              ))}
            </div>
            <DateRangePicker preset={preset} range={range}
              onPreset={k => { setPreset(k); setRange(presetRange(k)) }}
              onCustom={r => { setPreset('custom'); setRange(r) }} />
          </div>
        </div>

        <div className="flex gap-1 border-b border-divider overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`h-11 px-3.5 text-[13.5px] whitespace-nowrap border-b-2 -mb-px ${tab === t.key ? 'border-primary text-primary font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary font-medium'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {state === 'denied' && (
          <Box className="p-8 text-center">
            <p className="text-[15px] font-semibold text-text-primary">Only the owner, HR and admins can see the company’s money</p>
            <p className="text-[13px] text-text-secondary mt-1">Quotes and invoices are still under Money in the menu.</p>
          </Box>
        )}
        {state === 'error' && <Box className="p-5 text-[13px] text-error">Could not load the figures: {error}</Box>}
        {state === 'loading' && <Box className="p-8 text-center text-[13px] text-text-secondary">Adding up the numbers…</Box>}

        {state === 'ready' && data && companyId && (
          <>
            {tab === 'overview' && <Overview o={data} goto={setTab} />}
            {tab === 'totals' && <Totals o={data} />}
            {tab === 'clients' && <Clients o={data} companyId={companyId} />}
            {tab === 'suppliers' && <Suppliers o={data} companyId={companyId} />}
            {tab === 'contractors' && <Contractors o={data} companyId={companyId} />}
            {tab === 'payroll' && <Payroll o={data} />}
            {tab === 'expenses' && <ExpensesManager companyId={companyId} vatRegistered={data.vat_registered} onChanged={() => void load()} />}
          </>
        )}
      </div>
    </div>
  )
}

/* ── Building blocks ─────────────────────────────────────────────────────────────────────────────── */

function Box({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface-card border border-divider rounded-2xl ${className}`}>{children}</div>
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'bad' | 'purple' }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : tone === 'purple' ? 'text-violet-700' : 'text-text-primary'
  return (
    <Box className="px-4 py-3.5 flex flex-col gap-1 min-w-0">
      <span className="text-[12px] text-text-secondary">{label}</span>
      <span className={`text-[19px] font-bold tabular-nums truncate ${color}`}>{value}</span>
      {note && <span className="text-[11.5px] text-text-secondary/80">{note}</span>}
    </Box>
  )
}

function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>{children}</div>
}

function H2({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-semibold text-text-primary">{children}</h2>
      {right}
    </div>
  )
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-2 border-t border-divider/70 ${strong ? 'text-[14.5px] font-bold' : 'text-[13.5px] text-text-secondary'}`}>
      <span className={strong ? '' : ''} style={color ? { color } : undefined}>{label}</span>
      <span className={`tabular-nums ${strong ? '' : 'text-text-primary'}`} style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

function Table({ head, children, minWidth = 820 }: { head: { label: string; right?: boolean }[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <Box className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
          <thead>
            <tr className="bg-surface-elevated text-text-secondary">
              {head.map((h, i) => <th key={i} className={`px-4 py-3 font-medium ${h.right ? 'text-right' : 'text-left'}`}>{h.label}</th>)}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Box>
  )
}

function Empty({ text }: { text: string }) {
  return <Box className="px-5 py-10 text-center text-[13px] text-text-secondary">{text}</Box>
}

/* ── Overview ────────────────────────────────────────────────────────────────────────────────────── */

function Overview({ o, goto }: { o: MoneyOverview; goto: (t: Tab) => void }) {
  const t = totals(o)
  const cashIn = o.clients.received
  const net = cashIn - o.cash_out_total
  const parts = [
    { key: 'payroll', label: 'Employees (paid to them)', value: o.cash_out.payroll },
    { key: 'contractors', label: 'Contractors', value: o.cash_out.contractors },
    { key: 'suppliers', label: 'Suppliers', value: o.cash_out.suppliers },
    { key: 'expenses', label: 'Subscriptions and expenses', value: o.cash_out.expenses },
    { key: 'refunds', label: 'Refunds to clients', value: o.cash_out.refunds },
  ] as const
  const outSum = parts.reduce((s, p) => s + p.value, 0)
  const funnel = [
    { label: 'Quoted', value: o.quotes.quoted, count: `${o.quotes.quoted_count} quotes` },
    { label: 'Accepted', value: o.quotes.accepted, count: `${o.quotes.accepted_count} accepted` },
    { label: 'Invoiced', value: o.quotes.invoiced, count: `${o.quotes.invoiced_count} invoiced` },
    { label: 'Paid', value: o.quotes.paid, count: `${o.quotes.paid_count} paid in full` },
  ]
  const conv = o.quotes.quoted > 0 ? Math.round((o.quotes.invoiced / o.quotes.quoted) * 100) : null
  const age = [
    { label: 'Not due', value: o.clients.not_due, color: '#10B981' },
    { label: '30 days', value: o.clients.d30, color: '#F59E0B' },
    { label: '60 days', value: o.clients.d60, color: '#F97316' },
    { label: '90+ days', value: o.clients.d90, color: '#DC2626' },
  ]
  const attention = [
    o.clients.late_60 > 0 && { tone: '#DC2626', text: `${o.clients.late_60} ${o.clients.late_60 === 1 ? 'invoice is' : 'invoices are'} more than 60 days late`, href: '/dashboard/money/invoices', action: 'See' },
    o.suppliers.due_soon > 0 && { tone: '#F59E0B', text: `${o.suppliers.due_soon} supplier ${o.suppliers.due_soon === 1 ? 'bill is' : 'bills are'} due this week or overdue`, href: '/dashboard/finance/supplier-invoices', action: 'Pay' },
    (o.suppliers.to_approve + o.contractors.waiting_count) > 0 && { tone: '#7C3AED', text: `${o.suppliers.to_approve + o.contractors.waiting_count} bills and payouts need approval`, href: '/dashboard/finance/approvals', action: 'Approve' },
    o.expenses.due_soon > 0 && { tone: '#2563EB', text: `${o.expenses.due_soon} ${o.expenses.due_soon === 1 ? 'subscription is' : 'subscriptions are'} due in the next 14 days`, href: '/dashboard/money/subscriptions', action: 'View' },
  ].filter(Boolean) as { tone: string; text: string; href: string; action: string }[]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-4">
        <Box className="flex-[1_1_280px] p-5 flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700"><span className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500" />Money in</span>
          <span className="text-[28px] font-bold tracking-tight tabular-nums">{R(cashIn)}</span>
          <span className="text-[12.5px] text-text-secondary">Payments received from clients</span>
        </Box>
        <Box className="flex-[1_1_280px] p-5 flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-amber-700"><span className="w-2.5 h-2.5 rounded-[3px] bg-amber-500" />Money out</span>
          <span className="text-[28px] font-bold tracking-tight tabular-nums">{R(o.cash_out_total)}</span>
          <span className="text-[12.5px] text-text-secondary">Employees, contractors, suppliers, expenses, refunds</span>
        </Box>
        <div className="flex-[1_1_280px] rounded-2xl p-5 flex flex-col gap-1.5 bg-[#1E3A8A] text-white">
          <span className="text-[13px] font-semibold text-blue-200">What’s left (cash)</span>
          <span className="text-[28px] font-bold tracking-tight tabular-nums">{R(net)}</span>
          <span className="text-[12.5px] text-blue-100">Money in minus money out</span>
        </div>
      </div>

      <KpiRow>
        <Kpi label="Invoiced" value={R(o.income.invoiced)} note={`${o.income.invoice_count} invoices, excl. VAT`} />
        <Kpi label="Clients owe you" value={R(o.clients.owed)} note={`${o.clients.open_invoices} invoices open`} />
        <Kpi label="You owe suppliers" value={R(o.suppliers.owe)} note={o.suppliers.overdue > 0 ? `${R(o.suppliers.overdue)} overdue` : 'Nothing overdue'} />
        <Kpi label="Contractor payouts due" value={R(o.contractors.approved_unpaid + o.contractors.waiting)} note={`${o.contractors.waiting_count} waiting for approval`} />
        <Kpi label="Profit" value={R(t.profit)} note="Income minus expenses" tone={t.profit < 0 ? 'bad' : 'good'} />
      </KpiRow>

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_560px] min-w-0 flex flex-col gap-5">
          <Box className="p-5">
            <H2 right={
              <span className="flex gap-3 text-[12px] text-text-secondary">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500" />In</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-amber-500" />Out</span>
              </span>}>In and out, last 6 months</H2>
            <div className="mt-3">
              <ColumnChart
                data={o.series.map(s => ({ m: monthShort(s.month), in: s.in, out: s.out }))}
                xKey="m"
                series={[{ key: 'in', name: 'In', color: '#10B981' }, { key: 'out', name: 'Out', color: '#F59E0B' }]}
                yFormat={moneyShort}
                height={220}
              />
            </div>
          </Box>

          <Box className="p-5 flex flex-col gap-3">
            <H2>Where the money went</H2>
            {outSum > 0 ? (
              <>
                <div className="flex h-3.5 rounded-full overflow-hidden bg-surface-elevated">
                  {parts.filter(p => p.value > 0).map(p => <div key={p.key} style={{ width: `${(p.value / outSum) * 100}%`, background: OUT_COLORS[p.key] }} />)}
                </div>
                <div>
                  {parts.map(p => (
                    <div key={p.key} className="flex items-center gap-2.5 py-2 border-t border-divider/70 text-[13.5px]">
                      <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: OUT_COLORS[p.key] }} />
                      <span className="flex-1">{p.label}</span>
                      <span className="w-12 text-right text-[12px] text-text-secondary">{outSum > 0 ? `${Math.round((p.value / outSum) * 1000) / 10}%` : ''}</span>
                      <span className="w-[130px] text-right font-semibold tabular-nums">{R(p.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-[13px] text-text-secondary">Nothing paid out in this period.</p>}
          </Box>

          <Box className="p-5 flex flex-col gap-3">
            <H2 right={conv !== null ? <span className="text-[12.5px] text-text-secondary">{conv}% of the quoted value was invoiced</span> : null}>Quotes to invoices</H2>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              {funnel.map(f => (
                <div key={f.label} className="border border-divider rounded-xl px-3.5 py-3 flex flex-col gap-1.5">
                  <span className="text-[12px] text-text-secondary">{f.label}</span>
                  <span className="text-[17px] font-bold tabular-nums">{R(f.value)}</span>
                  <span className="text-[11.5px] text-text-secondary/80">{f.count}</span>
                  <div className="h-1.5 rounded-full bg-primary/10 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${o.quotes.quoted > 0 ? Math.min(100, (f.value / o.quotes.quoted) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Box>
        </div>

        <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-5">
          <Box className="p-5 flex flex-col gap-1">
            <H2 right={<button type="button" onClick={() => goto('clients')} className="text-[12.5px] font-semibold text-primary">All clients</button>}>Who owes you</H2>
            <p className="text-[24px] font-bold tabular-nums mt-1">{R(o.clients.owed)}</p>
            {o.clients.owed > 0 && (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden my-1.5">
                  {age.filter(a => a.value > 0).map(a => <div key={a.label} style={{ width: `${(a.value / o.clients.owed) * 100}%`, background: a.color }} />)}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] mb-2">
                  {age.map(a => <span key={a.label} style={{ color: a.color }}>● {a.label} {Math.round((a.value / o.clients.owed) * 100)}%</span>)}
                </div>
              </>
            )}
            {o.clients.accounts.slice(0, 5).map(c => (
              <div key={c.client_id ?? c.name} className="flex items-center gap-2.5 py-2 border-t border-divider/70">
                <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-[11.5px] flex items-center justify-center shrink-0">{initials(c.name)}</span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[13px] font-medium truncate">{c.name}</span>
                  <span className={`text-[11.5px] ${c.d90 > 0 ? 'text-red-700' : c.d60 > 0 ? 'text-orange-700' : c.d30 > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {(c.oldest_days ?? 0) > 0 ? `${c.oldest_days} days late` : 'Not due yet'}
                  </span>
                </span>
                <span className="text-[13px] font-semibold tabular-nums">{R(c.owed)}</span>
              </div>
            ))}
          </Box>

          <Box className="p-5 flex flex-col gap-2.5">
            <H2>Needs your attention</H2>
            {attention.length === 0 && <p className="text-[13px] text-text-secondary">Nothing waiting on you.</p>}
            {attention.map(a => (
              <Link key={a.text} href={a.href} className="flex items-center gap-2.5 border border-divider/70 rounded-xl px-3 py-2.5 hover:bg-surface-elevated/60">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.tone }} />
                <span className="flex-1 text-[13px] text-text-primary">{a.text}</span>
                <span className="text-[12.5px] font-semibold text-primary">{a.action}</span>
              </Link>
            ))}
          </Box>

          {o.vat_registered && (
            <Box className="p-5 flex flex-col gap-1">
              <H2>VAT for this period</H2>
              <Row label="VAT on your invoices" value={R(o.vat.output)} />
              <Row label="VAT you paid (claimable)" value={`− ${R(o.vat.input)}`} />
              <Row label="To pay SARS" value={R(o.vat.output - o.vat.input)} strong />
              <p className="text-[11.5px] text-text-secondary/80 mt-1">Check with your accountant before filing.</p>
            </Box>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Totals ──────────────────────────────────────────────────────────────────────────────────────── */

function Totals({ o }: { o: MoneyOverview }) {
  const t = totals(o)
  return (
    <div className="flex flex-wrap gap-5 items-start">
      <Box className="flex-[999_1_560px] min-w-0 p-6 flex flex-col">
        <H2 right={<button type="button" onClick={() => window.print()} className="h-9 px-3 rounded-lg border border-divider text-[12.5px] text-text-primary hover:bg-surface-elevated">Print</button>}>
          Income and expenses
        </H2>
        <p className="mt-5 mb-1 text-[12px] font-semibold uppercase tracking-wider text-emerald-700">Income</p>
        <Row label={`Invoiced to clients (${o.income.invoice_count})`} value={R(o.income.invoiced)} />
        <Row label={`Less credit notes${o.income.credit_note_count ? ` (${o.income.credit_note_count})` : ''}`} value={o.income.credit_notes ? `− ${R(o.income.credit_notes)}` : R(0)} />
        <Row label="Total income" value={R(t.income)} strong color="#047857" />
        <p className="mt-6 mb-1 text-[12px] font-semibold uppercase tracking-wider text-amber-700">Expenses</p>
        {t.lines.map(l => <Row key={l.key} label={l.label} value={R(l.value)} />)}
        <Row label="Total expenses" value={R(t.expenses)} strong color="#B45309" />
        <div className={`mt-5 flex justify-between items-baseline rounded-xl px-4 py-3.5 ${t.profit < 0 ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>
          <span className="text-[15px] font-semibold">{t.profit < 0 ? 'Loss' : 'Profit'}</span>
          <span className="text-[24px] font-bold tabular-nums">{R(t.profit)}</span>
        </div>
        <p className="mt-2 text-[11.5px] text-text-secondary/80">
          Amounts exclude VAT. Income is what you invoiced in the period. Employees are the gross pay on payslips ending in the period;
          contractors, suppliers and expenses are what you were billed or paid for in the period.
        </p>
      </Box>
      <div className="flex-[1_1_300px] min-w-0 flex flex-col gap-5">
        <Box className="p-5 flex flex-col">
          <H2>Cash in the bank</H2>
          <div className="mt-2" />
          <Row label="Received from clients" value={R(o.clients.received)} />
          <Row label="Paid out" value={`− ${R(o.cash_out_total)}`} />
          <Row label="Net cash" value={R(o.clients.received - o.cash_out_total)} strong />
        </Box>
        <Box className="p-5 flex flex-col">
          <H2>Still to come in and go out</H2>
          <div className="mt-2" />
          <Row label="Clients owe you" value={R(o.clients.owed)} color="#047857" />
          <Row label="You owe suppliers" value={R(o.suppliers.owe)} color="#B45309" />
          <Row label="You owe contractors" value={R(o.contractors.approved_unpaid)} color="#B45309" />
          <Row label="Payslips not yet paid" value={R(o.payroll.net_unpaid)} color="#B45309" />
          {o.vat_registered && <Row label="VAT to pay SARS" value={R(Math.max(0, o.vat.output - o.vat.input))} color="#B45309" />}
        </Box>
      </div>
    </div>
  )
}

/* ── Accounts ────────────────────────────────────────────────────────────────────────────────────── */

function Clients({ o, companyId }: { o: MoneyOverview; companyId: string }) {
  const c = o.clients
  const [reminded, setReminded] = useState<Record<string, string>>({})
  const loadReminded = useCallback(async () => {
    const { data } = await createClient().from('statement_reminders').select('client_id, created_at')
      .eq('company_id', companyId).eq('status', 'sent').order('created_at', { ascending: false }).limit(500)
    const m: Record<string, string> = {}
    for (const r of (data ?? []) as { client_id: string; created_at: string }[]) if (!m[r.client_id]) m[r.client_id] = day(r.created_at)
    setReminded(m)
  }, [companyId])
  useEffect(() => { void loadReminded() }, [loadReminded])
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Clients owe you" value={R(c.owed)} note={`${c.open_invoices} invoices open`} />
        <Kpi label="Not due yet" value={R(c.not_due)} tone="good" />
        <Kpi label="Overdue" value={R(c.d30 + c.d60 + c.d90)} tone="bad" />
        <Kpi label="Received this period" value={R(c.received)} />
        <Kpi label="Average days to pay" value={c.avg_days_to_pay != null ? `${c.avg_days_to_pay} days` : '—'} note="Invoices paid in the last year" />
      </KpiRow>
      {c.accounts.length === 0 ? <Empty text="No client owes you anything right now." /> : (
        <Table minWidth={1000} head={[{ label: 'Client' }, { label: 'Owes you', right: true }, { label: 'Not due', right: true }, { label: '1–30 days', right: true },
          { label: '31–60 days', right: true }, { label: '60+ days', right: true }, { label: 'Last paid' }, { label: '' }]}>
          {c.accounts.map(a => (
            <tr key={a.client_id ?? a.name} className="border-t border-divider/70">
              <td className="px-4 py-3 font-medium">{a.name}<span className="block text-[11.5px] font-normal text-text-secondary">{a.invoices} {a.invoices === 1 ? 'invoice' : 'invoices'}</span></td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{R(a.owed)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{dash(a.not_due)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-amber-700">{dash(a.d30)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-orange-700">{dash(a.d60)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-red-700">{dash(a.d90)}</td>
              <td className="px-4 py-3 text-text-secondary">
                {day(a.last_paid)}
                {a.client_id && reminded[a.client_id] && <span className="block text-[11px] text-amber-700">Reminded {reminded[a.client_id]}</span>}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {a.client_id && (
                  <span className="inline-flex gap-1.5">
                    <StatementButton kind="client" id={a.client_id} name={a.name} companyId={companyId} />
                    <RemindButton clientId={a.client_id} clientName={a.name} companyId={companyId} lastReminded={reminded[a.client_id]} onSent={() => void loadReminded()} />
                    <Link href={`/dashboard/clients/${a.client_id}`} aria-label={`Open ${a.name}`} className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:bg-surface-elevated">
                      <span className="material-icons text-[18px]">chevron_right</span>
                    </Link>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

function Suppliers({ o, companyId }: { o: MoneyOverview; companyId: string }) {
  const s = o.suppliers
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="You owe suppliers" value={R(s.owe)} />
        <Kpi label="Overdue" value={R(s.overdue)} tone={s.overdue > 0 ? 'bad' : undefined} />
        <Kpi label="Paid to suppliers" value={R(s.paid)} note="This period" />
        <Kpi label="Bills to approve" value={String(s.to_approve)} tone={s.to_approve > 0 ? 'purple' : undefined} />
      </KpiRow>
      {s.accounts.length === 0 ? <Empty text="No supplier bills yet. Capture them under Money → Supplier Invoices." /> : (
        <Table head={[{ label: 'Supplier' }, { label: 'Paid this period', right: true }, { label: 'You owe', right: true }, { label: 'Not due', right: true },
          { label: 'Overdue', right: true }, { label: 'Open bills' }, { label: 'Last paid' }, { label: '' }]}>
          {s.accounts.map(a => (
            <tr key={a.supplier_id ?? a.name} className="border-t border-divider/70">
              <td className="px-4 py-3 font-medium">{a.name}</td>
              <td className="px-4 py-3 text-right tabular-nums">{dash(a.paid)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{dash(a.owe)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{dash(a.not_due)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-red-700">{dash(a.overdue)}</td>
              <td className="px-4 py-3 text-text-secondary">{a.open_bills || '—'}</td>
              <td className="px-4 py-3 text-text-secondary">{day(a.last_paid)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="inline-flex gap-1.5">
                  {a.supplier_id && <StatementButton kind="supplier" id={a.supplier_id} name={a.name} companyId={companyId} />}
                  <Link href="/dashboard/finance/supplier-invoices" className="inline-flex items-center h-8 px-3 rounded-lg bg-primary/10 text-primary text-[12px] font-semibold">Bills</Link>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

function Contractors({ o, companyId }: { o: MoneyOverview; companyId: string }) {
  const c = o.contractors
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Paid to contractors" value={R(c.paid)} note="This period, after retention" />
        <Kpi label="Approved, not paid" value={R(c.approved_unpaid)} tone={c.approved_unpaid > 0 ? 'warn' : undefined} />
        <Kpi label="Waiting for approval" value={R(c.waiting)} note={`${c.waiting_count} payouts`} tone={c.waiting > 0 ? 'purple' : undefined} />
        <Kpi label="Retention held" value={R(c.retention)} />
      </KpiRow>
      {c.accounts.length === 0 ? <Empty text="No contractor payouts yet." /> : (
        <Table head={[{ label: 'Contractor' }, { label: 'Jobs' }, { label: 'Paid this period', right: true }, { label: 'Approved, not paid', right: true },
          { label: 'Waiting approval', right: true }, { label: 'Retention held', right: true }, { label: '' }]}>
          {c.accounts.map(a => (
            <tr key={a.contractor_id ?? a.name} className="border-t border-divider/70">
              <td className="px-4 py-3 font-medium">{a.name}</td>
              <td className="px-4 py-3 text-text-secondary">{a.jobs || '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{dash(a.paid)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{dash(a.approved_unpaid)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-violet-700">{dash(a.waiting)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{dash(a.retention)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {a.contractor_id && (
                  <span className="inline-flex gap-1.5">
                    <StatementButton kind="contractor" id={a.contractor_id} name={a.name} companyId={companyId} />
                    <Link href={`/dashboard/contractors/${a.contractor_id}`} className="inline-flex items-center h-8 px-3 rounded-lg bg-violet-50 text-violet-700 text-[12px] font-semibold">Open</Link>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

function Payroll({ o }: { o: MoneyOverview }) {
  const p = o.payroll
  const pct = p.gross > 0 ? Math.round((p.overtime / p.gross) * 1000) / 10 : 0
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Gross pay" value={R(p.gross)} note={`${p.people} people`} />
        <Kpi label="Paid to employees" value={R(p.net)} note="After deductions" tone="good" />
        <Kpi label="PAYE" value={R(p.paye)} note="To SARS" />
        <Kpi label="UIF" value={R(p.uif)} note="Employee part" />
        <Kpi label="Overtime" value={R(p.overtime)} note={`${pct.toLocaleString('en-ZA')}% of gross`} tone={p.overtime > 0 ? 'warn' : undefined} />
      </KpiRow>
      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_520px] min-w-0">
          {p.departments.length === 0 ? <Empty text="No payslips end in this period." /> : (
            <Table minWidth={560} head={[{ label: 'Department' }, { label: 'People', right: true }, { label: 'Gross pay', right: true }, { label: 'Overtime', right: true }, { label: 'Paid to them', right: true }]}>
              {p.departments.map(d => (
                <tr key={d.name} className="border-t border-divider/70">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{d.people}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{R(d.gross)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{dash(d.overtime)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{R(d.net)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Box className="flex-[1_1_300px] min-w-0 p-5 flex flex-col">
          <H2>Where the gross pay went</H2>
          <div className="mt-2" />
          <Row label="Paid to employees" value={R(p.net)} />
          <Row label="PAYE to SARS" value={R(p.paye)} />
          <Row label="UIF (employee part)" value={R(p.uif)} />
          {p.meibc > 0 && <Row label="Bargaining council (MEIBC)" value={R(p.meibc)} />}
          <Row label="Other deductions" value={R(Math.max(0, p.gross - p.net - p.paye - p.uif - p.meibc))} />
          <Row label="Gross pay" value={R(p.gross)} strong />
          <p className="mt-2 text-[11.5px] text-text-secondary/80">
            From payslips ending in this period. {p.net_unpaid > 0 ? `${R(p.net_unpaid)} is approved or pending but not yet paid. ` : ''}
            Open <Link href="/dashboard/payroll" className="text-primary font-medium">Payroll</Link> for each person’s payslip.
          </p>
        </Box>
      </div>
    </div>
  )
}
