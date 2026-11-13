'use client'

/**
 * Payments received (money in) and Payments made (money out): every payment entry for a period,
 * newest first. Each payment is already its own entry (finance_transactions); this lists them.
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
/** The document a payment belongs to: a client invoice (money in) or a supplier bill / contractor payout (money out). */
type DocRef = { id: string; number: string | null; currency: string | null; party: string | null; href: string; kind: string }

type Period = 'this_month' | 'last_month' | 'year' | 'all'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All' },
]
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
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

export function PaymentsList({ direction }: { direction: 'incoming' | 'outgoing' }) {
  const incoming = direction === 'incoming'
  const [period, setPeriod] = useState<Period>('this_month')
  const [rows, setRows] = useState<Tx[] | null>(null)
  const [docs, setDocs] = useState<Record<string, DocRef>>({})
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
        .eq('direction', direction)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (from) q = q.gte('transaction_date', from)
      if (to) q = q.lte('transaction_date', to)
      const { data, error: err } = await q
      if (!live) return
      if (err) { setError(err.message); setRows([]); return }
      const tx = (data ?? []) as Tx[]
      const map: Record<string, DocRef> = {}
      const idsOf = (table: string) => [...new Set(tx.filter(t => t.source_table === table && t.source_id).map(t => String(t.source_id)))]
      const inChunks = async <T,>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: unknown }>) => {
        const out: T[] = []
        for (let i = 0; i < ids.length; i += 200) out.push(...(((await run(ids.slice(i, i + 200))).data ?? []) as T[]))
        return out
      }
      for (const r of await inChunks<{ id: string; invoice_number: string | null; currency: string | null; clients: { name: string | null } | null }>(
        idsOf('finance_invoices'), c => supabase.from('finance_invoices').select('id, invoice_number, currency, clients(name)').eq('company_id', member.companyId).in('id', c))) {
        map[r.id] = { id: r.id, number: r.invoice_number, currency: r.currency, party: r.clients?.name ?? null, href: `/dashboard/money/invoices/${r.id}`, kind: 'Invoice' }
      }
      for (const r of await inChunks<{ id: string; bill_number: string | null; invoice_number: string | null; contractors: { name: string | null } | null }>(
        idsOf('supplier_invoices'), c => supabase.from('supplier_invoices').select('id, bill_number, invoice_number, contractors!supplier_invoices_supplier_id_fkey(name)').eq('company_id', member.companyId).in('id', c))) {
        map[r.id] = { id: r.id, number: r.bill_number ?? r.invoice_number, currency: null, party: r.contractors?.name ?? null, href: `/dashboard/finance/supplier-invoices/${r.id}`, kind: 'Bill' }
      }
      for (const r of await inChunks<{ id: string; contractors: { name: string | null } | null }>(
        idsOf('contractor_payouts'), c => supabase.from('contractor_payouts').select('id, contractors(name)').eq('company_id', member.companyId).in('id', c))) {
        map[r.id] = { id: r.id, number: null, currency: null, party: r.contractors?.name ?? null, href: '/dashboard/finance/contractor-payouts', kind: 'Payout' }
      }
      if (!live) return
      setDocs(map)
      setRows(tx)
    })()
    return () => { live = false }
  }, [period, direction])

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(t => {
      const d = t.source_id ? docs[t.source_id] : undefined
      return [d?.party, d?.number, t.reference_number, t.notes].some(v => (v ?? '').toLowerCase().includes(s))
    })
  }, [rows, docs, search])

  const total = filtered.reduce((s, t) => s + Number(t.amount ?? 0), 0)

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 pb-14 flex flex-col gap-4">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">{incoming ? 'Money in' : 'Money out'}</p>
          <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">{incoming ? 'Payments received' : 'Payments made'}</h1>
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
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={incoming ? 'Search client, invoice or reference' : 'Search supplier, contractor, bill or reference'}
            aria-label="Search payments"
            className="h-10 flex-1 min-w-[200px] rounded-xl border border-divider bg-surface px-3 text-[14px]" />
        </div>

        {rows && (
          <div className="bg-surface-card border border-divider rounded-2xl px-4 py-3 flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-text-secondary">{filtered.length} {filtered.length === 1 ? 'payment' : 'payments'}</span>
            <span className={cn('text-[20px] font-bold tabular-nums', incoming ? 'text-emerald-700' : 'text-amber-700')}>{fmtMoney(total)}</span>
          </div>
        )}

        {!rows && <p className="text-[13px] text-text-secondary">Loading payments…</p>}
        {error && <p className="text-[13px] text-error">Could not load payments: {error}</p>}
        {rows && filtered.length === 0 && !error && (
          <p className="text-[13px] text-text-secondary py-6 text-center">No payments {incoming ? 'received' : 'made'} {period === 'all' ? 'yet' : 'in this period'}.</p>
        )}

        {filtered.length > 0 && (
          <ul className="flex flex-col bg-surface-card border border-divider rounded-2xl divide-y divide-divider overflow-hidden">
            {filtered.map(t => {
              const d = t.source_id ? docs[t.source_id] : undefined
              const inner = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-text-primary truncate">{d?.party ?? t.notes ?? 'Payment'}</span>
                    <span className="block text-[12px] text-text-secondary truncate">
                      {[day(t.transaction_date), d?.number ? `${d.kind} ${d.number}` : d?.kind ?? null,
                        t.payment_method ? (PAYMENT_METHOD_LABEL[t.payment_method] ?? t.payment_method) : null,
                        t.reference_number && t.reference_number !== d?.number ? `ref ${t.reference_number}` : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={cn('text-[14.5px] font-semibold tabular-nums shrink-0', incoming ? 'text-emerald-700' : 'text-text-primary')}>{fmtMoney(Number(t.amount ?? 0), d?.currency ?? null)}</span>
                </>
              )
              return (
                <li key={t.id}>
                  {d
                    ? <Link href={d.href} prefetch={false} className="flex items-center gap-3 px-4 py-3 min-h-[56px] hover:bg-surface-elevated/60">{inner}</Link>
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
