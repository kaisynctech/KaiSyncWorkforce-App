'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { downloadJobPack, JOB_PACK_MAX_AGE_MS, loadJobPack } from '@/lib/offline/job-pack'
import { networkLooksDown } from '@/lib/offline/meta'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import {
  StatusFilterTabs,
  MONEY_TH,
  MONEY_TD,
  type StatusTabDef,
} from '@/components/ui/StatusFilterTabs'
import {
  ResetFiltersButton,
  TextHeaderFilter,
  StatusHeaderFilter,
  matchText,
  statusTab,
  type ColumnOption,
  type TabTone,
} from '@/components/ui/MoneyListFilters'

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

/** Scope / status tabs filter via job-ownership helpers, so `match` stays null. */
const SCOPE_TABS: StatusTabDef[] = [
  { ...statusTab('assigned', 'Assigned', [], 'slate'), match: null },
  { ...statusTab('created', 'My Jobs', [], 'slate'), match: null },
  { ...statusTab('all', 'All', [], 'slate'), match: null },
]

const STATUS_TONES: Record<JobStatusFilter, TabTone> = {
  open: 'blue',
  all: 'slate',
  scheduled: 'indigo',
  in_progress: 'amber',
  completed: 'green',
  cancelled: 'red',
}

const STATUS_TABS: StatusTabDef[] = JOB_STATUS_FILTERS.map((s) => ({
  ...statusTab(s.key, s.label, [], STATUS_TONES[s.key]),
  match: null,
}))

