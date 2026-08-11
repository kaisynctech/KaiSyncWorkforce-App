'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { ProjectFinancialSummary } from '@/types/commercial'

type SortKey = 'title' | 'contract_value' | 'gross_profit' | 'gross_margin_percent' | 'total_invoiced' | 'best_actual_cost'
type SortDir = 'asc' | 'desc'

const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  draft:       { bg: '#F3F4F6', fg: '#6B7280' },
  sent:        { bg: '#DBEAFE', fg: '#1E40AF' },
  negotiation: { bg: '#FEF3C7', fg: '#92400E' },
  in_progress: { bg: '#D1FAE5', fg: '#065F46' },
  won:         { bg: '#DCFCE7', fg: '#166534' },
  lost:        { bg: '#FEE2E2', fg: '#991B1B' },
}

function MarginCell({ pct }: { pct: number }) {
  let bg = '#DCFCE7'; let fg = '#166534'
  if (pct < 0)        { bg = '#FEE2E2'; fg = '#991B1B' }
  else if (pct < 10)  { bg = '#FEF3C7'; fg = '#92400E' }
  else if (pct < 20)  { bg = '#FEF9C3'; fg = '#854D0E' }
  return (
    <span
      className="inline-block rounded-lg px-2 py-[2px] text-[11px] font-semibold"
      style={{ backgroundColor: bg, color: fg }}
    >
      {pct.toFixed(1)}%
    </span>
  )
}

