/**
 * Guest-house housekeeping jobs.
 * An open job is tagged with external_ref housekeeping:{unitId}.
 * Completing that job sets the room clean. Marking the room clean or inspected closes the job.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createJob, setJobAssignments } from '@/lib/jobs'

export const HOUSEKEEPING_REF_PREFIX = 'housekeeping:'

const OPEN_JOB_STATUSES = ['open', 'scheduled', 'in_progress'] as const

export type HousekeepingJob = {
  id: string
  job_code: string | null
  title: string
  unit_id: string | null
  status: string
  assignee_employee_id: string | null
  external_ref: string | null
}

export function housekeepingRef(unitId: string): string {
  return `${HOUSEKEEPING_REF_PREFIX}${unitId}`
}

export function unitIdFromHousekeepingRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(HOUSEKEEPING_REF_PREFIX)) return null
  const id = ref.slice(HOUSEKEEPING_REF_PREFIX.length).trim()
  return id || null
}

export async function findOpenHousekeepingJob(
  supabase: SupabaseClient,
  opts: { companyId: string; unitId: string },
): Promise<{ ok: true; job: HousekeepingJob | null } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, job_code, title, unit_id, status, assignee_employee_id, external_ref')
    .eq('company_id', opts.companyId)
    .eq('unit_id', opts.unitId)
    .eq('external_ref', housekeepingRef(opts.unitId))
    .in('status', [...OPEN_JOB_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, message: error.message }
  return { ok: true, job: (data as HousekeepingJob | null) ?? null }
}

export async function listOpenHousekeepingJobs(
  supabase: SupabaseClient,
  opts: { companyId: string; siteId: string },
): Promise<{ ok: true; jobs: HousekeepingJob[] } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, job_code, title, unit_id, status, assignee_employee_id, external_ref')
    .eq('company_id', opts.companyId)
    .eq('site_id', opts.siteId)
    .like('external_ref', `${HOUSEKEEPING_REF_PREFIX}%`)
    .in('status', [...OPEN_JOB_STATUSES])
    .limit(500)

  if (error) return { ok: false, message: error.message }
  return { ok: true, jobs: (data ?? []) as HousekeepingJob[] }
}

/** Create an open clean-room job, or return the one already open for that room. */
export async function ensureHousekeepingJob(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    siteId: string
    unitId: string
    unitNumber: string
    employeeId?: string | null
    assigneeEmployeeId?: string | null
  },
): Promise<{ ok: true; jobId: string; jobCode: string | null; created: boolean } | { ok: false; message: string }> {
  const existing = await findOpenHousekeepingJob(supabase, {
    companyId: opts.companyId,
    unitId: opts.unitId,
  })
  if (!existing.ok) return existing
  if (existing.job) {
    return {
      ok: true,
      jobId: existing.job.id,
      jobCode: existing.job.job_code,
      created: false,
    }
  }

  const room = opts.unitNumber.trim() || 'room'
  const created = await createJob(supabase, {
    companyId: opts.companyId,
    title: `Clean room ${room}`,
    description: 'Housekeeping after check-out. Completing this job marks the room clean.',
    siteId: opts.siteId,
    unitId: opts.unitId,
    status: 'open',
    priority: 'medium',
    assigneeEmployeeId: opts.assigneeEmployeeId ?? null,
    createdByEmployeeId: opts.employeeId ?? null,
    assignCode: true,
  })
  if (!created.ok) return created

  const { error } = await supabase
    .from('jobs')
    .update({ external_ref: housekeepingRef(opts.unitId) })
    .eq('id', created.data.id)
    .eq('company_id', opts.companyId)

  if (error) return { ok: false, message: error.message }

  return {
    ok: true,
    jobId: created.data.id,
    jobCode: created.data.job_code,
    created: true,
  }
}

export async function assignHousekeepingCleaner(
  supabase: SupabaseClient,
  opts: { companyId: string; jobId: string; employeeId: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const assigned = opts.employeeId ? [opts.employeeId] : []
  const result = await setJobAssignments(supabase, {
    companyId: opts.companyId,
    jobId: opts.jobId,
    assigneeEmployeeId: opts.employeeId,
    assignedEmployeeIds: assigned,
  })
  if (!result.ok) return result
  return { ok: true }
}

/** Close the open clean-room job without changing the room status. */
export async function closeOpenHousekeepingJob(
  supabase: SupabaseClient,
  opts: { companyId: string; unitId: string },
): Promise<{ ok: true; closedJobId: string | null } | { ok: false; message: string }> {
  const existing = await findOpenHousekeepingJob(supabase, opts)
  if (!existing.ok) return existing
  if (!existing.job) return { ok: true, closedJobId: null }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('jobs')
    .update({ status: 'completed', closed_at: now })
    .eq('id', existing.job.id)
    .eq('company_id', opts.companyId)

  if (error) return { ok: false, message: error.message }
  return { ok: true, closedJobId: existing.job.id }
}

/** Close the open clean-room job and set the room clean. */
export async function completeHousekeepingForUnit(
  supabase: SupabaseClient,
  opts: { companyId: string; unitId: string },
): Promise<{ ok: true; closedJobId: string | null } | { ok: false; message: string }> {
  const closed = await closeOpenHousekeepingJob(supabase, opts)
  if (!closed.ok) return closed

  const { error: unitErr } = await supabase
    .from('units')
    .update({ housekeeping_status: 'clean' })
    .eq('id', opts.unitId)
    .eq('company_id', opts.companyId)
  if (unitErr) return { ok: false, message: unitErr.message }

  return { ok: true, closedJobId: closed.closedJobId }
}

/**
 * When a housekeeping job is marked completed from the jobs screen,
 * set that room clean. Other job types are ignored.
 */
export async function applyHousekeepingFromCompletedJob(
  supabase: SupabaseClient,
  opts: { companyId: string; jobId: string },
): Promise<{ ok: true; applied: boolean } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, unit_id, external_ref')
    .eq('id', opts.jobId)
    .eq('company_id', opts.companyId)
    .maybeSingle()

  if (error) return { ok: false, message: error.message }
  if (!data || data.status !== 'completed') return { ok: true, applied: false }

  const unitId = (data.unit_id as string | null) ?? unitIdFromHousekeepingRef(data.external_ref as string | null)
  if (!unitId || !unitIdFromHousekeepingRef(data.external_ref as string | null)) {
    return { ok: true, applied: false }
  }

  const { error: unitErr } = await supabase
    .from('units')
    .update({ housekeeping_status: 'clean' })
    .eq('id', unitId)
    .eq('company_id', opts.companyId)

  if (unitErr) return { ok: false, message: unitErr.message }
  return { ok: true, applied: true }
}
