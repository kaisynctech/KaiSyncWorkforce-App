'use client'

import { useEffect, useState, useCallback } from 'react'
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
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { hrUpdateIncident } from '@/lib/incidents'
import type { IncidentReport } from '@/types/database'
import * as XLSX from 'xlsx'
import { localISODate } from '@/lib/utils'

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
  high:     { bg: '#FEF3C7', fg: '#92400E' },
  medium:   { bg: '#DBEAFE', fg: '#1E40AF' },
  low:      { bg: '#DCFCE7', fg: '#166534' },
}

type StatusFilter = 'open' | 'all' | 'closed'
type ScopeFilter = 'all' | 'standalone' | 'job'
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

type IncidentKpis = {
  open: number
  investigating: number
  critical: number
  unassigned: number
}

type ActionItem = {
  id: string
  label: string
  severity: string
  status: string
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

function sevBg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).bg }
function sevFg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).fg }

function isOpenIncident(inc: Pick<IncidentReport, 'is_closed' | 'status'>): boolean {
  if (inc.is_closed === true) return false
  const s = (inc.status ?? '').toLowerCase()
  return s === 'open' || s === 'investigating'
}

type IncidentRow = IncidentReport & {
  jobs?: { title: string } | null
  reporter?: { name: string; surname: string } | null
  assignee?: { name: string; surname: string } | null
}

