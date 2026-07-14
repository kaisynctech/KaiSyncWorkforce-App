'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { cn, formatDate, formatCurrency } from '@/lib/utils'
import type { Job, JobStatus, JobPriority } from '@/types/database'

type Scope = 'all' | 'mine'

const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_BADGES: Record<JobStatus, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  scheduled: { label: 'Scheduled', cls: 'bg-warning-dark text-[#92400E]' },
  in_progress: { label: 'In Progress', cls: 'bg-success-dark text-[#166534]' },
  completed: { label: 'Completed', cls: 'bg-surface-elevated text-text-secondary' },
  cancelled: { label: 'Cancelled', cls: 'bg-error-dark text-[#991B1B]' },
}

const PRIORITY_BADGES: Record<JobPriority, { label: string; cls: string }> = {
  high: { label: 'High', cls: 'bg-error-dark text-error' },
  medium: { label: 'Medium', cls: 'bg-warning-dark text-[#92400E]' },
  low: { label: 'Low', cls: 'bg-surface-elevated text-text-secondary' },
}

export default function JobsPage() {
  const router = useRouter()

  const [jobs, setJobs] = useState<Job[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => { loadJobs() }, [scope])

  async function loadJobs() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    let query = supabase
      .from('jobs')
      .select('*, clients(name, code)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (scope === 'mine') {
      query = query.eq('assigned_employee_id', member.employeeId)
    }

    const { data } = await query
    setJobs((data ?? []) as Job[])
    setLoading(false)
  }

  const filtered = jobs.filter(job => {
    if (statusFilter !== 'all' && job.status !== statusFilter) return false
    if (dateFilter) {
      if (dateFrom && job.scheduled_start && job.scheduled_start < dateFrom) return false
      if (dateTo && job.scheduled_end && job.scheduled_end > dateTo + 'T23:59:59') return false
    }
    if (search) {
      const q = search.toLowerCase()
      const clientName = (job.clients as { name: string } | null | undefined)?.name ?? ''
      return (
        job.title.toLowerCase().includes(q) ||
        clientName.toLowerCase().includes(q) ||
        job.id.toLowerCase().includes(q)
      )
    }
    return true
  })

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

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-bold text-text-primary">Jobs</h1>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors">
            <span className="material-icons text-[16px]">download</span>
            Export
          </button>
          <Link
            href="/dashboard/jobs/new"
            className="flex items-center gap-1.5 h-9 px-3 rounded-sm bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
          >
            <span className="material-icons text-[16px]">add</span>
            New Job
          </Link>
        </div>
      </div>

      {/* Scope toggle */}
      <div className="grid grid-cols-2 gap-2">
        {([
          { value: 'all' as Scope, label: `All Jobs (${jobs.length})` },
          { value: 'mine' as Scope, label: 'My Jobs' },
        ]).map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setScope(value)}
            className={cn(
              'h-9 rounded-[10px] text-[12px] font-medium transition-colors',
              scope === value ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-divider hover:text-text-primary'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="text-[12px] text-text-secondary">{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>

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
                  const statusBadge = STATUS_BADGES[job.status]
                  const priorityBadge = PRIORITY_BADGES[job.priority]
                  const client = job.clients as { name: string; code: string | null } | undefined
                  return (
                    <tr
                      key={job.id}
                      className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-[11px] text-text-secondary">
                        {job.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary truncate max-w-[160px]">{job.title}</p>
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
    </div>
  )
}
