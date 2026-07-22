/**
 * Mirrors JobOwnershipHelper + JobAssignmentHelper from MAUI.
 */

export type JobOwnershipFields = {
  created_by_employee_id?: string | null
  assignee_employee_id?: string | null
  assigned_employee_ids?: string[] | null
  contractor_employee_id?: string | null
  status?: string | null
  created_at?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
}

export function isCreatedBy(job: JobOwnershipFields, employeeId: string): boolean {
  return !!job.created_by_employee_id && job.created_by_employee_id === employeeId
}

export function isAssignedTo(job: JobOwnershipFields, employeeId: string): boolean {
  if (job.assignee_employee_id === employeeId) return true
  if (Array.isArray(job.assigned_employee_ids) && job.assigned_employee_ids.includes(employeeId)) return true
  if (job.contractor_employee_id === employeeId) return true
  return false
}

/** On the team but not created by this employee (HR/manager-assigned). */
export function isAssignedByOthers(job: JobOwnershipFields, employeeId: string): boolean {
  return isAssignedTo(job, employeeId) && !isCreatedBy(job, employeeId)
}

export function isInAllJobsScope(job: JobOwnershipFields, employeeId: string): boolean {
  return isCreatedBy(job, employeeId) || isAssignedByOthers(job, employeeId)
}

export function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw.trim()
  if (s === 'inProgress') return 'in_progress'
  return s
}

/** MAUI Job.IsOpen — scheduled or in progress. */
export function isOpenJob(job: JobOwnershipFields): boolean {
  const s = normalizeStatus(job.status)
  return s === 'scheduled' || s === 'in_progress' || s === 'inProgress'
}

export type JobScope = 'assigned' | 'created' | 'all'
export type JobStatusFilter = 'open' | 'all' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export const JOB_STATUS_FILTERS: { key: JobStatusFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'all', label: 'Any' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

export function matchesJobScope(job: JobOwnershipFields, scope: JobScope, employeeId: string): boolean {
  if (scope === 'assigned') return isAssignedByOthers(job, employeeId)
  if (scope === 'created') return isCreatedBy(job, employeeId)
  return isInAllJobsScope(job, employeeId)
}

export function matchesJobStatus(job: JobOwnershipFields, filter: JobStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return isOpenJob(job)
  return normalizeStatus(job.status) === filter
}

export function sortJobsByCreatedDesc<T extends JobOwnershipFields>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const da = a.created_at ?? ''
    const db = b.created_at ?? ''
    return db.localeCompare(da)
  })
}

/** Ensure creator/assignee are included in assigned_employee_ids (MAUI JobAssignmentHelper). */
export function buildAssignedEmployeeIds(
  creatorId: string,
  selectedCoworkerIds: string[],
): string[] {
  const ids = new Set<string>([creatorId, ...selectedCoworkerIds])
  return Array.from(ids)
}
