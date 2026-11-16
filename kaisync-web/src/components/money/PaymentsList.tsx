'use client'

/**
 * Payments received (money in) and Payments made (money out): every payment entry (finance_transactions), newest first,
 * in the standard Money table (type tabs, column filters). The date filter decides what's loaded (this month by default).
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab } from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter, MoneyHeaderFilter, DateHeaderFilter, StatusHeaderFilter, ResetFiltersButton, matchText, matchMoney, statusTab,
} from '@/components/ui/MoneyListFilters'

type Tx = {
  id: string; source_table: string | null; source_id: string | null; reference_number: string | null; amount: number | null
  payment_method: string | null; notes: string | null; transaction_date: string | null; transaction_type: string | null
}
/** What a payment was for: a client invoice, a supplier bill, a contractor payout, a staff claim or commission. */
type DocRef = { number: string | null; currency: string | null; party: string | null; href: string | null }
type Row = Tx & { status: string; kind: string; party: string; number: string; currency: string | null; href: string | null }

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer', eft: 'EFT', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other', debit_order: 'Debit order',
}

/** source_table → the type tab it belongs to. */
const KIND: Record<string, { id: string; label: string }> = {
  finance_invoices: { id: 'invoice', label: 'Invoice' },
  supplier_invoices: { id: 'bill', label: 'Supplier bill' },
  contractor_payouts: { id: 'payout', label: 'Contractor payout' },
  staff_claims: { id: 'claim', label: 'Staff claim' },
  commission_payments: { id: 'commission', label: 'Commission' },
}
const kindOf = (t: Tx) => KIND[t.source_table ?? ''] ?? (t.transaction_type === 'payroll' ? { id: 'payroll', label: 'Payroll' } : { id: 'other', label: 'Other' })

const TABS_OUT = [
  TAB_ALL,
  statusTab('bill', 'Supplier bills', ['bill'], 'blue'),
  statusTab('payout', 'Contractor payouts', ['payout'], 'indigo'),
  statusTab('claim', 'Staff claims', ['claim'], 'amber'),
  statusTab('commission', 'Commission', ['commission'], 'purple'),
  statusTab('payroll', 'Payroll', ['payroll'], 'green'),
  statusTab('other', 'Other', ['other'], 'gray'),
]
const TABS_IN = [TAB_ALL, statusTab('invoice', 'Invoices', ['invoice'], 'green'), statusTab('other', 'Other', ['other'], 'gray')]

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monthStart = () => { const n = new Date(); return iso(new Date(n.getFullYear(), n.getMonth(), 1)) }
const day = (d: string | null) => d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

type Cols = { party: string; number: string; reference: string; methods: string[]; min: string; max: string }
const EMPTY: Cols = { party: '', number: '', reference: '', methods: [], min: '', max: '' }
const LIMIT = 1000

