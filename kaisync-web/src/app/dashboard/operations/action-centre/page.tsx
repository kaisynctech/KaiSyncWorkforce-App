'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadPermissions, type PermissionSet } from '@/lib/permissions'
import { resolveHrNavFlags, type HrNavFlags } from '@/lib/company-modules'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import { useDashboardCompany } from '@/components/DashboardCompanyContext'
import { cn } from '@/lib/utils'
import { MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import {
  OPS_ACTION_TABS,
  loadOpsActionItems,
  openOpsActionItem,
  opsActionColor,
  visibleOpsActionDomains,
  type OpsActionDomain,
  type OpsActionItem,
} from '@/lib/operations-action-centre'

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

export default function OperationsActionCentrePage() {
  const router = useRouter()
  const { company, employee } = useDashboardCompany()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [flags, setFlags] = useState<HrNavFlags | null>(null)
  const [byDomain, setByDomain] = useState<Record<OpsActionDomain, OpsActionItem[]> | null>(null)
  const [tab, setTab] = useState<OpsActionDomain | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const domains = useMemo(
    () => (flags ? visibleOpsActionDomains(flags, perms) : []),
    [flags, perms],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    const companyId = company?.id ?? member?.companyId
    if (!companyId || !member) {
      setError('not_linked')
      setLoading(false)
      return
    }

    const workspace = await loadCompanyWorkspace(supabase, companyId)
    const enabled = {
      ...(company?.enabled_modules ?? {}),
      ...(workspace?.enabled_modules ?? {}),
    }
    const nextFlags = resolveHrNavFlags(enabled)
    setFlags(nextFlags)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    const nextPerms = await loadPermissions(
      supabase,
      companyId,
      employee?.access_level ?? me?.access_level ?? null,
    )
    setPerms(nextPerms)

    const visible = visibleOpsActionDomains(nextFlags, nextPerms)
    if (visible.length === 0) {
      setByDomain({
        clients: [], projects: [], contractors: [], incidents: [], assets: [],
      })
      setTab(null)
      setLoading(false)
      return
    }

    const items = await loadOpsActionItems(supabase, companyId, visible)
    setByDomain(items)
    setTab(prev => (prev && visible.includes(prev) ? prev : visible[0]))
    setLoading(false)
  }, [company?.id, company?.enabled_modules, employee?.access_level])

  useEffect(() => { void load() }, [load])

  const rows = tab && byDomain ? byDomain[tab] : []
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const d of domains) c[d] = byDomain?.[d]?.length ?? 0
    return c
  }, [domains, byDomain])

  async function onOpen(item: OpsActionItem) {
    setOpening(item.key)
    try {
      await openOpsActionItem(item, router, createClient())
    } finally {
      setOpening(null)
    }
  }

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[14px] text-text-secondary">Account not linked to an employee record.</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight flex items-center gap-1.5">
            <span className="material-icons text-primary text-[20px]">bolt</span>
            Action Centre
          </h1>
          <p className="text-[11px] text-text-secondary mt-0.5">
            Pending work across Operations — open an item to jump straight to it
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-8 px-2.5 rounded-md border border-divider text-[12px] font-medium text-text-secondary hover:bg-surface-elevated"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-divider shrink-0 flex-wrap bg-surface items-center">
        {domains.length === 0 && !loading && (
          <p className="text-[12px] text-text-secondary">No Operations modules available for your account.</p>
        )}
        {domains.map(id => {
          const meta = OPS_ACTION_TABS.find(t => t.id === id)!
          const on = tab === id
          const count = counts[id] ?? 0
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors bg-surface',
                on
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'border-divider text-text-primary hover:bg-surface-elevated',
              )}
            >
              {meta.label}
              <span className={cn('ml-1 tabular-nums font-medium', on ? 'text-white/85' : 'opacity-70')}>
                ({count})
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[12px] text-text-secondary py-10">Loading…</p>
        ) : error ? (
          <p className="text-center text-[12px] text-error py-10">{error}</p>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[40px] text-divider block mb-2">task_alt</span>
            <p className="text-[14px] font-medium text-text-primary">Up to date</p>
            <p className="text-[12px] text-text-secondary mt-1">Nothing pending in this area.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider sticky top-0 z-10">
                <th className={`${MONEY_TH} text-left w-[140px]`}>Type</th>
                <th className={`${MONEY_TH} text-left`}>Item</th>
                <th className={`${MONEY_TH} text-left w-[110px]`}>Date</th>
                <th className={`${MONEY_TH} text-right w-[80px]`} />
              </tr>
            </thead>
            <tbody>
              {rows.map(item => {
                const colors = opsActionColor(item.action_type)
                return (
                  <tr
                    key={item.key}
                    className="border-b border-divider last:border-0 hover:bg-surface-elevated cursor-pointer"
                    onClick={() => void onOpen(item)}
                  >
                    <td className={MONEY_TD}>
                      <span
                        className="inline-flex rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium"
                        style={{ backgroundColor: colors.bg, color: colors.fg }}
                      >
                        {item.action_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className={MONEY_TD}>
                      <p className="font-medium text-text-primary truncate">{item.title}</p>
                      <p className="text-[11px] text-text-secondary truncate">{item.summary}</p>
                    </td>
                    <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>
                      {fmtDate(item.created_at)}
                    </td>
                    <td className={`${MONEY_TD} text-right`}>
                      <button
                        type="button"
                        disabled={opening === item.key}
                        onClick={e => { e.stopPropagation(); void onOpen(item) }}
                        className="text-primary text-[12px] h-7 px-2 hover:opacity-70 disabled:opacity-50"
                      >
                        {opening === item.key ? '…' : 'Open →'}
                      </button>
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
