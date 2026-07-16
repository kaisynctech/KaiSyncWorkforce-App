'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Job {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  description: string | null
  created_at: string
  scope?: 'assigned' | 'created'
}

const STATUS_COLORS: Record<string, string> = {
  open:        'bg-primary/10 text-primary',
  in_progress: 'bg-warning/10 text-warning',
  completed:   'bg-success/10 text-success',
  cancelled:   'bg-error/10 text-error',
}
const PRIORITY_COLORS: Record<string, string> = {
  low:      'text-text-disabled',
  medium:   'text-warning',
  high:     'text-error',
  critical: 'text-error font-bold',
}

function statusLabel(s: string | null): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

type Tab = 'assigned' | 'created' | 'all'

const EMPTY_MESSAGES: Record<Tab, string> = {
  assigned: 'No jobs assigned to you by HR or your manager yet.',
  created:  'You have not created any jobs yet. Tap + Job to add one.',
  all:      'No jobs yet — assigned jobs and jobs you create will appear here.',
}

export default function EmployeeJobsPage() {
  const [jobs, setJobs]       = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<Tab>('assigned')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('employee_get_jobs_for_employee', {
        p_employee_id: member.employeeId,
        p_company_id:  member.companyId,
      })
      if (error) throw error
      setJobs((data as Job[]) ?? [])
    } catch (e) {
      console.error('Failed to load jobs:', e)
    }
    setLoading(false)
  }

  const statuses = ['all', ...Array.from(new Set(jobs.map(j => j.status ?? 'open').filter(Boolean)))]

  const filtered = jobs.filter(j => {
    if (tab === 'assigned' && j.scope === 'created') return false
    if (tab === 'created'  && j.scope !== 'created') return false
    if (statusFilter !== 'all' && j.status !== statusFilter) return false
    return true
  })

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">My Jobs</h1>
          <Link href="/dashboard/employee/jobs/new"
            className="flex items-center gap-1 bg-primary text-white text-[13px] font-semibold px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors">
            <span className="material-icons text-[16px]">add</span>Job
          </Link>
        </div>
        <div className="flex gap-2 mt-3">
          {(['assigned', 'created', 'all'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                tab === t ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}>
              {t === 'assigned' ? 'Assigned' : t === 'created' ? 'Created' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {statuses.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors capitalize ${
                statusFilter === s ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
              }`}>
              {s === 'all' ? 'All Statuses' : statusLabel(s)}
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
          <div className="divide-y divide-divider">
            {filtered.map(job => (
              <Link key={job.id} href={`/dashboard/employee/jobs/${job.id}`}
                className="flex items-start justify-between gap-3 px-4 py-4 hover:bg-surface-elevated transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-text-primary truncate">{job.title}</p>
                  {job.description && (
                    <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">{job.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {job.status && (
                      <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${STATUS_COLORS[job.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                        {statusLabel(job.status)}
                      </span>
                    )}
                    {job.priority && (
                      <span className={`text-[11px] font-medium capitalize ${PRIORITY_COLORS[job.priority] ?? 'text-text-secondary'}`}>
                        {job.priority} priority
                      </span>
                    )}
                    {job.due_date && (
                      <span className="text-[11px] text-text-disabled">
                        Due {new Date(job.due_date + 'T12:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
                <span className="material-icons text-text-disabled text-[20px] shrink-0 mt-1">chevron_right</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