export function PaymentsList({ direction }: { direction: 'incoming' | 'outgoing' }) {
  const incoming = direction === 'incoming'
  const router = useRouter()
  const tabs = incoming ? TABS_IN : TABS_OUT
  const [range, setRange] = useState({ from: monthStart(), to: '' })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [cols, setCols] = useState<Cols>(EMPTY)
  const patch = (p: Partial<Cols>) => setCols(c => ({ ...c, ...p }))

  useEffect(() => {
    let live = true
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { if (live) setRows([]); return }
      let q = supabase.from('finance_transactions')
        .select('id, source_table, source_id, reference_number, amount, payment_method, notes, transaction_date, transaction_type')
        .eq('company_id', member.companyId).eq('direction', direction)
        .order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT)
      if (range.from) q = q.gte('transaction_date', range.from)
      if (range.to) q = q.lte('transaction_date', range.to)
      const { data, error: err } = await q
      if (!live) return
      if (err) { setError(err.message); setRows([]); return }
      const tx = (data ?? []) as Tx[]
      const docs: Record<string, DocRef> = {}
      const idsOf = (table: string) => [...new Set(tx.filter(t => t.source_table === table && t.source_id).map(t => String(t.source_id)))]
      const inChunks = async <T,>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: unknown }>) => {
        const out: T[] = []
        for (let i = 0; i < ids.length; i += 200) out.push(...(((await run(ids.slice(i, i + 200))).data ?? []) as T[]))
        return out
      }
      const cid = member.companyId
      const name = (e: { name: string | null; surname: string | null } | null) => e ? [e.name, e.surname].filter(Boolean).join(' ') : null
      for (const r of await inChunks<{ id: string; invoice_number: string | null; currency: string | null; clients: { name: string | null } | null }>(
        idsOf('finance_invoices'), c => supabase.from('finance_invoices').select('id, invoice_number, currency, clients(name)').eq('company_id', cid).in('id', c))) {
        docs[r.id] = { number: r.invoice_number, currency: r.currency, party: r.clients?.name ?? null, href: `/dashboard/money/invoices/${r.id}` }
      }
      for (const r of await inChunks<{ id: string; bill_number: string | null; invoice_number: string | null; contractors: { name: string | null } | null }>(
        idsOf('supplier_invoices'), c => supabase.from('supplier_invoices').select('id, bill_number, invoice_number, contractors!supplier_invoices_supplier_id_fkey(name)').eq('company_id', cid).in('id', c))) {
        docs[r.id] = { number: r.bill_number ?? r.invoice_number, currency: null, party: r.contractors?.name ?? null, href: `/dashboard/finance/supplier-invoices/${r.id}` }
      }
      for (const r of await inChunks<{ id: string; contractors: { name: string | null } | null }>(
        idsOf('contractor_payouts'), c => supabase.from('contractor_payouts').select('id, contractors(name)').eq('company_id', cid).in('id', c))) {
        docs[r.id] = { number: null, currency: null, party: r.contractors?.name ?? null, href: '/dashboard/finance/contractor-payouts' }
      }
      for (const r of await inChunks<{ id: string; employees: { name: string | null; surname: string | null } | null }>(
        idsOf('staff_claims'), c => supabase.from('staff_claims').select('id, employees(name, surname)').eq('company_id', cid).in('id', c))) {
        docs[r.id] = { number: null, currency: null, party: name(r.employees), href: '/dashboard/workforce/claims' }
      }
      for (const r of await inChunks<{ id: string; employees: { name: string | null; surname: string | null } | null; commissions: { commercial_quotes: { quote_number: string | null } | null } | null }>(
        idsOf('commission_payments'), c => supabase.from('commission_payments').select('id, employees(name, surname), commissions(commercial_quotes(quote_number))').eq('company_id', cid).in('id', c))) {
        docs[r.id] = { number: r.commissions?.commercial_quotes?.quote_number ?? null, currency: null, party: name(r.employees), href: '/dashboard/workforce/commission' }
      }
      if (!live) return
      setError(null)
      setRows(tx.map(t => {
        const d = t.source_id ? docs[t.source_id] : undefined
        const k = kindOf(t)
        return { ...t, status: k.id, kind: k.label, party: d?.party ?? t.notes ?? 'Payment', number: d?.number ?? '', currency: d?.currency ?? null, href: d?.href ?? null }
      }))
    })()
    return () => { live = false }
  }, [range.from, range.to, direction])

  const afterCols = useMemo(() => (rows ?? []).filter(r =>
    matchText(r.party, cols.party) && matchText(r.number, cols.number) && matchText(r.reference_number, cols.reference)
    && (cols.methods.length === 0 || cols.methods.includes(r.payment_method ?? ''))
    && matchMoney(r.amount, cols.min, cols.max)
    && (!search.trim() || [r.party, r.number, r.reference_number, r.notes, r.kind].some(v => matchText(v, search.trim())))), [rows, cols, search])
  const counts = useMemo(() => countByStatusTab(afterCols, tabs), [afterCols, tabs])
  const filtered = useMemo(() => filterByStatusTab(afterCols, tabs, tab), [afterCols, tabs, tab])
  const methodOptions = useMemo(() => [...new Set((rows ?? []).map(r => r.payment_method ?? '').filter(Boolean))]
    .map(m => ({ id: m, label: PAYMENT_METHOD_LABEL[m] ?? m })), [rows])

  // Totals per currency: a euro invoice's payment is in euros, so it isn't added to the rand total.
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of filtered) m.set(t.currency || 'ZAR', (m.get(t.currency || 'ZAR') ?? 0) + Number(t.amount ?? 0))
    return [...m.entries()].sort((a, b) => (a[0] === 'ZAR' ? -1 : b[0] === 'ZAR' ? 1 : a[0].localeCompare(b[0])))
  }, [filtered])

  const anyFilter = search !== '' || JSON.stringify(cols) !== JSON.stringify(EMPTY) || range.from !== monthStart() || range.to !== ''

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">{incoming ? 'Payments received' : 'Payments made'}</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">
            {rows ? `${filtered.length} payment${filtered.length !== 1 ? 's' : ''} · ` : ''}
            {totals.length === 0 ? fmtMoney(0) : totals.map(([cur, sum]) => fmtMoney(sum, cur)).join(' + ')}
            {range.from || range.to ? ` · ${range.from ? day(range.from) : '…'} to ${range.to ? day(range.to) : 'today'}` : ' · all dates'}
          </p>
        </div>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search payments"
          placeholder={incoming ? 'Search client, invoice or reference…' : 'Search who was paid, bill or reference…'}
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]" />
        <ResetFiltersButton disabled={!anyFilter} onReset={() => { setCols(EMPTY); setSearch(''); setRange({ from: monthStart(), to: '' }) }} />
        <StatusFilterTabs tabs={tabs} value={tab} counts={counts} onChange={setTab} />
      </div>

      <div className="flex-1 overflow-auto">
        {error && <p className="text-[13px] text-error px-4 py-3">Could not load payments: {error}</p>}
        {rows === null ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : (
          <table className="w-full" style={{ minWidth: 820 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <DateHeaderFilter label="Date" from={range.from} to={range.to} onChange={p => setRange(p)} />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label={incoming ? 'From' : 'Paid to'} value={cols.party} onChange={v => patch({ party: v })} placeholder="Name…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>Type</th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="For" value={cols.number} onChange={v => patch({ number: v })} placeholder="Invoice, bill or quote #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter label="Method" options={methodOptions} selected={cols.methods} onChange={methods => patch({ methods })} />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Reference" value={cols.reference} onChange={v => patch({ reference: v })} placeholder="Reference…" />
                </th>
                <th className={`${MONEY_TH} text-right`}>
                  <MoneyHeaderFilter label="Amount" min={cols.min} max={cols.max} onChange={p => patch({ min: p.min, max: p.max })} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className={`border-b border-divider transition-colors ${r.href ? 'cursor-pointer hover:bg-surface-elevated' : ''}`}
                  onClick={() => { if (r.href) router.push(r.href) }}>
                  <td className={`${MONEY_TD} text-text-secondary`}>{day(r.transaction_date)}</td>
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{r.party}</td>
                  <td className={MONEY_TD}>{r.kind}</td>
                  <td className={`${MONEY_TD} ${r.href ? 'text-primary' : 'text-text-secondary'}`}>{r.number || '—'}</td>
                  <td className={MONEY_TD}>{r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{r.reference_number && r.reference_number !== r.number ? r.reference_number : '—'}</td>
                  <td className={`${MONEY_TD} text-right font-medium ${incoming ? 'text-emerald-700' : 'text-text-primary'}`}>{fmtMoney(Number(r.amount ?? 0), r.currency)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center text-[13px] text-text-secondary py-10">
                  {(rows ?? []).length === 0 ? `No payments ${incoming ? 'received' : 'made'} in these dates` : 'No payments match these filters'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
        {rows && rows.length === LIMIT && <p className="text-[12px] text-text-secondary px-4 py-2">Showing the latest {LIMIT}. Narrow the dates to see the rest.</p>}
      </div>
    </div>
  )
}
