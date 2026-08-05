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
import { KpiTile } from '@/components/ui/KpiTile'
import { logProjectEvent } from '@/lib/project-events'
import type { Project, ProjectActionItem } from '@/types/database'

const STATUS_FILTERS = ['all', 'draft', 'sent', 'in_progress', 'negotiation', 'won', 'lost'] as const
const STATUS_LABELS: Record<string, string> = {
  all: 'All', draft: 'Draft', sent: 'Sent', in_progress: 'In progress',
  negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
}
const STATUS_OPTIONS = ['draft', 'sent', 'in_progress', 'negotiation', 'won', 'lost']
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:       { bg: '#E5E7EB', fg: '#6B7280' },
  sent:        { bg: '#DBEAFE', fg: '#1E40AF' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  negotiation: { bg: '#EDE9FE', fg: '#5B21B6' },
  won:         { bg: '#DCFCE7', fg: '#166534' },
  lost:        { bg: '#FEE2E2', fg: '#991B1B' },
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

    const today = new Date().toISOString().slice(0, 10)
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
    const { error } = await supabase
      .from('client_deals')
      .update({ status: newStatus })
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Projects</h1>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="btn-outlined h-9 px-3 text-[13px]">Refresh</button>
          {canCreate && (
            <button
              onClick={() => router.push('/dashboard/projects/import')}
              className="h-9 px-3 text-[13px] rounded-lg border border-border text-text-primary hover:bg-surface-elevated transition-colors"
            >
              Import CSV
            </button>
          )}
          {canCreate && (
            <button onClick={() => router.push('/dashboard/projects/new')} className="btn-primary h-9 px-3 text-[13px]">
              + Project
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mx-4 mt-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error">
          {loadError}
        </div>
      )}

      <div className="mx-4 mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile value={kpis.total} label="Total" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        <KpiTile value={kpis.active} label="Active" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
        <KpiTile value={kpis.draft} label="Draft" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        <KpiTile value={kpis.won} label="Won" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
        <div className="rounded-lg py-2 flex flex-col items-center gap-1" style={{ backgroundColor: '#1E293B' }}>
          <span className="text-[14px] font-semibold" style={{ color: '#FCD34D' }}>{fmtCurrency(kpis.pipelineValue)}</span>
          <span className="text-[10px]" style={{ color: '#64748B' }}>Pipeline</span>
        </div>
        <div className="rounded-lg py-2 flex flex-col items-center gap-1" style={{ backgroundColor: '#1E293B' }}>
          <span className="text-[14px] font-semibold" style={{ color: '#FCA5A5' }}>{fmtCurrency(kpis.outstanding)}</span>
          <span className="text-[10px]" style={{ color: '#64748B' }}>AR outstanding</span>
        </div>
      </div>

      {/* Action Centre */}
      <div className="mx-4 mt-3 bg-surface rounded-xl border border-divider overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-[10px] border-b border-divider">
          <span className="material-icons text-primary text-[18px]">bolt</span>
          <span className="font-semibold text-[12px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {actionItems.length > 0 ? `${actionItems.length} pending` : 'Up to date'}
          </span>
          <button onClick={() => void load()} className="ml-auto text-text-secondary text-[11px] h-8 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        <div className="max-h-[140px] overflow-y-auto">
          {actionItems.length === 0 ? (
            <p className="text-text-secondary text-[12px] px-3 py-2">✓  No pending project actions</p>
          ) : (
            actionItems.map(item => {
              const colors = ACTION_TYPE_COLORS[item.action_type] ?? getDefaultColor()
              return (
                <div
                  key={`${item.action_type}-${item.ref_id}`}
                  className="grid items-center gap-x-2 px-3 py-2 border-t border-divider"
                  style={{ gridTemplateColumns: '120px 1fr 90px 70px' }}
                >
                  <span
                    className="rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium w-fit"
                    style={{ backgroundColor: colors.bg, color: colors.fg }}
                  >
                    {item.action_type.replace(/_/g, ' ')}
                  </span>
                  <div className="overflow-hidden">
                    <p className="text-text-primary text-[12px] font-medium truncate">
                      {item.project_code ? `${item.project_code} · ` : ''}{item.project_title ?? '—'}
                    </p>
                    <p className="text-text-secondary text-[11px] truncate">{item.summary}</p>
                  </div>
                  <p className="text-text-secondary text-[11px] text-right">{fmtDate(item.created_at)}</p>
                  <button
                    type="button"
                    onClick={() => openActionItem(item)}
                    className="text-primary text-[11px] h-[30px] text-right hover:opacity-70 transition-opacity"
                  >
                    Open →
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {canViewAll && (
        <div className="grid grid-cols-2 gap-2 mx-4 mt-3">
          <button
            onClick={() => setScope('all')}
            className="h-[34px] rounded-[10px] text-[12px] font-medium"
            style={{ backgroundColor: scope === 'all' ? '#3B82F6' : '#FFFFFF', color: scope === 'all' ? '#FFFFFF' : '#6B7280' }}
          >
            All Projects
          </button>
          <button
            onClick={() => setScope('mine')}
            className="h-[34px] rounded-[10px] text-[12px] font-medium"
            style={{ backgroundColor: scope === 'mine' ? '#3B82F6' : '#FFFFFF', color: scope === 'mine' ? '#FFFFFF' : '#6B7280' }}
          >
            My Projects
          </button>
        </div>
      )}

      <p className="text-text-secondary text-[12px] mx-4 mt-1.5">
        {total} project{total !== 1 ? 's' : ''}
        {employeeId && !canViewAll ? ' (your projects)' : ''}
      </p>

      <div className="mx-4 mt-1 flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Search code, title…"
          className="flex-1 min-w-[200px] bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary"
        >
          {STATUS_FILTERS.map(f => (
            <option key={f} value={f}>{STATUS_LABELS[f]}</option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary"
        >
          {PAGE_SIZE_OPTIONS.map(n => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto mx-4 my-3 bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 900 }} className="w-full">
            <thead>
              <tr className="bg-[#1E293B]">
                <th style={{ width: 72 }} className="data-th pl-2 text-white/70">Code</th>
                <th className="data-th text-white/70">Project</th>
                <th style={{ width: 88 }} className="data-th text-white/70">Client</th>
                <th style={{ width: 108 }} className="data-th text-white/70">Manager</th>
                <th style={{ width: 128 }} className="data-th text-white/70">Status</th>
                <th style={{ width: 92 }} className="data-th text-right text-white/70">Offer</th>
                <th style={{ width: 84 }} className="data-th text-right text-white/70">Paid</th>
                <th style={{ width: 56 }} className="data-th text-right text-white/70">%</th>
                <th style={{ width: 72 }} className="data-th text-center pr-2 text-white/70">Pay</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center text-[13px] text-text-disabled">Loading…</td></tr>
              ) : projects.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-[13px] text-text-secondary">
                  No projects match this view. Try All projects or adjust filters.
                </td></tr>
              ) : (
                projects.map(p => {
                  const sc = STATUS_COLORS[p.status ?? 'draft'] ?? STATUS_COLORS.draft
                  const progress = p.progress_percent != null
                    ? Math.round(Number(p.progress_percent))
                    : (p.offer_amount && p.amount_paid
                      ? Math.round((Number(p.amount_paid) / Number(p.offer_amount)) * 100)
                      : 0)
                  const managerName = p.employees
                    ? `${p.employees.name} ${p.employees.surname}`.trim()
                    : '—'
                  return (
                    <tr key={p.id} className="bg-surface border-b border-divider hover:bg-background transition-colors">
                      <td className="data-td pl-2">
                        <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                          className="text-text-primary text-[12px] font-medium hover:text-primary transition-colors">
                          {p.project_code ?? '—'}
                        </button>
                      </td>
                      <td className="data-td">
                        <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                          className="text-left text-text-primary text-[13px] font-medium truncate w-full hover:text-primary transition-colors">
                          {p.title || '—'}
                        </button>
                      </td>
                      <td className="data-td text-text-secondary text-[12px] truncate">{p.clients?.name ?? '—'}</td>
                      <td className="data-td text-text-secondary text-[12px] truncate">{managerName}</td>
                      <td className="data-td">
                        <select
                          value={p.status ?? 'draft'}
                          onChange={e => void updateStatus(p, e.target.value)}
                          disabled={!canEdit}
                          className="text-[11px] h-8 px-2 rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 w-full disabled:opacity-60"
                          style={{ color: sc.fg }}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                        </select>
                      </td>
                      <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.offer_amount)}</td>
                      <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.amount_paid)}</td>
                      <td className="data-td text-text-primary font-semibold text-[12px] text-right">{progress}%</td>
                      <td className="data-td text-center pr-2">
                        <button
                          onClick={() => router.push(`/dashboard/projects/${p.id}?tab=payments`)}
                          className="bg-primary text-white rounded-lg h-7 px-2 text-[10px] font-medium"
                        >
                          + Pay
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="mx-4 mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
