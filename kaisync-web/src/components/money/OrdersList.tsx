'use client'

/**
 * Money → Orders: every accepted quote, with what has been invoiced, paid and is still owing.
 * Opening one shows the order page (/dashboard/money/orders/<quote id>) with everything for it in one place.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatCurrency } from '@/lib/currencies'
import { ResponsiveDataView } from '@/components/ui/ResponsiveDataView'
import { MONEY_TD, MONEY_TH } from '@/components/ui/StatusFilterTabs'
import { ORDER_STATE, orderMoney, type OrderInvoice, type OrderMoney, type OrderState } from '@/lib/money/orders'
import { cn } from '@/lib/utils'

type QuoteRow = {
  id: string; quote_number: string | null; title: string | null; currency: string | null
  subtotal: number | null; total_amount: number | null; cost_total: number | null; gross_margin_percent: number | null
  accepted_at: string | null; updated_at: string | null; job_id: string | null; deal_id: string | null
  clients?: { name: string } | null
  jobs?: { job_code: string | null; title: string | null } | null
  client_deals?: { project_code: string | null; title: string | null } | null
}
type Row = QuoteRow & { money: OrderMoney; link: string | null }

const TABS: { id: string; label: string; states: OrderState[] | null }[] = [
  { id: 'all', label: 'All', states: null },
  { id: 'to_invoice', label: 'To invoice', states: ['to_invoice', 'draft', 'part_invoiced'] },
  { id: 'owing', label: 'Waiting for payment', states: ['invoiced', 'part_paid', 'part_invoiced'] },
  { id: 'paid', label: 'Paid', states: ['paid'] },
]

const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: '2-digit' }) : '—')

export function OrdersList() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const { data: qs, error: qErr } = await supabase.from('commercial_quotes')
      .select('id, quote_number, title, currency, subtotal, total_amount, cost_total, gross_margin_percent, accepted_at, updated_at, job_id, deal_id, clients(name), jobs!commercial_quotes_job_id_fkey(job_code, title), client_deals!commercial_quotes_deal_id_fkey(project_code, title)')
      .eq('company_id', member.companyId).eq('status', 'accepted')
      .order('accepted_at', { ascending: false, nullsFirst: false }).limit(500)
    if (qErr) { setError(qErr.message); setLoading(false); return }
    const quotes = (qs ?? []) as unknown as QuoteRow[]
    const ids = quotes.map(q => q.id)
    const invs: OrderInvoice[] = []
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from('finance_invoices')
        .select('id, quote_id, invoice_number, status, currency, subtotal, total_amount, amount_paid, balance_due, issue_date, due_date')
        .eq('company_id', member.companyId).in('quote_id', ids.slice(i, i + 150))
      invs.push(...((data ?? []) as OrderInvoice[]))
    }
    setRows(quotes.map(q => {
      const link = q.deal_id && q.client_deals ? [q.client_deals.project_code, q.client_deals.title].filter(Boolean).join(' · ')
        : q.job_id && q.jobs ? [q.jobs.job_code, q.jobs.title].filter(Boolean).join(' · ') : null
      return { ...q, link, money: orderMoney(Number(q.total_amount) || 0, invs.filter(i => i.quote_id === q.id)) }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const searched = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? rows.filter(r => [r.quote_number, r.title, r.clients?.name, r.link].some(v => (v ?? '').toLowerCase().includes(s))) : rows
  }, [rows, search])
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.id, t.states ? searched.filter(r => t.states!.includes(r.money.state)).length : searched.length])), [searched])
  const shown = useMemo(() => {
    const t = TABS.find(x => x.id === tab)
    return t?.states ? searched.filter(r => t.states!.includes(r.money.state)) : searched
  }, [searched, tab])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 border-b border-divider bg-surface shrink-0">
        <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Orders</h1>
        <p className="text-[11px] text-text-secondary mt-0.5">Accepted quotes, with everything done for each one: invoices, payments, purchasing and credit notes</p>
      </div>
      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order, client, title, job or project…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]" />
        <div className="flex gap-1 flex-wrap ml-auto">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors',
                tab === t.id ? 'bg-slate-800 text-white border-slate-800' : 'border-divider text-text-primary hover:bg-surface-elevated bg-surface')}>
              {t.label} <span className="opacity-70 font-medium">({counts[t.id] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="py-16 text-center text-[13px] text-text-secondary">Loading…</p>
        ) : error ? (
          <p className="py-16 text-center text-[13px] text-error">{error}</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="material-icons text-[40px] text-text-disabled">assignment_turned_in</span>
            <p className="text-text-secondary text-[13px] font-medium">No orders here</p>
            <p className="text-[11px] text-text-secondary">When a client accepts a quote, it becomes an order.</p>
          </div>
        ) : (
          <ResponsiveDataView table={
            <table className="w-full" style={{ minWidth: 900 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>Order</th>
                  <th className={`${MONEY_TH} text-left`}>Client</th>
                  <th className={`${MONEY_TH} text-left`}>Title / job or project</th>
                  <th className={`${MONEY_TH} text-left`}>Accepted</th>
                  <th className={`${MONEY_TH} text-right`}>Value</th>
                  <th className={`${MONEY_TH} text-right`}>Invoiced</th>
                  <th className={`${MONEY_TH} text-right`}>Paid</th>
                  <th className={`${MONEY_TH} text-right`}>Owing</th>
                  <th className={`${MONEY_TH} text-right`} title="Only your team sees this">Margin</th>
                  <th className={`${MONEY_TH} text-left`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const st = ORDER_STATE[r.money.state]
                  const cur = r.currency
                  return (
                    <tr key={r.id} onClick={() => router.push(`/dashboard/money/orders/${r.id}`)}
                      className="bg-surface-card border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated">
                      <td className={`${MONEY_TD} font-mono text-text-secondary`}>{r.quote_number ?? '—'}</td>
                      <td className={`${MONEY_TD} text-text-primary max-w-[180px] truncate`}>{r.clients?.name ?? '—'}</td>
                      <td className={`${MONEY_TD} max-w-[260px]`}>
                        <p className="text-text-primary truncate">{r.title || 'Quotation'}</p>
                        {r.link && <p className="text-[10.5px] text-text-secondary truncate">{r.link}</p>}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary`}>{fmtDay(r.accepted_at ?? r.updated_at)}</td>
                      <td className={`${MONEY_TD} text-right font-medium text-text-primary tabular-nums`}>{formatCurrency(r.money.value, cur)}</td>
                      <td className={`${MONEY_TD} text-right tabular-nums`}>{r.money.invoiced ? formatCurrency(r.money.invoiced, cur) : '—'}</td>
                      <td className={`${MONEY_TD} text-right tabular-nums text-emerald-700`}>{r.money.paid ? formatCurrency(r.money.paid, cur) : '—'}</td>
                      <td className={`${MONEY_TD} text-right tabular-nums ${r.money.owing > 0.004 ? 'text-error font-medium' : ''}`}>{r.money.owing > 0.004 ? formatCurrency(r.money.owing, cur) : '—'}</td>
                      <td className={`${MONEY_TD} text-right tabular-nums text-text-secondary`}>{Number(r.cost_total) > 0 ? `${Math.round(Number(r.gross_margin_percent) * 10) / 10}%` : '—'}</td>
                      <td className={MONEY_TD}><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          } />
        )}
      </div>
    </div>
  )
}
