'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  escapeIlike,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { logProjectEvent } from '@/lib/project-events'
import type { Project, ProjectActionItem } from '@/types/database'
import { localISODate } from '@/lib/utils'

const STATUS_FILTERS = ['all', 'draft', 'sent', 'in_progress', 'negotiation', 'won', 'lost'] as const
const STATUS_LABELS: Record<string, string> = {
  all: 'All', draft: 'Draft', sent: 'Sent', in_progress: 'In progress',
  negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
}
const STATUS_OPTIONS = ['draft', 'sent', 'in_progress', 'negotiation', 'won', 'lost']
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  sent: 'bg-[#DBEAFE] text-[#1D4ED8]',
  in_progress: 'bg-warning-dark text-[#92400E]',
  negotiation: 'bg-[#EDE9FE] text-[#5B21B6]',
  won: 'bg-success-dark text-[#166534]',
  lost: 'bg-error-dark text-[#991B1B]',
}

const ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  invoice_overdue:    { bg: '#FEE2E2', fg: '#991B1B' },
  deposit_due:        { bg: '#FEF3C7', fg: '#92400E' },
  quotation_pending:  { bg: '#DBEAFE', fg: '#1E40AF' },
  stale_deal:         { bg: '#E5E7EB', fg: '#374151' },
  deal_stale:         { bg: '#E5E7EB', fg: '#374151' },
  portal_message:     { bg: '#E0E7FF', fg: '#3730A3' },
}

function getDefaultColor() { return { bg: '#E5E7EB', fg: '#374151' } }

const fmtCurrency = (n: number | null | undefined) =>
  n != null ? `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}` : '—'

type ProjectRow = Project & {
  clients?: { id: string; name: string } | null
  employees?: { id: string; name: string; surname: string } | null
}

