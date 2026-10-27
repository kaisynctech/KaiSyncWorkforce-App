'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { searchPlatformCompanies, setCompanyPrice } from '@/lib/platform-api'
import type { PlatformCompany } from '@/lib/platform-types'

function fmtMoney(n: number) {
  return `R ${Number(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PlatformSubscriptionsPage() {
  const [rows, setRows] = useState<PlatformCompany[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const data = await searchPlatformCompanies(supabase, '', 200, 0)
    setRows(data)
    setDrafts(Object.fromEntries(data.map(row => [
      row.id,
      row.price_override == null ? '' : String(row.price_override),
    ])))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const ordered = useMemo(
    () => [...rows].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [rows],
  )

  const filtered = useMemo(() => {
    if (filter === 'all') return ordered
    return ordered.filter(r => r.subscription_status === filter)
  }, [ordered, filter])

  const owed = useMemo(
    () => rows
      .filter(r => ['active', 'trialing'].includes(r.subscription_status))
      .reduce((s, r) => s + Number(r.monthly_charge ?? 0), 0),
    [rows],
  )

  async function save(row: PlatformCompany) {
    const raw = (drafts[row.id] ?? '').trim()
    if (raw === '') {
      setError('Enter an amount, or choose Standard price.')
      return
    }
    const amount = Number(raw)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a price of zero or more.')
      return
    }
    setBusyId(row.id)
    setError(null)
    try {
      const supabase = createClient()
      await setCompanyPrice(supabase, row.id, amount, null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the price')
    } finally {
      setBusyId(null)
    }
  }

  async function useStandard(row: PlatformCompany) {
    setBusyId(row.id)
    setError(null)
    try {
      const supabase = createClient()
      await setCompanyPrice(supabase, row.id, null, null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore the standard price')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider shrink-0 flex-wrap">
        <div>
          <p className="text-[13px] text-text-secondary">Amount owed (active + trialing)</p>
          <p className="text-[18px] font-bold text-text-primary">{fmtMoney(owed)}</p>
          <p className="text-[12px] text-text-secondary mt-1">
            A saved price replaces the standard calculation. KaiSync’s own company is not billed.
          </p>
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
          <button onClick={() => void load()} className="text-[13px] text-primary">Refresh</button>
        </div>
      </div>
      {error && <p className="px-4 py-2 text-[12px] text-error">{error}</p>}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 980 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Code</th>
                <th className="data-th text-left">Company</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-right">Standard</th>
                <th className="data-th text-right">Owes</th>
                <th className="data-th text-left">Agreed price</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-divider">
                  <td className="data-td text-[13px] font-mono">{r.code}</td>
                  <td className="data-td text-[13px] font-medium">{r.name}</td>
                  <td className="data-td text-[12px] capitalize">{r.subscription_status}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.standard_monthly_charge)}</td>
                  <td className="data-td text-[13px] text-right font-medium">{fmtMoney(r.monthly_charge)}</td>
                  <td className="data-td">
                    {r.is_platform_home ? (
                      <span className="text-[12px] text-text-secondary">Not billed</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          inputMode="decimal"
                          value={drafts[r.id] ?? ''}
                          onChange={e => setDrafts(prev => ({ ...prev, [r.id]: e.target.value }))}
                          placeholder="Amount"
                          className="h-8 w-28 px-2 border border-border rounded-md text-[13px] bg-background"
                          aria-label={`Agreed price for company ${r.code}`}
                        />
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void save(r)}
                          className="h-8 px-2 rounded text-[12px] border border-border text-text-primary disabled:opacity-50"
                        >
                          Save
                        </button>
                        {r.price_override != null && (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void useStandard(r)}
                            className="h-8 px-2 rounded text-[12px] text-text-secondary disabled:opacity-50"
                          >
                            Standard price
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center text-[13px] text-text-secondary py-10">No subscriptions</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
