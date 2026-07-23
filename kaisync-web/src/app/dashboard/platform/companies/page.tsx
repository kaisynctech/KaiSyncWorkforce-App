'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  refreshCompanySubscription,
  searchPlatformCompanies,
  setCompanySubscriptionStatus,
} from '@/lib/platform-api'
import type { PlatformCompany } from '@/lib/platform-types'

function fmtMoney(n: number) {
  return `R ${Number(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PlatformCompaniesPage() {
  const [rows, setRows] = useState<PlatformCompany[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q = query) => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    try {
      const data = await searchPlatformCompanies(supabase, q.trim(), 100, 0)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
    setLoading(false)
  }, [query])

  useEffect(() => { void load('') }, [])

  async function suspend(id: string) {
    setBusy(id)
    const supabase = createClient()
    try {
      await setCompanySubscriptionStatus(supabase, id, 'suspended', 'Suspended from Platform Console')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suspend failed')
    }
    setBusy(null)
  }

  async function activate(id: string) {
    setBusy(id)
    const supabase = createClient()
    try {
      await setCompanySubscriptionStatus(supabase, id, 'active', 'Activated from Platform Console')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activate failed')
    }
    setBusy(null)
  }

  async function refresh(id: string) {
    setBusy(id)
    const supabase = createClient()
    try {
      await refreshCompanySubscription(supabase, id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    }
    setBusy(null)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-2 px-4 py-3 border-b border-divider shrink-0">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Search company name or code…"
          className="flex-1 h-9 px-3 border border-border rounded-md text-[13px] bg-background"
        />
        <button onClick={() => load()} className="btn-primary h-9 px-3 text-[13px]">Search</button>
      </div>
      {error && <p className="px-4 py-2 text-[12px] text-error">{error}</p>}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 960 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Company</th>
                <th className="data-th text-left">Code</th>
                <th className="data-th text-left">Plan</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-right">Employees</th>
                <th className="data-th text-right">Monthly</th>
                <th className="data-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-divider">
                  <td className="data-td text-[13px] font-medium">{r.name}</td>
                  <td className="data-td text-[12px] font-mono text-text-secondary">{r.code}</td>
                  <td className="data-td text-[12px]">{r.plan_code ?? '—'}</td>
                  <td className="data-td text-[12px] capitalize">{r.subscription_status}</td>
                  <td className="data-td text-[13px] text-right">
                    {r.employee_count}/{r.employee_limit}
                  </td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.monthly_charge)}</td>
                  <td className="data-td text-right">
                    <div className="inline-flex gap-1">
                      <button
                        disabled={busy === r.id}
                        onClick={() => refresh(r.id)}
                        className="h-7 px-2 rounded text-[11px] border border-border text-text-secondary disabled:opacity-50"
                      >
                        Refresh
                      </button>
                      {r.subscription_status === 'suspended' || !r.subscription_active ? (
                        <button
                          disabled={busy === r.id}
                          onClick={() => activate(r.id)}
                          className="h-7 px-2 rounded text-[11px] bg-success-dark text-success disabled:opacity-50"
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          disabled={busy === r.id}
                          onClick={() => suspend(r.id)}
                          className="h-7 px-2 rounded text-[11px] bg-error-dark text-error disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-center text-[13px] text-text-secondary py-10">No companies found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