export default function ProjectProfitabilityPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ProjectFinancialSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('gross_margin_percent')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const { data: permData } = await supabase.rpc('user_has_permission', {
      p_company_id: member.companyId,
      p_key: 'projects.financials',
    })
    const permitted = Boolean(permData)
    setHasPermission(permitted)
    if (!permitted) { setLoading(false); return }

    const { data, error: err } = await supabase
      .from('project_financial_summary')
      .select('*')
      .eq('company_id', member.companyId)
    if (err) { setError(err.message); setLoading(false); return }
    setRows((data ?? []) as ProjectFinancialSummary[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const filtered = rows.filter(r => statusFilter === 'all' || r.status === statusFilter)
  const sorted = [...filtered].sort((a, b) => {
    const av = Number(a[sortKey] ?? 0)
    const bv = Number(b[sortKey] ?? 0)
    // For 'title', sort as string
    if (sortKey === 'title') {
      return sortDir === 'asc'
        ? String(a.title).localeCompare(String(b.title))
        : String(b.title).localeCompare(String(a.title))
    }
    return sortDir === 'asc' ? av - bv : bv - av
  })

  // Summary totals
  const totals = filtered.reduce(
    (acc, r) => ({
      contract_value:    acc.contract_value    + Number(r.contract_value ?? 0),
      total_invoiced:    acc.total_invoiced    + Number(r.total_invoiced ?? 0),
      best_actual_cost:  acc.best_actual_cost  + Number(r.best_actual_cost ?? 0),
      gross_profit:      acc.gross_profit      + Number(r.gross_profit ?? 0),
    }),
    { contract_value: 0, total_invoiced: 0, best_actual_cost: 0, gross_profit: 0 }
  )
  const overallMargin = totals.total_invoiced > 0
    ? (totals.gross_profit / totals.total_invoiced) * 100
    : 0

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="material-icons text-[14px] text-text-secondary opacity-30 ml-0.5">unfold_more</span>
    return <span className="material-icons text-[14px] text-primary ml-0.5">{sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
  }

  const statuses = ['all', ...Array.from(new Set(rows.map(r => r.status)))]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  if (hasPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="material-icons text-[48px] text-text-secondary">lock</span>
        <p className="text-[15px] font-medium text-text-primary">Financials restricted</p>
        <p className="text-[13px] text-text-secondary">
          You need the{' '}
          <code className="bg-surface-elevated px-1 rounded text-[12px]">projects.financials</code>
          {' '}permission to access this report.
        </p>
        <button onClick={() => router.push('/dashboard/reports')} className="btn-secondary h-9 px-4 text-[13px]">
          Back to reports
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/reports" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Project Profitability</h1>
            <p className="text-[12px] text-text-secondary">{filtered.length} project{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button onClick={() => void load()} className="btn-secondary h-9 px-3 text-[12px]">
          <span className="material-icons text-[15px] mr-1">refresh</span>
          Refresh
        </button>
      </div>

      {error && <p className="px-4 py-2 text-[12px] text-error">{error}</p>}

      {/* KPI summary strip */}
      <div className="grid grid-cols-4 border-b border-divider shrink-0">
        {[
          { label: 'Total contract value', value: fmtMoney(totals.contract_value) },
          { label: 'Total invoiced', value: fmtMoney(totals.total_invoiced) },
          { label: 'Total actual cost', value: fmtMoney(totals.best_actual_cost) },
          { label: 'Overall gross profit', value: fmtMoney(totals.gross_profit), margin: overallMargin },
        ].map(k => (
          <div key={k.label} className="px-4 py-3 border-r border-divider last:border-0">
            <p className="text-[11px] text-text-secondary uppercase tracking-wide">{k.label}</p>
            <p className={`text-[16px] font-semibold mt-0.5 ${k.margin !== undefined && k.margin < 0 ? 'text-error' : 'text-text-primary'}`}>
              {k.value}
            </p>
            {k.margin !== undefined && (
              <MarginCell pct={k.margin} />
            )}
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-divider shrink-0 overflow-x-auto">
        <span className="text-[11px] text-text-secondary shrink-0">Status:</span>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="rounded-lg h-7 px-3 text-[11px] font-medium shrink-0 transition-colors capitalize"
            style={{
              backgroundColor: statusFilter === s ? '#3B82F6' : 'transparent',
              color: statusFilter === s ? '#FFFFFF' : '#6B7280',
              border: `1px solid ${statusFilter === s ? '#3B82F6' : '#E5E7EB'}`,
            }}
          >
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="material-icons text-[40px] text-text-secondary">analytics</span>
            <p className="text-[13px] text-text-secondary">No projects match the current filter.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">
                  <button onClick={() => toggleSort('title')} className="flex items-center">
                    Project <SortIcon k="title" />
                  </button>
                </th>
                <th style={{ width: 88 }} className="data-th text-center">Status</th>
                <th style={{ width: 120 }} className="data-th text-right">
                  <button onClick={() => toggleSort('contract_value')} className="flex items-center justify-end w-full">
                    Contract <SortIcon k="contract_value" />
                  </button>
                </th>
                <th style={{ width: 120 }} className="data-th text-right">
                  <button onClick={() => toggleSort('total_invoiced')} className="flex items-center justify-end w-full">
                    Invoiced <SortIcon k="total_invoiced" />
                  </button>
                </th>
                <th style={{ width: 120 }} className="data-th text-right">
                  <button onClick={() => toggleSort('best_actual_cost')} className="flex items-center justify-end w-full">
                    Actual cost <SortIcon k="best_actual_cost" />
                  </button>
                </th>
                <th style={{ width: 120 }} className="data-th text-right">
                  <button onClick={() => toggleSort('gross_profit')} className="flex items-center justify-end w-full">
                    Gross profit <SortIcon k="gross_profit" />
                  </button>
                </th>
                <th style={{ width: 88 }} className="data-th text-center">
                  <button onClick={() => toggleSort('gross_margin_percent')} className="flex items-center justify-center w-full">
                    Margin <SortIcon k="gross_margin_percent" />
                  </button>
                </th>
                <th style={{ width: 56 }} className="data-th"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const statusBadge = STATUS_BADGE[r.status] ?? { bg: '#F3F4F6', fg: '#6B7280' }
                const margin = Number(r.gross_margin_percent)
                return (
                  <tr key={r.deal_id} className="border-b border-divider last:border-0 hover:bg-surface-elevated transition-colors">
                    <td className="data-td">
                      <p className="text-[13px] font-medium text-text-primary truncate max-w-[220px]">{r.title}</p>
                      <p className="text-[11px] text-text-secondary capitalize">{r.contract_type?.replace('_', ' ') ?? '—'}</p>
                    </td>
                    <td className="data-td text-center">
                      <span
                        className="inline-block rounded-lg px-2 py-[2px] text-[10px] font-medium capitalize"
                        style={{ backgroundColor: statusBadge.bg, color: statusBadge.fg }}
                      >
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(r.contract_value)}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(r.total_invoiced)}</td>
                    <td className="data-td text-[13px] text-right text-text-secondary">{fmtMoney(r.best_actual_cost)}</td>
                    <td className="data-td text-[13px] text-right">
                      <span className={Number(r.gross_profit) >= 0 ? 'text-success font-medium' : 'text-error font-medium'}>
                        {fmtMoney(r.gross_profit)}
                      </span>
                    </td>
                    <td className="data-td text-center">
                      <MarginCell pct={margin} />
                    </td>
                    <td className="data-td text-right">
                      <Link
                        href={`/dashboard/projects/${r.deal_id}?tab=financials`}
                        className="btn-outlined h-7 px-2 text-[11px] inline-block"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
