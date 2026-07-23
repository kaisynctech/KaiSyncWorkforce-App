'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { searchPlatformCompanies } from '@/lib/platform-api'
import type { PlatformCompany } from '@/lib/platform-types'

function fmtMoney(n: number) {
  return `R ${Number(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PlatformSubscriptionsPage() {
  const [rows, setRows] = useState<PlatformCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const data = await searchPlatformCompanies(supabase, '', 200, 0)
    setRows(data)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter(r => r.subscription_status === filter)
  }, [rows, filter])

  const mrr = useMemo(
    () => rows
      .filter(r => ['active', 'trialing'].includes(r.subscription_status))
      .reduce((s, r) => s + Number(r.monthly_charge ?? 0), 0),
    [rows],
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider shrink-0 flex-wrap">
        <div>
          <p className="text-[13px] text-text-secondary">Estimated MRR (active + trialing)</p>
          <p className="text-[18px] font-bold text-text-primary">{fmtMoney(mrr)}</p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-9 px-3 border border-border rounded-md text-[13px] bg-background"
          >
            <option value="all">All statuses</option>
            {['active', 'trialing', 'past_due', 'suspended', 'cancelled', 'unknown'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={load} className="text-[13px] text-primary">Refresh</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 800 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Company</th>
                <th className="data-th text-left">Plan</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-right">Employees</th>
                <th className="data-th text-right">Monthly charge</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-divider">
                  <td className="data-td text-[13px] font-medium">{r.name}</td>
                  <td className="data-td text-[12px]">{r.plan_code ?? '—'}</td>
                  <td className="data-td text-[12px] capitalize">{r.subscription_status}</td>
                  <td className="data-td text-[13px] text-right">{r.employee_count}/{r.employee_limit}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.monthly_charge)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center text-[13px] text-text-secondary py-10">No subscriptions</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