type ProjectKpis = {
  total: number
  active: number
  draft: number
  won: number
  pipelineValue: number
  outstanding: number
}

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [actionItems, setActionItems] = useState<ProjectActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [kpis, setKpis] = useState<ProjectKpis>({
    total: 0, active: 0, draft: 0, won: 0, pipelineValue: 0, outstanding: 0,
  })

  const canCreate = can(perms, PERM.projectsCreate)
  const canEdit = can(perms, PERM.projectsEdit)
  const canViewAll = can(perms, PERM.projectsViewAll)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, pageSize, statusFilter, scope])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoadError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    const nextPerms = await loadPermissions(supabase, member.companyId, me?.access_level)
    setPerms(nextPerms)

    const viewAll = nextPerms.has(PERM.projectsViewAll)
    const effectiveScope = viewAll ? scope : 'mine'
    if (!viewAll && scope === 'all') setScope('mine')

    const today = localISODate()
    const { from, to } = pageRange(page, pageSize)

    let query = supabase
      .from('client_deals')
      .select('*, clients(id, name), employees:manager_employee_id(id, name, surname)', { count: 'exact' })
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (effectiveScope === 'mine') {
      query = query.eq('manager_employee_id', member.employeeId)
    }
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`title.ilike.%${q}%,project_code.ilike.%${q}%`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [listRes, aRes, snapRes] = await Promise.all([
      query.range(from, to),
      (supabase.rpc as any)('hr_get_project_action_items', { p_company_id: member.companyId }),
      (supabase.rpc as any)('hr_get_projects_snapshot', {
        p_company_id: member.companyId,
        p_from: today,
        p_to: today,
      }),
    ])

    if (listRes.error) {
      setLoadError(listRes.error.message)
      setProjects([])
      setTotal(0)
    } else {
      setProjects((listRes.data ?? []) as ProjectRow[])
      setTotal(listRes.count ?? 0)
    }

    if (aRes.error) {
      setActionItems([])
    } else {
      const actionRaw = aRes.data
      const actionList = Array.isArray(actionRaw)
        ? actionRaw
        : typeof actionRaw === 'string'
          ? JSON.parse(actionRaw)
          : []
      setActionItems((actionList ?? []) as ProjectActionItem[])
    }

    const snap = (snapRes.data ?? {}) as {
      total?: number
      active?: number
      draft?: number
      won?: number
      pipeline_value?: number
      outstanding_balance?: number
    }
    setKpis({
      total: Number(snap.total ?? listRes.count ?? 0),
      active: Number(snap.active ?? 0),
      draft: Number(snap.draft ?? 0),
      won: Number(snap.won ?? 0),
      pipelineValue: Number(snap.pipeline_value ?? 0),
      outstanding: Number(snap.outstanding_balance ?? 0),
    })

    setLoading(false)
  }, [page, pageSize, searchDebounced, statusFilter, scope])

  useEffect(() => { void load() }, [load])

  async function updateStatus(p: ProjectRow, newStatus: string) {
    if (!companyId || !canEdit) return
    const supabase = createClient()
    const prev = p.status ?? 'draft'
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('client_deals')
      .update({ status: newStatus, updated_at: now, last_update_at: now })
      .eq('id', p.id)
      .eq('company_id', companyId)
    if (error) {
      setLoadError(error.message)
      return
    }
    setProjects(prevRows => prevRows.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
    if (prev !== newStatus) {
      await logProjectEvent(supabase, {
        companyId,
        screen: 'HrProjectsList',
        action: 'stage_changed',
        meta: { project_id: p.id, status_from: prev, status_to: newStatus },
      })
    }
  }

  async function openActionItem(item: ProjectActionItem) {
    if (item.action_type === 'invoice_overdue') {
      router.push(`/dashboard/finance/invoices/${item.ref_id}`)
      return
    }
    if (item.action_type === 'quotation_pending') {
      router.push(`/dashboard/projects/${item.project_id}?tab=quotation`)
      return
    }
    if (item.action_type === 'deposit_due') {
      router.push(`/dashboard/projects/${item.project_id}?tab=payments`)
      return
    }
    if (item.action_type === 'portal_message') {
      const supabase = createClient()
      const { data: msg } = await supabase
        .from('app_messages')
        .select('thread_id')
        .eq('id', item.ref_id)
        .maybeSingle()
      const threadId = (msg as { thread_id?: string } | null)?.thread_id
      if (threadId) {
        router.push(`/dashboard/messages?threadId=${threadId}`)
        return
      }
      router.push(`/dashboard/projects/${item.project_id}`)
      return
    }
    if (item.action_type === 'deal_stale' || item.action_type === 'stale_deal') {
      router.push(`/dashboard/projects/${item.project_id}?tab=pipeline`)
      return
    }
    router.push(`/dashboard/projects/${item.project_id}`)
  }

  const pages = totalPages(total, pageSize)
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

  if (loadError === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[14px] text-text-secondary">Account not linked to an employee record.</p>
      </div>
    )
  }

  const rangeLabel = total === 0
    ? '0 projects'
    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[16px] font-bold text-text-primary">Projects</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="h-8 px-2.5 rounded-sm bg-surface border border-border text-[12px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors"
            >
              Refresh
            </button>
            {canCreate && (
              <button
                type="button"
                onClick={() => router.push('/dashboard/projects/import')}
                className="h-8 px-2.5 rounded-sm bg-surface border border-border text-[12px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors"
              >
                Import
              </button>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={() => router.push('/dashboard/projects/new')}
                className="flex items-center gap-1 h-8 px-2.5 rounded-sm bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark transition-colors"
              >
                <span className="material-icons text-[16px]">add</span>
                New Project
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#94A3B8]">{kpis.total}</span>
            <span className="text-[11px] text-[#64748B]">Total</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#0F2918]">
            <span className="text-[14px] font-semibold text-[#22C55E]">{kpis.active}</span>
            <span className="text-[11px] text-[#4ADE80]">Active</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#94A3B8]">{kpis.draft}</span>
            <span className="text-[11px] text-[#64748B]">Draft</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#0F2918]">
            <span className="text-[14px] font-semibold text-[#22C55E]">{kpis.won}</span>
            <span className="text-[11px] text-[#4ADE80]">Won</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#FCD34D]">{fmtCurrency(kpis.pipelineValue)}</span>
            <span className="text-[11px] text-[#64748B]">Pipeline</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#FCA5A5]">{fmtCurrency(kpis.outstanding)}</span>
            <span className="text-[11px] text-[#64748B]">Outstanding</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canViewAll && (
            <div className="flex rounded-md overflow-hidden border border-divider shrink-0">
              {([
                { value: 'all' as const, label: 'All' },
                { value: 'mine' as const, label: 'Mine' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  className={`h-8 px-3 text-[12px] font-medium transition-colors ${scope === value ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-0">
            <span className="material-icons text-text-disabled text-[16px]">search</span>
            <input
              type="search"
              placeholder="Search code or title"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`h-8 px-[14px] rounded-pill text-[11px] font-medium transition-colors ${statusFilter === value ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border hover:text-text-primary'}`}
            >
              {STATUS_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="mx-3 mb-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error shrink-0">
          {loadError}
        </div>
      )}

      {/* Action Centre */}
      <div className="mx-3 mb-2 bg-surface rounded-lg border border-divider overflow-hidden shrink-0">
        <div className={`flex items-center gap-2 px-3 py-1.5 ${actionItems.length > 0 ? 'border-b border-divider' : ''}`}>
          <span className="material-icons text-primary text-[16px]">bolt</span>
          <span className="font-semibold text-[11px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {actionItems.length > 0 ? `${actionItems.length} pending` : 'Up to date'}
          </span>
          <button onClick={() => void load()} className="ml-auto text-text-secondary text-[11px] h-6 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        {actionItems.length > 0 && (
          <div className="max-h-[88px] overflow-y-auto">
            {actionItems.map(item => {
              const colors = ACTION_TYPE_COLORS[item.action_type] ?? getDefaultColor()
              return (
                <div
                  key={`${item.action_type}-${item.ref_id}`}
                  className="flex flex-col sm:grid sm:items-center gap-1 px-3 py-1.5 border-t border-divider first:border-t-0"
                  style={{ gridTemplateColumns: '120px 1fr 90px 70px' }}
                >
                  <span
                    className="rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium w-fit"
                    style={{ backgroundColor: colors.bg, color: colors.fg }}
                  >
                    {item.action_type.replace(/_/g, ' ')}
                  </span>
                  <div className="overflow-hidden min-w-0">
                    <p className="text-text-primary text-[12px] font-medium truncate">
                      {item.project_code ? `${item.project_code} · ` : ''}{item.project_title ?? '—'}
                    </p>
                    <p className="text-text-secondary text-[11px] truncate">{item.summary}</p>
                  </div>
                  <div className="flex items-center justify-between sm:contents gap-2">
                    <p className="text-text-secondary text-[11px] sm:text-right">{fmtDate(item.created_at)}</p>
                    <button
                      type="button"
                      onClick={() => openActionItem(item)}
                      className="text-primary text-[12px] h-7 sm:h-6 px-2 sm:text-right hover:opacity-70 transition-opacity"
                    >
                      Open →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto mx-3 mb-1 bg-surface border border-divider rounded-lg">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[48px] text-text-disabled block mb-2">folder_open</span>
            <p className="text-[14px] text-text-secondary">No projects found</p>
          </div>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[100px]">Code</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Project</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[18%]">Client</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[140px]">Manager</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[140px]">Status</th>
                    <th className="text-right px-3 py-2 text-[11px] font-medium text-text-secondary w-[100px]">Offer</th>
                    <th className="text-right px-3 py-2 text-[11px] font-medium text-text-secondary w-[90px]">Paid</th>
                    <th className="text-right px-3 py-2 text-[11px] font-medium text-text-secondary w-[56px]">%</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => {
                    const badge = STATUS_BADGE[p.status ?? 'draft'] ?? STATUS_BADGE.draft
                    const progress = p.progress_percent != null
                      ? Math.round(Number(p.progress_percent))
                      : (p.offer_amount && p.amount_paid
                        ? Math.round((Number(p.amount_paid) / Number(p.offer_amount)) * 100)
                        : 0)
                    const managerName = p.employees
                      ? `${p.employees.name} ${p.employees.surname}`.trim()
                      : '—'
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                        onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                      >
                        <td className="px-3 py-2 font-mono text-[11px] text-text-secondary whitespace-nowrap">{p.project_code ?? '—'}</td>
                        <td className="px-3 py-2 font-medium text-text-primary truncate">{p.title || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary truncate">{p.clients?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-text-secondary truncate">{managerName}</td>
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <select
                            value={p.status ?? 'draft'}
                            onChange={e => void updateStatus(p, e.target.value)}
                            disabled={!canEdit}
                            className={`text-[11px] h-7 px-2 rounded-pill border-0 font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 ${badge}`}
                          >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right text-text-primary whitespace-nowrap">{fmtCurrency(p.offer_amount)}</td>
                        <td className="px-3 py-2 text-right text-text-secondary whitespace-nowrap">{fmtCurrency(p.amount_paid)}</td>
                        <td className="px-3 py-2 text-right font-medium text-text-primary">{progress}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            }
            mobile={
              <>
                {projects.map(p => {
                  const badge = STATUS_BADGE[p.status ?? 'draft'] ?? STATUS_BADGE.draft
                  const progress = p.progress_percent != null
                    ? Math.round(Number(p.progress_percent))
                    : (p.offer_amount && p.amount_paid
                      ? Math.round((Number(p.amount_paid) / Number(p.offer_amount)) * 100)
                      : 0)
                  return (
                    <DataCard key={p.id} onClick={() => router.push(`/dashboard/projects/${p.id}`)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>{p.title || '—'}</DataCardTitle>
                          <DataCardMeta className="font-mono">{p.project_code ?? '—'}</DataCardMeta>
                        </div>
                        <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium shrink-0 ${badge}`}>
                          {STATUS_LABELS[p.status ?? 'draft'] ?? p.status}
                        </span>
                      </div>
                      <DataCardRow label="Client" value={p.clients?.name ?? '—'} />
                      <DataCardRow label="Offer" value={fmtCurrency(p.offer_amount)} />
                      <DataCardRow label="Paid" value={fmtCurrency(p.amount_paid)} />
                      <DataCardRow label="Progress" value={`${progress}%`} />
                    </DataCard>
                  )
                })}
              </>
            }
          />
        )}
      </div>

      <div className="shrink-0 px-3 py-2 flex items-center gap-2">
        <p className="text-[12px] text-text-secondary">{rangeLabel}</p>
        <select
          value={pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          aria-label="Rows per page"
          className="h-7 px-1.5 rounded border border-border bg-surface text-[12px] text-text-secondary"
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40">Previous</button>
        <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
