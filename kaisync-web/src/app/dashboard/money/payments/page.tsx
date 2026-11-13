'use client'

/**
 * Money → Payments received: every payment that came in, newest first, for a period.
 * Each payment is already its own entry (finance_transactions, direction incoming); this lists them.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { cn } from '@/lib/utils'

type Tx = {
  id: string
  source_table: string | null
  source_id: string | null
  reference_number: string | null
  amount: number | null
  payment_method: string | null
  notes: string | null
  transaction_date: string | null
}
type InvoiceRef = { id: string; invoice_number: string | null; currency: string | null; clients: { name: string | null } | null }

type Period = 'this_month' | 'last_month' | 'year' | 'all'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All' },
]
const METHOD: Record<string, string> = {
  bank_transfer: 'Bank transfer', eft: 'EFT', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other', debit_order: 'Debit order',
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function periodRange(p: Period): { from: string | null; to: string | null } {
  const now = new Date()
  if (p === 'this_month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: null }
  if (p === 'last_month') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (p === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: null }
  return { from: null, to: null }
}
function day(d: string | null) {
  return d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

export default function PaymentsReceivedPage() {
  const [period, setPeriod] = useState<Period>('this_month')
  const [rows, setRows] = useState<Tx[] | null>(null)
  const [invoices, setInvoices] = useState<Record<string, InvoiceRef>>({})
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let live = true
    void (async () => {
      setRows(null)
      setError(null)
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { if (live) setRows([]); return }
      const { from, to } = periodRange(period)
      let q = supabase.from('finance_transactions')
        .select('id, source_table, source_id, reference_number, amount, payment_method, notes, transaction_date')
        .eq('company_id', member.companyId)
        .eq('direction', 'incoming')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (from) q = q.gte('transaction_date', from)
      if (to) q = q.lte('transaction_date', to)
      const { data, error: err } = await q
      if (!live) return
      if (err) { setError(err.message); setRows([]); return }
      const tx = (data ?? []) as Tx[]
      const ids = [...new Set(tx.filter(t => t.source_table === 'finance_invoices' && t.source_id).map(t => String(t.source_id)))]
      const map: Record<string, InvoiceRef> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const { data: inv } = await supabase.from('finance_invoices')
          .select('id, invoice_number, currency, clients(name)')
          .eq('company_id', member.companyId)
          .in('id', ids.slice(i, i + 200))
        for (const r of (inv ?? []) as unknown as InvoiceRef[]) map[r.id] = r
      }
      if (!live) return
      setInvoices(map)
      setRows(tx)
    })()
    return () => { live = false }
  }, [period])

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(t => {
      const inv = t.source_id ? invoices[t.source_id] : undefined
      return [inv?.clients?.name, inv?.invoice_number, t.reference_number, t.notes].some(v => (v ?? '').toLowerCase().includes(s))
    })
  }, [rows, invoices, search])

  const total = filtered.reduce((s, t) => s + Number(t.amount ?? 0), 0)

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 pb-14 flex flex-col gap-4">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Money in</p>
          <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">Payments received</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {PERIODS.map(p => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
                className={cn('h-10 px-3.5 rounded-full text-[13px] font-semibold whitespace-nowrap border',
                  period === p.key ? 'bg-primary border-primary text-white' : 'bg-surface border-divider text-text-secondary hover:text-text-primary')}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, invoice or reference"
            aria-label="Search payments"
            className="h-10 flex-1 min-w-[200px] rounded-xl border border-divider bg-surface px-3 text-[14px]" />
        </div>

        {rows && (
          <div className="bg-surface-card border border-divider rounded-2xl px-4 py-3 flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-text-secondary">{filtered.length} {filtered.length === 1 ? 'payment' : 'payments'}</span>
            <span className="text-[20px] font-bold tabular-nums text-emerald-700">{fmtMoney(total)}</span>
          </div>
        )}

        {!rows && <p className="text-[13px] text-text-secondary">Loading payments…</p>}
        {error && <p className="text-[13px] text-error">Could not load payments: {error}</p>}
        {rows && filtered.length === 0 && !error && (
          <p className="text-[13px] text-text-secondary py-6 text-center">No payments received {period === 'all' ? 'yet' : 'in this period'}.</p>
        )}

        {filtered.length > 0 && (
          <ul className="flex flex-col bg-surface-card border border-divider rounded-2xl divide-y divide-divider overflow-hidden">
            {filtered.map(t => {
              const inv = t.source_id ? invoices[t.source_id] : undefined
              const inner = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-text-primary truncate">{inv?.clients?.name ?? 'Payment'}</span>
                    <span className="block text-[12px] text-text-secondary truncate">
                      {[day(t.transaction_date), inv?.invoice_number ? `Invoice ${inv.invoice_number}` : null,
                        t.payment_method ? (METHOD[t.payment_method] ?? t.payment_method) : null,
                        t.reference_number && t.reference_number !== inv?.invoice_number ? `ref ${t.reference_number}` : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-[14.5px] font-semibold tabular-nums text-emerald-700 shrink-0">{fmtMoney(Number(t.amount ?? 0), inv?.currency ?? null)}</span>
                </>
              )
              return (
                <li key={t.id}>
                  {inv
                    ? <Link href={`/dashboard/money/invoices/${inv.id}`} prefetch={false} className="flex items-center gap-3 px-4 py-3 min-h-[56px] hover:bg-surface-elevated/60">{inner}</Link>
                    : <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">{inner}</div>}
                </li>
              )
            })}
          </ul>
        )}
        {rows && rows.length === 500 && <p className="text-[12px] text-text-secondary">Showing the latest 500. Pick a shorter period to see the rest.</p>}
      </div>
    </div>
  )
}
