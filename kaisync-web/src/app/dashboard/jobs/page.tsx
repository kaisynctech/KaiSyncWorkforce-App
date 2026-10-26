'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { cn, formatDate, formatCurrency } from '@/lib/utils'
import { Toggle } from '@/components/Toggle'
import { JobsTabs } from '@/components/jobs/JobsTabs'
import { areaOptions, listClientSites, listJobServices, listSiteAreas, type AreaOption } from '@/lib/job-services'
import type { Job, JobStatus } from '@/types/database'

type Scope = 'all' | 'mine'

type JobKpis = {
  total: number
  open: number
  inProgress: number
  unassigned: number
}

const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  scheduled: { label: 'Scheduled', cls: 'bg-warning-dark text-[#92400E]' },
  in_progress: { label: 'In Progress', cls: 'bg-success-dark text-[#166534]' },
  inProgress: { label: 'In Progress', cls: 'bg-success-dark text-[#166534]' },
  completed: { label: 'Completed', cls: 'bg-surface-elevated text-text-secondary' },
  cancelled: { label: 'Cancelled', cls: 'bg-error-dark text-[#991B1B]' },
}

const PRIORITY_BADGES: Record<string, { label: string; cls: string }> = {
  high: { label: 'High', cls: 'bg-error-dark text-error' },
  medium: { label: 'Medium', cls: 'bg-warning-dark text-[#92400E]' },
  normal: { label: 'Normal', cls: 'bg-warning-dark text-[#92400E]' },
  low: { label: 'Low', cls: 'bg-surface-elevated text-text-secondary' },
  none: { label: 'None', cls: 'bg-surface-elevated text-text-secondary' },
}

const FALLBACK_BADGE = { label: '—', cls: 'bg-surface-elevated text-text-secondary' }

const JOB_LIST_SELECT =
  '*, clients(name, client_code), sites(name, address), area:area_id(id, name, parent:parent_area_id(name)), service:service_id(id, name)'

const filterSelect =
  'h-9 px-2 rounded-sm border border-border bg-surface-elevated text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'

function areaLabel(job: Job): string {
  if (!job.area) return ''
  return job.area.parent?.name ? `${job.area.parent.name} › ${job.area.name}` : job.area.name
}

