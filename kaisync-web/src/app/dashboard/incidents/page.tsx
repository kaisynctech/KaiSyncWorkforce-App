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
import { KpiTile } from '@/components/ui/KpiTile'
import { hrUpdateIncident } from '@/lib/incidents'
import type { IncidentReport } from '@/types/database'
import * as XLSX from 'xlsx'

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
    XLSX.writeFile(wb, `incidents_export_${new Date().toISOString().slice(0, 10)}.xlsx`)
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Incident Reports</h1>
          <p className="text-[12px] text-text-secondary mt-0.5">
            {total === 0 ? '0 shown' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void exportXlsx()} className="btn-outlined h-9 px-3 text-[13px]">Export</button>
          {canCreate && (
            <button onClick={() => router.push('/dashboard/incidents/new')} className="btn-primary h-9 px-3 text-[13px]">New</button>
          )}
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <div className="mx-4 mt-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error">
          {error}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mx-4 mt-3">
          <KpiTile value={kpis.open} label="Open" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
          <KpiTile value={kpis.investigating} label="Investigating" bg="#292012" valueFg="#FCD34D" labelFg="#FCD34D" />
          <KpiTile value={kpis.critical} label="Critical" bg="#3F1515" valueFg="#FCA5A5" labelFg="#FCA5A5" />
          <KpiTile value={kpis.unassigned} label="Unassigned" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        </div>
      )}

      <div className="mx-4 mt-3 bg-surface rounded-xl border border-divider overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-[10px] border-b border-divider">
          <span className="material-icons text-primary text-[18px]">bolt</span>
          <span className="font-semibold text-[12px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {actionItems.length > 0 ? `${actionItems.length} pending` : 'Up to date'}
          </span>
        </div>
        <div className="max-h-[120px] overflow-y-auto">
          {actionItems.length === 0 ? (
            <p className="text-text-secondary text-[12px] px-3 py-2">✓  No pending incident actions</p>
          ) : (
            actionItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(`/dashboard/incidents/${item.id}`)}
                className="w-full text-left px-3 py-2 border-t border-divider hover:bg-background transition-colors flex items-center gap-2"
              >
                <StatusBadge label={item.severity} bg={sevBg(item.severity)} fg={sevFg(item.severity)} />
                <span className="text-[12px] text-text-primary truncate flex-1">{item.label}</span>
                <span className="text-[11px] text-text-secondary capitalize">{item.status}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-b border-divider bg-surface shrink-0">
        <div className="flex items-center gap-2 h-10 px-3 bg-background border border-border rounded-lg flex-1 min-w-[180px]">
          <span className="material-icons text-text-disabled text-[18px]">search</span>
          <input
            type="search"
            placeholder="Search title, description…"
            className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary">
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          <option value="closed">Closed</option>
        </select>
        <select value={scope} onChange={e => setScope(e.target.value as ScopeFilter)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary">
          <option value="all">All scopes</option>
          <option value="standalone">Standalone</option>
          <option value="job">Job-linked</option>
        </select>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary capitalize">
          <option value="all">All severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="dark-entry h-10 text-[12px] py-0 w-auto">
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-4 my-3 bg-surface rounded-lg border border-divider overflow-x-auto">
          {loading ? (
            <p className="text-text-secondary text-[13px] text-center py-12">Loading…</p>
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <span className="material-icons text-[40px] text-text-disabled">verified</span>
              <p className="text-text-secondary text-[14px]">No incidents found</p>
            </div>
          ) : (
            <table className="w-full text-[13px]" style={{ minWidth: 960 }}>
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Title</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Severity</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Status</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Reporter</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Assignee</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Job</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Created</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {incidents.map(inc => {
                  const reporter = inc.reporter ? `${inc.reporter.name} ${inc.reporter.surname}`.trim() : '—'
                  const assignee = inc.assignee ? `${inc.assignee.name} ${inc.assignee.surname}`.trim() : '—'
                  return (
                    <tr key={inc.id} className="hover:bg-background transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/incidents/${inc.id}`)}>
                      <td className="px-4 py-3 font-medium text-text-primary max-w-[220px] truncate">
                        {inc.title ?? inc.description ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={inc.severity} bg={sevBg(inc.severity)} fg={sevFg(inc.severity)} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary capitalize">{inc.status}</td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[120px]">{reporter}</td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[120px]">{assignee}</td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[140px]">{inc.jobs?.title ?? '—'}</td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{fmtDate(inc.created_at)}</td>
                      <td className="px-4 py-3 text-right">
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
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-divider">
        <span className="text-[12px] text-text-secondary">
          {total === 0 ? '0 incidents' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Previous</button>
          <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}
