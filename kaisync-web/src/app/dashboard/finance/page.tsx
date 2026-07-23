'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadFinanceDashboardKpis } from '@/lib/finance-dashboard'
import { fmtMoney } from '@/lib/finance-calc'
import type { FinanceDashboardKpis } from '@/lib/finance-types'

type Period = 'month' | '3m' | '6m' | 'year'

function periodRange(key: Period): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  let fromDate = new Date(monthStart)
  if (key === '3m') fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
  else if (key === '6m') fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
  else if (key === 'year') fromDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  return { from: fromDate.toISOString().slice(0, 10), to }
}

function Kpi({ title, value, href }: { title: string; value: string; href?: string }) {
  const body = (
    <div className="bg-surface-card border border-divider rounded-xl p-4">
      <p className="text-[11px] text-text-secondary uppercase tracking-wide">{title}</p>
      <p className="text-[20px] font-bold text-text-primary mt-1">{value}</p>
    </div>
  )
  return href ? <Link href={href} className="hover:opacity-80 transition-opacity">{body}</Link> : body
}

export default function FinanceHubPage() {
  const [period, setPeriod] = useState<Period>('6m')
  const [kpi, setKpi] = useState<FinanceDashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const { from, to } = periodRange(period)
    const data = await loadFinanceDashboardKpis(supabase, member.companyId, from, to)
    setKpi(data)
    setLoading(false)
  }, [period])

  useEffect(() => { void load() }, [load])

  const TILES = [
    { label: 'Client Invoices', href: '/dashboard/finance/invoices', icon: 'receipt_long' },
    { label: 'Supplier Invoices', href: '/dashboard/finance/supplier-invoices', icon: 'storefront' },
    { label: 'Contractor Payouts', href: '/dashboard/finance/contractor-payouts', icon: 'payments' },
    { label: 'Approvals', href: '/dashboard/finance/approvals', icon: 'fact_check' },
  ]

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-[20px] font-semibold text-text-primary">Finance</h1>
        <div className="flex gap-1">
          {(['month', '3m', '6m', 'year'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-medium border ${
                period === p ? 'bg-primary text-white border-primary' : 'border-divider text-text-secondary'
              }`}
            >
              {p === 'month' ? 'Month' : p === 'year' ? 'Year' : p.toUpperCase()}
            </button>
          ))}
          <button onClick={load} className="h-8 px-2.5 rounded-lg text-[11px] border border-divider text-text-secondary">
            Refresh
          </button>
        </div>
      </div>

      {loading || !kpi ? (
        <p className="text-[13px] text-text-secondary text-center py-10">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi title="Revenue" value={fmtMoney(kpi.revenue)} href="/dashboard/finance/invoices" />
            <Kpi title="Outstanding" value={`${fmtMoney(kpi.outstanding)} (${kpi.outstandingCount})`} href="/dashboard/finance/invoices" />
            <Kpi title="Payables" value={fmtMoney(kpi.payables)} href="/dashboard/finance/approvals" />
            <Kpi title="Profit est." value={fmtMoney(kpi.profit)} />
            <Kpi title="Money in" value={fmtMoney(kpi.moneyIn)} />
            <Kpi title="Money out" value={fmtMoney(kpi.moneyOut)} />
            <Kpi title="VAT due" value={fmtMoney(kpi.vatDue)} />
            <Kpi title="Pending approvals" value={String(kpi.pendingApprovals)} href="/dashboard/finance/approvals" />
          </div>

          <div>
            <p className="text-[11px] font-semibold text-text-secondary tracking-wide mb-2">MANAGE</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {TILES.map(t => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="flex items-center gap-3 p-4 rounded-xl border border-divider bg-surface-card hover:border-primary/40 transition-colors"
                >
                  <span className="material-icons text-[22px] text-primary">{t.icon}</span>
                  <span className="text-[13px] font-medium text-text-primary">{t.label}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Link href="/dashboard/finance/invoices/new" className="btn-primary h-10 px-4 text-[13px] inline-flex items-center">
              + New Invoice
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