type JobListFilters = {
  companyId: string
  employeeId: string
  scope: Scope
  canViewAll: boolean
  statusFilter: JobStatus | 'all'
  search: string
  dateFilter: boolean
  dateFrom: string
  dateTo: string
  clientIds: string[]
  /** Filter panel: one client, one site, an area (with the areas inside it), one service. */
  clientId: string
  siteId: string
  areaIds: string[]
  serviceId: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withJobFilters(query: any, filters: JobListFilters) {
  const effectiveScope: Scope =
    filters.scope === 'all' && !filters.canViewAll ? 'mine' : filters.scope
  let next = query.eq('company_id', filters.companyId)
  if (effectiveScope === 'mine') {
    next = next.or(
      `assignee_employee_id.eq.${filters.employeeId},assigned_employee_ids.cs.{${filters.employeeId}}`,
    )
  }
  if (filters.statusFilter !== 'all') next = next.eq('status', filters.statusFilter)
  if (filters.search) {
    const q = escapeIlike(filters.search)
    const parts = [`title.ilike.%${q}%`, `job_code.ilike.%${q}%`]
    if (filters.clientIds.length > 0) parts.push(`client_id.in.(${filters.clientIds.join(',')})`)
    next = next.or(parts.join(','))
  }
  if (filters.clientId) next = next.eq('client_id', filters.clientId)
  if (filters.siteId) next = next.eq('site_id', filters.siteId)
  if (filters.areaIds.length > 0) next = next.in('area_id', filters.areaIds)
  if (filters.serviceId) next = next.eq('service_id', filters.serviceId)
  if (filters.dateFilter && filters.dateFrom) next = next.gte('scheduled_start', filters.dateFrom)
  if (filters.dateFilter && filters.dateTo) next = next.lte('scheduled_end', `${filters.dateTo}T23:59:59`)
  return next
}

function statusBadgeOf(raw: string | null | undefined) {
  if (!raw) return FALLBACK_BADGE
  return STATUS_BADGES[raw] ?? STATUS_BADGES[raw.toLowerCase()] ?? {
    label: raw.replace(/_/g, ' '),
    cls: FALLBACK_BADGE.cls,
  }
}

function priorityBadgeOf(raw: string | null | undefined) {
  if (!raw) return FALLBACK_BADGE
  return PRIORITY_BADGES[raw] ?? PRIORITY_BADGES[raw.toLowerCase()] ?? {
    label: raw.replace(/_/g, ' '),
    cls: FALLBACK_BADGE.cls,
  }
}

export default function JobsPage() {
  const router = useRouter()

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('all')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [kpis, setKpis] = useState<JobKpis>({ total: 0, open: 0, inProgress: 0, unassigned: 0 })
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [filterClients, setFilterClients] = useState<{ id: string; name: string }[]>([])
  const [filterServices, setFilterServices] = useState<{ id: string; name: string }[]>([])
  const [filterSites, setFilterSites] = useState<{ id: string; name: string }[]>([])
  const [filterAreas, setFilterAreas] = useState<AreaOption[]>([])
  const [clientFilter, setClientFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')

  const canCreate = can(perms, PERM.jobsCreate)
  const canViewAll = can(perms, PERM.jobsViewAll)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, statusFilter, scope, pageSize, dateFrom, dateTo, dateFilter, clientFilter, siteFilter, areaFilter, serviceFilter])

  // Filter choices: clients and services when the filter panel opens; sites and areas for the chosen client and site.
  useEffect(() => {
    if (!filterOpen || !companyId || filterServices.length || filterClients.length) return
    let cancelled = false
    const supabase = createClient()
    void Promise.all([
      supabase.from('clients').select('id, name').eq('company_id', companyId).order('name').limit(5000),
      listJobServices(supabase, companyId, { includeInactive: true }),
    ]).then(([c, sv]) => {
      if (cancelled) return
      setFilterClients((c.data ?? []) as { id: string; name: string }[])
      if (sv.ok) setFilterServices(sv.data.map(x => ({ id: x.id, name: x.name })))
    })
    return () => { cancelled = true }
  }, [filterOpen, companyId, filterServices.length, filterClients.length])

  useEffect(() => {
    let cancelled = false
    if (!companyId || !clientFilter) { void Promise.resolve().then(() => { if (!cancelled) setFilterSites([]) }); return () => { cancelled = true } }
    void listClientSites(createClient(), companyId, clientFilter).then(res => { if (!cancelled && res.ok) setFilterSites(res.data) })
    return () => { cancelled = true }
  }, [companyId, clientFilter])

  useEffect(() => {
    let cancelled = false
    if (!companyId || !siteFilter) { void Promise.resolve().then(() => { if (!cancelled) setFilterAreas([]) }); return () => { cancelled = true } }
    void listSiteAreas(createClient(), companyId, [siteFilter], { includeInactive: true }).then(res => {
      if (!cancelled && res.ok) setFilterAreas(areaOptions(res.data))
    })
    return () => { cancelled = true }
  }, [companyId, siteFilter])

  /** The chosen area and every area inside it. */
  const areaIds = (() => {
    if (!areaFilter) return [] as string[]
    const chosen = filterAreas.find(a => a.id === areaFilter)
    if (!chosen) return [areaFilter]
    return filterAreas.filter(a => a.id === areaFilter || a.path.startsWith(`${chosen.path} › `)).map(a => a.id)
  })()
  const areaKey = areaIds.join(',')
  const activeFilterCount = [clientFilter, siteFilter, areaFilter, serviceFilter].filter(Boolean).length
    + (statusFilter !== 'all' ? 1 : 0) + (dateFilter ? 1 : 0)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    const nextPerms = await loadPermissions(supabase, member.companyId, me?.access_level)
    setPerms(nextPerms)

    let clientIds: string[] = []
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      const { data: clientRows } = await supabase
        .from('clients')
        .select('id')
        .eq('company_id', member.companyId)
        .ilike('name', `%${q}%`)
      clientIds = (clientRows ?? []).map(row => row.id as string)
    }

    const filters: JobListFilters = {
      companyId: member.companyId,
      employeeId: member.employeeId,
      scope,
      canViewAll: can(nextPerms, PERM.jobsViewAll),
      statusFilter,
      search: searchDebounced,
      dateFilter,
      dateFrom,
      dateTo,
      clientIds,
      clientId: clientFilter,
      siteId: siteFilter,
      areaIds: areaKey ? areaKey.split(',') : [],
      serviceId: serviceFilter,
    }

    const { from, to } = pageRange(page, pageSize)
    const scopeFilters: JobListFilters = {
      ...filters,
      statusFilter: 'all',
      search: '',
      dateFilter: false,
      dateFrom: '',
      dateTo: '',
      clientIds: [],
      clientId: '',
      siteId: '',
      areaIds: [],
      serviceId: '',
    }
    const scopeCount = () =>
      withJobFilters(
        supabase.from('jobs').select('id', { count: 'exact', head: true }),
        scopeFilters,
      )

    const [pageRes, scopeRes, openRes, inProgRes, unassignedRes] = await Promise.all([
      withJobFilters(
        supabase.from('jobs').select(JOB_LIST_SELECT, { count: 'exact' }),
        filters,
      ).order('created_at', { ascending: false }).range(from, to),
      scopeCount(),
      scopeCount().eq('status', 'open'),
      scopeCount().eq('status', 'in_progress'),
      scopeCount()
        .is('assignee_employee_id', null)
        .or('assigned_employee_ids.is.null,assigned_employee_ids.eq.{}')
        .neq('status', 'completed')
        .neq('status', 'cancelled'),
    ])

    const kpiError = scopeRes.error ?? openRes.error ?? inProgRes.error ?? unassignedRes.error
    if (pageRes.error || kpiError) {
      setError(pageRes.error?.message ?? kpiError?.message ?? 'Could not load jobs.')
      if (pageRes.error) {
        setJobs([])
        setTotal(0)
        setKpis({ total: 0, open: 0, inProgress: 0, unassigned: 0 })
      }
    }
    if (!pageRes.error) {
      if (!kpiError) setError(null)
      setJobs((pageRes.data ?? []) as Job[])
      setTotal(pageRes.count ?? 0)
      if (!kpiError) {
        setKpis({
          total: scopeRes.count ?? 0,
          open: openRes.count ?? 0,
          inProgress: inProgRes.count ?? 0,
          unassigned: unassignedRes.count ?? 0,
        })
      }
    }
    setLoading(false)
  }, [scope, page, pageSize, searchDebounced, statusFilter, dateFilter, dateFrom, dateTo, clientFilter, siteFilter, areaKey, serviceFilter])

  useEffect(() => { void loadJobs() }, [loadJobs])

  const filtered = jobs
  const pages = totalPages(total, pageSize)

  async function downloadCSV() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) return

    let clientIds: string[] = []
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      const { data: clientRows } = await supabase
        .from('clients')
        .select('id')
        .eq('company_id', member.companyId)
        .ilike('name', `%${q}%`)
      clientIds = (clientRows ?? []).map(row => row.id as string)
    }

    const filters: JobListFilters = {
      companyId: member.companyId,
      employeeId: member.employeeId,
      scope,
      canViewAll,
      statusFilter,
      search: searchDebounced,
      dateFilter,
      dateFrom,
      dateTo,
      clientIds,
      clientId: clientFilter,
      siteId: siteFilter,
      areaIds,
      serviceId: serviceFilter,
    }

    const rows: Job[] = []
    const batch = 500
    for (let from = 0; from < 20000; from += batch) {
      const { data, error: exportError } = await withJobFilters(
        supabase.from('jobs').select(JOB_LIST_SELECT),
        filters,
      ).order('created_at', { ascending: false }).range(from, from + batch - 1)
      if (exportError) {
        setError(exportError.message)
        return
      }
      const pageRows = (data ?? []) as Job[]
      rows.push(...pageRows)
      if (pageRows.length < batch) break
    }

    const headers = ['Code', 'Title', 'Client', 'Site', 'Area', 'Service', 'Status', 'Priority', 'Start', 'End', 'Estimated Cost']
    const csvRows = rows.map(job => {
      const client = (job.clients as { name: string } | undefined)?.name ?? ''
      return [
        job.job_code ?? job.id.slice(0, 8).toUpperCase(),
        job.title,
        client,
        job.sites?.name ?? '',
        areaLabel(job),
        job.service?.name ?? '',
        job.status,
        job.priority,
        job.scheduled_start ?? '',
        job.scheduled_end ?? '',
        job.estimated_cost != null ? String(job.estimated_cost) : '',
      ]
    })
    const csv = [headers, ...csvRows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'jobs-export.csv'
    a.click()
    URL.revokeObjectURL(url)
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

  if (error && error !== 'not_linked') {
    // keep page chrome; show banner above table
  }

  const rangeLabel = total === 0
    ? '0 jobs'
    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[16px] font-bold text-text-primary">Jobs</h1>
            <JobsTabs active="jobs" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1 h-8 px-2.5 rounded-sm bg-surface border border-border text-[12px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors"
            >
              <span className="material-icons text-[16px]">download</span>
              Export
            </button>
            {canCreate && (
              <Link
                href="/dashboard/jobs/new"
                className="flex items-center gap-1 h-8 px-2.5 rounded-sm bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark transition-colors"
              >
                <span className="material-icons text-[16px]">add</span>
                New Job
              </Link>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#94A3B8]">{kpis.total}</span>
            <span className="text-[11px] text-[#64748B]">Total</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#0F2918]">
            <span className="text-[14px] font-semibold text-[#22C55E]">{kpis.open}</span>
            <span className="text-[11px] text-[#4ADE80]">Open</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#FCD34D]">{kpis.inProgress}</span>
            <span className="text-[11px] text-[#64748B]">In progress</span>
          </span>
          <span className="inline-flex items-baseline justify-center gap-1.5 rounded px-2 py-1 bg-[#1E293B]">
            <span className="text-[14px] font-semibold text-[#FCA5A5]">{kpis.unassigned}</span>
            <span className="text-[11px] text-[#64748B]">Unassigned</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-divider shrink-0">
            {([
              { value: 'all' as Scope, label: `All${canViewAll ? ` (${kpis.total})` : ''}`, disabled: !canViewAll },
              { value: 'mine' as Scope, label: 'Mine', disabled: false },
            ]).map(({ value, label, disabled }) => (
              <button
                key={value}
                onClick={() => !disabled && setScope(value)}
                disabled={disabled}
                className={cn(
                  'h-8 px-3 text-[12px] font-medium transition-colors disabled:opacity-40',
                  scope === value ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-text-primary'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-0">
            <span className="material-icons text-text-disabled text-[16px]">search</span>
            <input
              type="text"
              placeholder="Search title, code, or client"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
          <button
            onClick={() => setFilterOpen(v => !v)}
            className={cn(
              'h-8 px-2.5 rounded-sm border text-[12px] font-medium flex items-center gap-1 transition-colors shrink-0',
              filterOpen ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-text-secondary hover:text-text-primary'
            )}
          >
            <span className="material-icons text-[16px]" aria-hidden="true">filter_list</span>
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <div className="mx-3 mb-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error shrink-0">
          Failed to load jobs: {error}
        </div>
      )}

      {filterOpen && (
        <div className="mx-3 mb-2 shrink-0">
          <div className="bg-surface border border-divider rounded-sm p-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
                Client
                <select value={clientFilter} onChange={e => { setClientFilter(e.target.value); setSiteFilter(''); setAreaFilter('') }} className={filterSelect}>
                  <option value="">All clients</option>
                  {filterClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
                Site
                <select value={siteFilter} disabled={!clientFilter} onChange={e => { setSiteFilter(e.target.value); setAreaFilter('') }} className={filterSelect}>
                  <option value="">{clientFilter ? 'All sites' : 'Choose a client first'}</option>
                  {filterSites.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
                Area
                <select value={areaFilter} disabled={!siteFilter} onChange={e => setAreaFilter(e.target.value)} className={filterSelect}>
                  <option value="">{siteFilter ? 'All areas' : 'Choose a site first'}</option>
                  {filterAreas.map(a => <option key={a.id} value={a.id}>{`${'\u00A0\u00A0'.repeat(a.depth)}${a.name}`}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
                Service
                <select value={serviceFilter} onChange={e => setServiceFilter(e.target.value)} className={filterSelect}>
                  <option value="">All services</option>
                  {filterServices.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="text-[12px] text-primary hover:underline"
                onClick={() => { setClientFilter(''); setSiteFilter(''); setAreaFilter(''); setServiceFilter(''); setStatusFilter('all'); setDateFilter(false) }}
              >
                Clear filters
              </button>
            )}
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-text-primary">Date filter</p>
              <Toggle checked={dateFilter} onChange={setDateFilter} />
            </div>
            {dateFilter && (
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="flex-1 h-9 px-2 rounded-sm border border-border bg-surface-elevated text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary" />
                <span className="text-text-secondary">–</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="flex-1 h-9 px-2 rounded-sm border border-border bg-surface-elevated text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {STATUS_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  className={cn(
                    'h-8 px-[14px] rounded-pill text-[11px] font-medium transition-colors',
                    statusFilter === value ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border hover:text-text-primary'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto mx-3 mb-1 bg-surface border border-divider rounded-lg">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[48px] text-text-disabled block mb-2">work_outline</span>
            <p className="text-[14px] text-text-secondary">No jobs found</p>
          </div>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[100px]">Code</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary">Title</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[18%]">Client</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[110px]">Status</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[100px]">Priority</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[110px]">Start</th>
                    <th className="text-left px-3 py-2 text-[11px] font-medium text-text-secondary w-[110px]">End</th>
                    <th className="text-right px-3 py-2 text-[11px] font-medium text-text-secondary w-[100px]">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(job => {
                    const statusBadge = statusBadgeOf(job.status)
                    const priorityBadge = priorityBadgeOf(job.priority)
                    const client = job.clients as { name: string; client_code: string | null } | undefined
                    return (
                      <tr
                        key={job.id}
                        className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                        onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
                      >
                        <td className="px-3 py-2 font-mono text-[11px] text-text-secondary whitespace-nowrap">
                          {job.job_code ?? job.id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-text-primary truncate">{job.title || '—'}</p>
                          {(job.service?.name || job.area) && (
                            <p className="text-[11px] text-text-secondary truncate">
                              {[job.service?.name, areaLabel(job)].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-secondary truncate">
                          {client?.name ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${statusBadge.cls}`}>
                            {statusBadge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${priorityBadge.cls}`}>
                            {priorityBadge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-text-secondary text-[12px] whitespace-nowrap">
                          {job.scheduled_start ? formatDate(job.scheduled_start) : '—'}
                        </td>
                        <td className="px-3 py-2 text-text-secondary text-[12px] whitespace-nowrap">
                          {job.scheduled_end ? formatDate(job.scheduled_end) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-text-primary whitespace-nowrap">
                          {job.estimated_cost != null ? formatCurrency(job.estimated_cost) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            }
            mobile={
              <>
                {filtered.map(job => {
                  const statusBadge = statusBadgeOf(job.status)
                  const priorityBadge = priorityBadgeOf(job.priority)
                  const client = job.clients as { name: string; client_code: string | null } | undefined
                  return (
                    <DataCard
                      key={job.id}
                      onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>{job.title || '—'}</DataCardTitle>
                          <DataCardMeta className="font-mono">
                            {job.job_code ?? job.id.slice(0, 8).toUpperCase()}
                          </DataCardMeta>
                        </div>
                        <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium shrink-0 ${statusBadge.cls}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <DataCardRow label="Client" value={client?.name ?? '—'} />
                      {job.service?.name && <DataCardRow label="Service" value={job.service.name} />}
                      {job.area && <DataCardRow label="Area" value={areaLabel(job)} />}
                      <DataCardRow label="Priority" value={priorityBadge.label} />
                      <DataCardRow
                        label="Start"
                        value={job.scheduled_start ? formatDate(job.scheduled_start) : '—'}
                      />
                      <DataCardRow
                        label="End"
                        value={job.scheduled_end ? formatDate(job.scheduled_end) : '—'}
                      />
                      <DataCardRow
                        label="Cost"
                        value={job.estimated_cost != null ? formatCurrency(job.estimated_cost) : '—'}
                      />
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
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40">Previous</button>
        <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
