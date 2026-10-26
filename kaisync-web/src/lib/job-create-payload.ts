/**
 * Build jobs INSERT payload aligned with live schema (job_code, assignments).
 */

export type JobCreateInput = {
  companyId: string
  title: string
  description?: string | null
  priority?: string | null
  estimatedCost?: number | null
  actualCost?: number | null
  contractorCost?: number | null
  scheduledStart?: string | null
  scheduledEnd?: string | null
  clientId?: string | null
  siteId?: string | null
  unitId?: string | null
  /** Area inside the site (site_areas). */
  areaId?: string | null
  /** What is done (job_services). */
  serviceId?: string | null
  contractorId?: string | null
  dealId?: string | null
  address?: string | null
  assigneeEmployeeId?: string | null
  assignedEmployeeIds?: string[] | null
  createdByEmployeeId?: string | null
  jobCode?: string | null
  status?: string | null
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

/** jobs.estimated_cost, actual_cost, and contractor_cost are NOT NULL DEFAULT 0.
 *  An explicit null overrides that default and the insert is rejected. */
function costOrOmit(value: number | null | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined
  return value
}

export function buildJobCreatePayload(input: JobCreateInput): Record<string, unknown> {
  const title = input.title.trim()
  if (!title) throw new Error('Job title is required.')

  const assignee = input.assigneeEmployeeId || null
  const assigned = Array.isArray(input.assignedEmployeeIds)
    ? input.assignedEmployeeIds.filter(Boolean)
    : assignee
      ? [assignee]
      : []

  return {
    company_id: input.companyId,
    title,
    description: emptyToNull(input.description),
    priority: emptyToNull(input.priority) || 'medium',
    estimated_cost: costOrOmit(input.estimatedCost),
    actual_cost: costOrOmit(input.actualCost),
    contractor_cost: costOrOmit(input.contractorCost),
    scheduled_start: input.scheduledStart || null,
    scheduled_end: input.scheduledEnd || null,
    client_id: input.clientId || null,
    site_id: input.siteId || null,
    unit_id: input.unitId || null,
    area_id: input.areaId || null,
    service_id: input.serviceId || null,
    contractor_id: input.contractorId || null,
    deal_id: input.dealId || null,
    address: emptyToNull(input.address),
    assignee_employee_id: assignee,
    assigned_employee_ids: assigned,
    created_by_employee_id: input.createdByEmployeeId || null,
    job_code: emptyToNull(input.jobCode),
    status: emptyToNull(input.status) || 'open',
  }
}
