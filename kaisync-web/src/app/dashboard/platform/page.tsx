'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchPlatformDashboard } from '@/lib/platform-api'
import type { PlatformDashboard } from '@/lib/platform-types'

function fmtMoney(n: number) {
  return `R ${Number(n ?? 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-surface-card border border-divider rounded-xl p-4">
      <p className="text-[11px] text-text-secondary uppercase tracking-wide">{title}</p>
      <p className="text-[20px] font-bold text-text-primary mt-1">{value}</p>
    </div>
  )
}

export default function PlatformOverviewPage() {
  const [dash, setDash] = useState<PlatformDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const data = await fetchPlatformDashboard(supabase)
    if (!data) setError('Failed to load dashboard')
    setDash(data)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  if (error || !dash) return <p className="p-6 text-[13px] text-error">{error ?? 'No data'}</p>

  const k = dash.kpis

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-secondary">Live platform KPIs</p>
        <button onClick={load} className="text-[13px] text-primary">Refresh</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi title="Companies" value={String(k.total_companies ?? 0)} />
        <Kpi title="Employees" value={String(k.total_employees ?? 0)} />
        <Kpi title="Active today" value={String(k.active_users_today ?? 0)} />
        <Kpi title="MAU" value={String(k.monthly_active_users ?? 0)} />
        <Kpi title="MRR" value={fmtMoney(Number(k.monthly_revenue ?? 0))} />
        <Kpi title="New this month" value={String(k.new_companies_this_month ?? 0)} />
        <Kpi title="Payroll paid" value={String(k.total_payroll_processed ?? 0)} />
        <Kpi title="Invoices" value={String(k.total_invoices_generated ?? 0)} />
        <Kpi title="Errors (mo)" value={String(k.error_count ?? 0)} />
        <Kpi title="Pending feedback" value={String(k.pending_feedback ?? 0)} />
      </div>

      {(dash.trends.company_growth?.length ?? 0) > 0 && (
        <div className="card p-4">
          <p className="text-[12px] font-semibold text-text-secondary mb-3">Company growth (6 mo)</p>
          <div className="flex gap-2 items-end h-28">
            {(dash.trends.company_growth ?? []).map((p, i) => {
              const max = Math.max(...(dash.trends.company_growth ?? []).map(x => Number(x.value) || 0), 1)
              const h = Math.max(8, (Number(p.value) / max) * 100)
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-primary/80 rounded-t" style={{ height: `${h}%` }} />
                  <span className="text-[9px] text-text-secondary truncate w-full text-center">{p.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