export default function IncidentsPage() {
  const router = useRouter()
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [searchText, setSearchText] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [kpis, setKpis] = useState<IncidentKpis>({ open: 0, investigating: 0, critical: 0, unassigned: 0 })
  const [actionItems, setActionItems] = useState<ActionItem[]>([])

  const canCreate = can(perms, PERM.incidentsCreate)
  const canEdit = can(perms, PERM.incidentsEdit)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchText.trim()), 300)
    return () => clearTimeout(t)
  }, [searchText])

  useEffect(() => { setPage(1) }, [searchDebounced, statusFilter, scope, severityFilter, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const base = () =>
      supabase.from('incident_reports').select('id', { count: 'exact', head: true }).eq('company_id', member.companyId)

    const { from, to } = pageRange(page, pageSize)
    let query = supabase
      .from('incident_reports')
      .select('*, jobs(title), reporter:employees!employee_id(name, surname), assignee:employees!assignee_id(name, surname)', { count: 'exact' })
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (statusFilter === 'open') query = query.in('status', ['open', 'investigating']).or('is_closed.is.null,is_closed.eq.false')
    if (statusFilter === 'closed') query = query.or('status.eq.closed,status.eq.resolved,is_closed.eq.true')
    if (scope === 'standalone') query = query.is('job_id', null)
    if (scope === 'job') query = query.not('job_id', 'is', null)
    if (severityFilter !== 'all') query = query.ilike('severity', severityFilter)
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`)
    }

    const [pageRes, openRes, invRes, critRes, unasRes, acRes] = await Promise.all([
      query.range(from, to),
      base().in('status', ['open', 'investigating']).or('is_closed.is.null,is_closed.eq.false'),
      base().eq('status', 'investigating'),
      base().ilike('severity', 'critical').in('status', ['open', 'investigating']),
      base().is('assignee_id', null).in('status', ['open', 'investigating']),
      supabase
        .from('incident_reports')
        .select('id, title, description, severity, status, assignee_id, created_at')
        .eq('company_id', member.companyId)
        .in('status', ['open', 'investigating'])
        .order('created_at', { ascending: true })
        .limit(40),
    ])

    if (pageRes.error) {
      setError(pageRes.error.message)
      setIncidents([])
      setTotal(0)
    } else {
      setIncidents((pageRes.data ?? []) as IncidentRow[])
      setTotal(pageRes.count ?? 0)
    }

    setKpis({
      open: openRes.count ?? 0,
      investigating: invRes.count ?? 0,
      critical: critRes.count ?? 0,
      unassigned: unasRes.count ?? 0,
    })

    const acRows = (acRes.data ?? []) as IncidentRow[]
    const items: ActionItem[] = []
    for (const row of acRows) {
      if ((row.severity ?? '').toLowerCase() === 'critical') {
        items.push({ id: row.id, label: row.title ?? row.description ?? 'Critical incident', severity: row.severity, status: row.status })
      } else if (!row.assignee_id) {
        items.push({ id: row.id, label: row.title ?? row.description ?? 'Unassigned incident', severity: row.severity, status: row.status })
      }
      if (items.length >= 12) break
    }
    setActionItems(items)

    setLoading(false)
  }, [page, pageSize, statusFilter, scope, severityFilter, searchDebounced])

  useEffect(() => { void load() }, [load])

  async function closeIncident(inc: IncidentRow) {
    if (!canEdit) return
    if (!window.confirm('Close this incident?')) return
    if (!companyId) return
    const supabase = createClient()
    const res = await hrUpdateIncident(supabase, {
      companyId,
      incidentId: inc.id,
      status: 'closed',
    })
    if (!res.ok) {
      setError(res.message)
      return
    }
    void load()
  }

  async function exportXlsx() {
    if (!companyId) return
    const supabase = createClient()
    let query = supabase
      .from('incident_reports')
      .select('title, description, severity, status, category, created_at, is_closed, jobs(title), reporter:employees!employee_id(name, surname), assignee:employees!assignee_id(name, surname)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(5000)
    if (statusFilter === 'open') query = query.in('status', ['open', 'investigating'])
    if (statusFilter === 'closed') query = query.or('status.eq.closed,status.eq.resolved,is_closed.eq.true')
    if (severityFilter !== 'all') query = query.ilike('severity', severityFilter)
    const { data, error: qErr } = await query
    if (qErr) { setError(qErr.message); return }
    const rows = ((data ?? []) as unknown as IncidentRow[]).map(inc => ({
      Title: inc.title ?? '',
      Description: inc.description ?? '',
      Severity: inc.severity,
      Status: inc.status,
      Category: inc.category ?? '',
      Job: inc.jobs?.title ?? '',
      Reporter: inc.reporter ? `${inc.reporter.name} ${inc.reporter.surname}`.trim() : '',
      Assignee: inc.assignee ? `${inc.assignee.name} ${inc.assignee.surname}`.trim() : '',
      Created: inc.created_at,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Incidents')
    XLSX.writeFile(wb, `incidents_export_${localISODate()}.xlsx`)
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  const pages = totalPages(total, pageSize)

  const pill = (active: boolean) =>
    `h-8 px-3 text-[12px] font-medium transition-colors ${active ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-[16px] font-bold text-text-primary">Incidents</h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="h-8 px-2.5 text-[12px] rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors">Refresh</button>
            <button type="button" onClick={() => void exportXlsx()} className="h-8 px-2.5 text-[12px] rounded-lg border border-border text-text-primary font-medium hover:bg-surface-elevated transition-colors">Export</button>
            {canCreate && (
              <button type="button" onClick={() => router.push('/dashboard/incidents/new')} className="btn-primary h-8 px-2.5 text-[12px] whitespace-nowrap">
                + New Incident
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#0F2918]">
            <span className="text-[14px] font-semibold text-[#22C55E]">{kpis.open}</span>
            <span className="text-[11px] text-[#4ADE80]">Open</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#292012]">
            <span className="text-[14px] font-semibold text-[#FCD34D]">{kpis.investigating}</span>
            <span className="text-[11px] text-[#FCD34D]">Investigating</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#3F1515]">
            <span className="text-[14px] font-semibold text-[#FCA5A5]">{kpis.critical}</span>
            <span className="text-[11px] text-[#FCA5A5]">Critical</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#94A3B8]">{kpis.unassigned}</span>
            <span className="text-[11px] text-[#64748B]">Unassigned</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-divider shrink-0">
            {([
              { value: 'open' as const, label: 'Open' },
              { value: 'all' as const, label: 'All' },
              { value: 'closed' as const, label: 'Closed' },
            ]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => setStatusFilter(value)} className={pill(statusFilter === value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-0">
            <span className="material-icons text-text-disabled text-[16px]">search</span>
            <input
              type="search"
              placeholder="Search title, description, or category"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            { value: 'all' as const, label: 'All scopes' },
            { value: 'standalone' as const, label: 'Standalone' },
            { value: 'job' as const, label: 'Job-linked' },
          ]).map(({ value, label }) => (
            <button key={value} type="button" onClick={() => setScope(value)} className={`h-7 px-2.5 rounded-full text-[11px] font-medium border ${scope === value ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:text-text-primary'}`}>
              {label}
            </button>
          ))}
          {([
            { value: 'all' as const, label: 'All severity' },
            { value: 'critical' as const, label: 'Critical' },
            { value: 'high' as const, label: 'High' },
            { value: 'medium' as const, label: 'Medium' },
            { value: 'low' as const, label: 'Low' },
          ]).map(({ value, label }) => (
            <button key={value} type="button" onClick={() => setSeverityFilter(value)} className={`h-7 px-2.5 rounded-full text-[11px] font-medium border capitalize ${severityFilter === value ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:text-text-primary'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <p className="mx-3 mb-2 text-[12px] text-error">{error}</p>
      )}

      <div className="mx-3 mb-2 bg-surface rounded-lg border border-divider overflow-hidden shrink-0">
        <div className={`flex items-center gap-2 px-3 py-1.5 ${actionItems.length > 0 ? 'border-b border-divider' : ''}`}>
          <span className="material-icons text-primary text-[16px]">bolt</span>
          <span className="font-semibold text-[11px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {actionItems.length > 0 ? `${actionItems.length} pending` : 'Up to date'}
          </span>
          <button type="button" onClick={() => void load()} className="ml-auto text-text-secondary text-[11px] h-6 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        {actionItems.length > 0 && (
          <div className="max-h-[88px] overflow-y-auto">
            {actionItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(`/dashboard/incidents/${item.id}`)}
                className="w-full text-left px-3 py-1.5 border-t border-divider first:border-t-0 hover:bg-background transition-colors flex items-center gap-2"
              >
                <StatusBadge label={item.severity} bg={sevBg(item.severity)} fg={sevFg(item.severity)} />
                <span className="text-[12px] text-text-primary truncate flex-1">{item.label}</span>
                <span className="text-[11px] text-text-secondary capitalize">{item.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto mx-3 mb-1 bg-surface border border-divider rounded-lg">
          {loading ? (
            <p className="text-text-secondary text-[13px] text-center py-12">Loading…</p>
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <span className="material-icons text-[40px] text-text-disabled">verified</span>
              <p className="text-text-secondary text-[14px]">No incidents found</p>
            </div>
          ) : (
            <ResponsiveDataView
              table={
                <table className="w-full text-[13px]" style={{ minWidth: 960 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Title</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Severity</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Status</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Reporter</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Assignee</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Job</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Created</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {incidents.map(inc => {
                      const reporter = inc.reporter ? `${inc.reporter.name} ${inc.reporter.surname}`.trim() : '—'
                      const assignee = inc.assignee ? `${inc.assignee.name} ${inc.assignee.surname}`.trim() : '—'
                      return (
                        <tr key={inc.id} className="hover:bg-background transition-colors cursor-pointer"
                          onClick={() => router.push(`/dashboard/incidents/${inc.id}`)}>
                          <td className="px-3 py-2.5 font-medium text-text-primary max-w-[220px] truncate">
                            {inc.title ?? inc.description ?? '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge label={inc.severity} bg={sevBg(inc.severity)} fg={sevFg(inc.severity)} />
                          </td>
                          <td className="px-3 py-2.5 text-text-secondary capitalize">{inc.status}</td>
                          <td className="px-3 py-2.5 text-text-secondary truncate max-w-[120px]">{reporter}</td>
                          <td className="px-3 py-2.5 text-text-secondary truncate max-w-[120px]">{assignee}</td>
                          <td className="px-3 py-2.5 text-text-secondary truncate max-w-[140px]">{inc.jobs?.title ?? '—'}</td>
                          <td className="px-3 py-2.5 text-text-secondary whitespace-nowrap">{fmtDate(inc.created_at)}</td>
                          <td className="px-3 py-2.5 text-right">
                            {canEdit && isOpenIncident(inc) && (
                              <button
                                onClick={e => { e.stopPropagation(); void closeIncident(inc) }}
                                className="h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-medium"
                              >
                                Close
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              }
              mobile={
                <>
                  {incidents.map(inc => {
                    const reporter = inc.reporter ? `${inc.reporter.name} ${inc.reporter.surname}`.trim() : '—'
                    return (
                      <DataCard
                        key={inc.id}
                        onClick={() => router.push(`/dashboard/incidents/${inc.id}`)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <DataCardTitle className="flex-1">
                            {inc.title ?? inc.description ?? '—'}
                          </DataCardTitle>
                          <StatusBadge label={inc.severity} bg={sevBg(inc.severity)} fg={sevFg(inc.severity)} />
                        </div>
                        <DataCardMeta className="capitalize">{inc.status} · {fmtDate(inc.created_at)}</DataCardMeta>
                        <DataCardRow label="Reporter" value={reporter} />
                        <DataCardRow label="Job" value={inc.jobs?.title ?? '—'} />
                        {canEdit && isOpenIncident(inc) && (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void closeIncident(inc) }}
                            className="mt-3 w-full h-11 rounded-lg bg-primary text-white text-[13px] font-medium"
                          >
                            Close
                          </button>
                        )}
                      </DataCard>
                    )
                  })}
                </>
              }
            />
          )}
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-divider shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-secondary">
            {total === 0 ? '0 incidents' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          </span>
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-8 px-2 rounded-lg border border-border bg-surface text-[12px] text-text-primary">
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Previous</button>
          <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}
