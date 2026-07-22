'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import {
  JOB_STATUS_FILTERS,
  matchesJobScope,
  matchesJobStatus,
  normalizeStatus,
  sortJobsByCreatedDesc,
  type JobScope,
  type JobStatusFilter,
} from '@/lib/job-ownership'

interface Job {
  id: string
  title: string
  status: string | null
  priority: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  job_code: string | null
  description: string | null
  created_at: string
  assignee_employee_id: string | null
  assigned_employee_ids: string[] | null
  created_by_employee_id: string | null
  contractor_employee_id?: string | null
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-primary/10 text-primary',
  open: 'bg-primary/10 text-primary',
  in_progress: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-text-disabled',
  medium: 'text-warning',
  high: 'text-error',
  critical: 'text-error font-bold',
}

function statusLabel(s: string | null): string {
  if (!s) return '—'
  return normalizeStatus(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const EMPTY_MESSAGES: Record<JobScope, string> = {
  assigned: 'No jobs assigned to you by HR or your manager yet.',
  created: 'You have not created any jobs yet. Tap + Job to add one.',
  all: 'No jobs yet — assigned jobs and jobs you create will appear here.',
}

export default function EmployeeJobsPage() {
  const allowed = useEmployeeModuleGate('jobs')
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<JobScope>('assigned')
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>('all')
  const [empId, setEmpId] = useState<string | null>(null)

  useEffect(() => {
    if (allowed !== true) return
    void init()
  }, [allowed])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setLoading(false)
      return
    }
    setEmpId(member.employeeId)

    try {
      const tok = member.sessionToken
        ?? (await supabase.auth.getSession()).data.session?.access_token
        ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('employee_get_jobs_for_employee', {
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_session_token: tok,
      })
      if (error) throw error
      setJobs(sortJobsByCreatedDesc((data as Job[]) ?? []))
    } catch (e) {
      console.error('Failed to load jobs:', e)
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!empId) return []
    return sortJobsByCreatedDesc(
      jobs.filter(
        (j) => matchesJobScope(j, tab, empId) && matchesJobStatus(j, statusFilter),
      ),
    )
  }, [jobs, tab, statusFilter, empId])

  if (allowed === null || (allowed && loading && jobs.length === 0)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">My Jobs</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void init()}
              className="text-text-secondary hover:text-text-primary p-1.5"
              aria-label="Refresh"
            >
              <span className="material-icons text-[20px]">refresh</span>
            </button>
            <Link
              href="/dashboard/employee/jobs/new"
              className="flex items-center gap-1 bg-primary text-white text-[13px] font-semibold px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors"
            >
              <span className="material-icons text-[16px]">add</span>Job
            </Link>
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          {([
            { key: 'assigned' as const, label: 'Assigned' },
            { key: 'created' as const, label: 'My Jobs' },
            { key: 'all' as const, label: 'All' },
          ]).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                tab === t.key
                  ? 'bg-primary text-white'
                  : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {JOB_STATUS_FILTERS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(s.key)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                statusFilter === s.key
                  ? 'bg-primary text-white'
                  : 'bg-surface-elevated text-text-secondary border border-divider'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-[14px]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">work_off</span>
            <p className="text-[14px]">{EMPTY_MESSAGES[tab]}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Code</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Priority</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Scheduled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {filtered.map((job) => (
                  <tr key={job.id} className="hover:bg-surface-elevated transition-colors">
                    <td className="px-4 py-3 text-[12px] text-text-disabled whitespace-nowrap">
                      {job.job_code ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/employee/jobs/${job.id}`}
                        className="text-[13px] font-semibold text-primary hover:underline"
                      >
                        {job.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {job.status ? (
                        <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${STATUS_COLORS[normalizeStatus(job.status)] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {statusLabel(job.status)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {job.priority ? (
                        <span className={`text-[12px] font-medium capitalize ${PRIORITY_COLORS[job.priority] ?? 'text-text-secondary'}`}>
                          {job.priority}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {job.scheduled_start
                        ? new Date(job.scheduled_start).toLocaleDateString('en-ZA', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
