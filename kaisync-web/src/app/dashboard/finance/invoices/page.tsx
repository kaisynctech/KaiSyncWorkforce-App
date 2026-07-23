'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { FinanceInvoice } from '@/lib/finance-types'

export default function FinanceInvoicesPage() {
  const router = useRouter()
  const [rows, setRows] = useState<FinanceInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const { data } = await supabase
      .from('finance_invoices')
      .select('*, clients(name)')
      .eq('company_id', member.companyId)
      .order('issue_date', { ascending: false })
    setRows((data ?? []) as FinanceInvoice[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = rows.filter(r => {
    if (status !== 'all' && r.status !== status) return false
    if (search) {
      const q = search.toLowerCase()
      const client = (r.clients as { name: string } | null)?.name ?? ''
      return (
        (r.invoice_number ?? '').toLowerCase().includes(q) ||
        client.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
        <h1 className="text-[18px] font-semibold text-text-primary">Client Invoices</h1>
        <Link href="/dashboard/finance/invoices/new" className="btn-primary h-9 px-3 text-[13px]">+ Invoice</Link>
      </div>
      <div className="flex gap-2 px-4 py-2 border-b border-divider shrink-0 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search number or client…"
          className="h-9 px-3 border border-border rounded-md text-[13px] bg-background flex-1 min-w-[180px]"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="h-9 px-3 border border-border rounded-md text-[13px] bg-background"
        >
          <option value="all">All statuses</option>
          {['draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'cancelled'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 800 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Number</th>
                <th className="data-th text-left">Client</th>
                <th className="data-th text-left">Issue</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-right">Total</th>
                <th className="data-th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-divider hover:bg-background cursor-pointer"
                  onClick={() => router.push(`/dashboard/finance/invoices/${r.id}`)}
                >
                  <td className="data-td text-[13px] font-medium">{r.invoice_number || '(draft)'}</td>
                  <td className="data-td text-[13px]">{(r.clients as { name: string } | null)?.name ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">{r.issue_date}</td>
                  <td className="data-td text-[12px] capitalize">{r.status.replace(/_/g, ' ')}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.total_amount)}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.balance_due)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center text-[13px] text-text-secondary py-10">No invoices</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