function priorityLabel(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function EmployeeJobsPage() {
  const router = useRouter()
  const allowed = useEmployeeModuleGate('jobs')
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<JobScope>('assigned')
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>('all')
  const [codeCol, setCodeCol] = useState('')
  const [titleCol, setTitleCol] = useState('')
  const [statusCol, setStatusCol] = useState<string[]>([])
  const [priorityCol, setPriorityCol] = useState<string[]>([])
  const [empId, setEmpId] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [cacheAt, setCacheAt] = useState<string | null>(null)

  useEffect(() => {
    if (allowed !== true) return
    void init()
  }, [allowed])

  /** `force` skips the 2-minute pack reuse (the Refresh button). */
  async function init(options?: { force?: boolean }) {
    setLoading(true)
    setFromCache(false)
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
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const pack = await loadJobPack(member.companyId, member.employeeId)
        if (pack) {
          setJobs(sortJobsByCreatedDesc(pack.jobs as Job[]))
          setFromCache(true)
          setCacheAt(pack.syncedAt)
        }
        setLoading(false)
        return
      }
      const pack = await downloadJobPack(supabase, {
        companyId: member.companyId,
        employeeId: member.employeeId,
        sessionToken: tok,
        maxAgeMs: options?.force ? 0 : JOB_PACK_MAX_AGE_MS,
      })
      setJobs(sortJobsByCreatedDesc(pack.jobs as Job[]))
      setCacheAt(pack.syncedAt)
    } catch (e) {
      console.error('Failed to load jobs:', e)
      const pack = await loadJobPack(member.companyId, member.employeeId)
      if (pack) {
        setJobs(sortJobsByCreatedDesc(pack.jobs as Job[]))
        setFromCache(true)
        setCacheAt(pack.syncedAt)
      } else if (!networkLooksDown(e instanceof Error ? e.message : null)) {
        /* keep empty */
      }
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!empId) return []
    return sortJobsByCreatedDesc(
      jobs.filter(
        (j) =>
          matchesJobScope(j, tab, empId) &&
          matchesJobStatus(j, statusFilter) &&
          matchText(j.job_code, codeCol) &&
          matchText(j.title, titleCol) &&
          (statusCol.length === 0 || statusCol.includes(normalizeStatus(j.status))) &&
          (priorityCol.length === 0 || priorityCol.includes(j.priority ?? '')),
      ),
    )
  }, [jobs, tab, statusFilter, empId, codeCol, titleCol, statusCol, priorityCol])

  /** Column-filter options come from the loaded jobs only (no invented values). */
  const statusOptions = useMemo<ColumnOption[]>(() => {
    const seen = new Set<string>()
    for (const j of jobs) {
      const s = normalizeStatus(j.status)
      if (s) seen.add(s)
    }
    return [...seen].sort().map((id) => ({ id, label: statusLabel(id) }))
  }, [jobs])

  const priorityOptions = useMemo<ColumnOption[]>(() => {
    const seen = new Set<string>()
    for (const j of jobs) if (j.priority) seen.add(j.priority)
    return [...seen].sort().map((id) => ({ id, label: priorityLabel(id) }))
  }, [jobs])

  const hasColumnFilters =
    codeCol !== '' || titleCol !== '' || statusCol.length > 0 || priorityCol.length > 0
  const hasFilters = hasColumnFilters || tab !== 'assigned' || statusFilter !== 'all'

  function resetFilters() {
    setTab('assigned')
    setStatusFilter('all')
    setCodeCol('')
    setTitleCol('')
    setStatusCol([])
    setPriorityCol([])
  }

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
              onClick={() => void init({ force: true })}
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

        {fromCache && (
          <p className="mt-2 text-[12px] text-warning">
            Showing jobs saved on this device
            {cacheAt ? ` · synced ${new Date(cacheAt).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.
            Connect to get new assignments.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <ResetFiltersButton disabled={!hasFilters} onReset={resetFilters} />
          <StatusFilterTabs
            tabs={SCOPE_TABS}
            value={tab}
            counts={{}}
            onChange={(id) => setTab(id as JobScope)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <StatusFilterTabs
            tabs={STATUS_TABS}
            value={statusFilter}
            counts={{}}
            onChange={(id) => setStatusFilter(id as JobStatusFilter)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-[14px]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">work_off</span>
            <p className="text-[14px]">
              {hasColumnFilters ? 'No jobs match your column filters.' : EMPTY_MESSAGES[tab]}
            </p>
          </div>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter label="Code" value={codeCol} onChange={setCodeCol} placeholder="Job code…" />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter label="Title" value={titleCol} onChange={setTitleCol} placeholder="Job title…" />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <StatusHeaderFilter label="Status" options={statusOptions} selected={statusCol} onChange={setStatusCol} />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <StatusHeaderFilter label="Priority" options={priorityOptions} selected={priorityCol} onChange={setPriorityCol} />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>Scheduled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {filtered.map((job) => (
                    <tr key={job.id} className="hover:bg-surface-elevated transition-colors">
                      <td className={`${MONEY_TD} text-text-disabled whitespace-nowrap`}>
                        {job.job_code ?? '—'}
                      </td>
                      <td className={MONEY_TD}>
                        <Link
                          href={`/dashboard/employee/jobs/${job.id}`}
                          className="text-[12px] font-semibold text-primary hover:underline"
                        >
                          {job.title}
                        </Link>
                      </td>
                      <td className={`${MONEY_TD} whitespace-nowrap`}>
                        {job.status ? (
                          <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${STATUS_COLORS[normalizeStatus(job.status)] ?? 'bg-surface-elevated text-text-secondary'}`}>
                            {statusLabel(job.status)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`${MONEY_TD} whitespace-nowrap`}>
                        {job.priority ? (
                          <span className={`text-[12px] font-medium capitalize ${PRIORITY_COLORS[job.priority] ?? 'text-text-secondary'}`}>
                            {job.priority}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>
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
            }
            mobile={
              <>
                {filtered.map((job) => (
                  <DataCard key={job.id} onClick={() => router.push(`/dashboard/employee/jobs/${job.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <DataCardTitle>{job.title}</DataCardTitle>
                        <DataCardMeta className="font-mono">{job.job_code ?? '—'}</DataCardMeta>
                      </div>
                      {job.status && (
                        <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize shrink-0 ${STATUS_COLORS[normalizeStatus(job.status)] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {statusLabel(job.status)}
                        </span>
                      )}
                    </div>
                    <DataCardRow
                      label="Priority"
                      value={job.priority ? job.priority : '—'}
                    />
                    <DataCardRow
                      label="Scheduled"
                      value={
                        job.scheduled_start
                          ? new Date(job.scheduled_start).toLocaleDateString('en-ZA', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                          : '—'
                      }
                    />
                  </DataCard>
                ))}
              </>
            }
          />
        )}
      </div>
    </div>
  )
}
