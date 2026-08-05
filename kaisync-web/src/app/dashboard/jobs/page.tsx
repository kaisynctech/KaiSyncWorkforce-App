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
import { KpiTile } from '@/components/ui/KpiTile'
import { cn, formatDate, formatCurrency } from '@/lib/utils'
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

  const canCreate = can(perms, PERM.jobsCreate)
  const canViewAll = can(perms, PERM.jobsViewAll)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, statusFilter, scope, pageSize, dateFrom, dateTo, dateFilter])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    const nextPerms = await loadPermissions(supabase, member.companyId, me?.access_level)
    setPerms(nextPerms)

    const effectiveScope: Scope =
      scope === 'all' && !can(nextPerms, PERM.jobsViewAll) ? 'mine' : scope

    const jobScope = () =>
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('company_id', member.companyId)

    const { from, to } = pageRange(page, pageSize)
    let query = supabase
      .from('jobs')
      .select('*, clients(name, client_code)', { count: 'exact' })
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (effectiveScope === 'mine') {
      query = query.or(`assignee_employee_id.eq.${member.employeeId},assigned_employee_ids.cs.{${member.employeeId}}`)
    }
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (searchDebounced) {
      const q = escapeIlike(searchDebounced)
      query = query.or(`title.ilike.%${q}%,job_code.ilike.%${q}%`)
    }
    if (dateFilter && dateFrom) query = query.gte('scheduled_start', dateFrom)
    if (dateFilter && dateTo) query = query.lte('scheduled_end', `${dateTo}T23:59:59`)

    const [pageRes, totalRes, openRes, inProgRes, unassignedRes] = await Promise.all([
      query.range(from, to),
      jobScope(),
      jobScope().in('status', ['open', 'scheduled', 'in_progress']),
      jobScope().eq('status', 'in_progress'),
      jobScope().is('assignee_employee_id', null).neq('status', 'completed').neq('status', 'cancelled'),
    ])

    if (pageRes.error) {
      setError(pageRes.error.message)
      setJobs([])
      setTotal(0)
    } else {
      setError(null)
      setJobs((pageRes.data ?? []) as Job[])
      setTotal(pageRes.count ?? 0)
    }

    setKpis({
      total: totalRes.count ?? 0,
      open: openRes.count ?? 0,
      inProgress: inProgRes.count ?? 0,
      unassigned: unassignedRes.count ?? 0,
    })
    setLoading(false)
  }, [scope, page, pageSize, searchDebounced, statusFilter, dateFilter, dateFrom, dateTo])

  useEffect(() => { void loadJobs() }, [loadJobs])

  const filtered = jobs
  const pages = totalPages(total, pageSize)

  function downloadCSV() {
    const headers = ['Code', 'Title', 'Client', 'Status', 'Priority', 'Start', 'End', 'Estimated Cost']
    const rows = filtered.map(job => {
      const client = (job.clients as { name: string } | undefined)?.name ?? ''
      return [
        job.job_code ?? job.id.slice(0, 8).toUpperCase(),
        job.title,
        client,
        job.status,
        job.priority,
        job.scheduled_start ?? '',
        job.scheduled_end ?? '',
        job.estimated_cost != null ? String(job.estimated_cost) : '',
      ]
    })
    const csv = [headers, ...rows]
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

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-bold text-text-primary">Jobs</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadCSV}
            className="flex items-center gap-1.5 h-9 px-3 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors"
          >
            <span className="material-icons text-[16px]">download</span>
            Export
          </button>
          {canCreate && (
            <Link
              href="/dashboard/jobs/new"
              className="flex items-center gap-1.5 h-9 px-3 rounded-sm bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
            >
              <span className="material-icons text-[16px]">add</span>
              New Job
            </Link>
          )}
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error">
          Failed to load jobs: {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile value={kpis.total} label="Total" bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
        <KpiTile value={kpis.open} label="Open" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
        <KpiTile value={kpis.inProgress} label="In progress" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
        <KpiTile value={kpis.unassigned} label="Unassigned" bg="#1E293B" valueFg="#FCA5A5" labelFg="#64748B" />
      </div>

      {/* Scope toggle */}
      <div className="grid grid-cols-2 gap-2">
        {([
          { value: 'all' as Scope, label: `All Jobs${canViewAll ? ` (${kpis.total})` : ''}`, disabled: !canViewAll },
          { value: 'mine' as Scope, label: 'My Jobs', disabled: false },
        ]).map(({ value, label, disabled }) => (
          <button
            key={value}
            onClick={() => !disabled && setScope(value)}
            disabled={disabled}
            className={cn(
              'h-9 rounded-[10px] text-[12px] font-medium transition-colors disabled:opacity-40',
              scope === value ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-divider hover:text-text-primary'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12px] text-text-secondary">
          {total === 0 ? '0 jobs' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="dark-entry h-8 text-[12px] py-0 w-auto">
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>

      {/* Filter toolbar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-sm flex-1">
            <span className="material-icons text-text-disabled text-[18px]">search</span>
            <input
              type="text"
              placeholder="Search jobs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
          <button
            onClick={() => setFilterOpen(v => !v)}
            className={cn(
              'h-10 px-3 rounded-sm border text-[13px] font-medium flex items-center gap-1.5 transition-colors',
              filterOpen ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-text-secondary hover:text-text-primary'
            )}
          >
            <span className="material-icons text-[16px]">filter_list</span>
            Filter
          </button>
        </div>

        {filterOpen && (
          <div className="bg-surface border border-divider rounded-sm p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-text-primary">Date filter</p>
              <button
                onClick={() => setDateFilter(v => !v)}
                className={cn(
                  'relative w-[44px] h-[26px] rounded-pill transition-colors',
                  dateFilter ? 'bg-primary' : 'bg-border'
                )}
              >
                <span className={cn(
                  'absolute top-[3px] w-5 h-5 bg-white rounded-full shadow transition-transform',
                  dateFilter ? 'translate-x-[21px]' : 'translate-x-[3px]'
                )} />
              </button>
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
        )}
      </div>

      {/* Jobs table */}
      <div className="bg-surface border border-divider rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[48px] text-text-disabled block mb-2">work_outline</span>
            <p className="text-[14px] text-text-secondary">No jobs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-[13px]" style={{ minWidth: 980 }}>
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[90px]">Code</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[180px]">Title</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[140px]">Client</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[100px]">Status</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[90px]">Priority</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[110px]">Start</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-secondary w-[110px]">End</th>
                  <th className="text-right px-4 py-3 text-[11px] font-medium text-text-secondary w-[90px]">Cost</th>
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
                      <td className="px-4 py-3 font-mono text-[11px] text-text-secondary">
                        {job.job_code ?? job.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary truncate max-w-[160px]">{job.title || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[130px]">
                        {client?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${statusBadge.cls}`}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${priorityBadge.cls}`}>
                          {priorityBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-[12px]">
                        {job.scheduled_start ? formatDate(job.scheduled_start) : '—'}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-[12px]">
                        {job.scheduled_end ? formatDate(job.scheduled_end) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-text-primary">
                        {job.estimated_cost != null ? formatCurrency(job.estimated_cost) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Previous</button>
        <span className="text-[12px] text-text-secondary">Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
