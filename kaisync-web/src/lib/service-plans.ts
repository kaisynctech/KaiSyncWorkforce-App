/**
 * Service plans: regular visits to a client's site or area (every N months), rotating through services
 * (Minor, Minor, Major). Jobs are created by generate_due_plan_jobs, daily or with "Create due jobs".
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result } from '@/lib/job-services'

export type ServicePlan = {
  id: string
  client_id: string
  site_id: string
  area_id: string | null
  name: string
  service_ids: string[]
  interval_months: number
  first_due: string
  visits_created: number
  next_due: string
  lead_days: number
  start_time: string
  employee_ids: string[]
  include_equipment: boolean
  notes: string | null
  is_active: boolean
  last_generated_at: string | null
}

export const PLAN_COLUMNS =
  'id, client_id, site_id, area_id, name, service_ids, interval_months, first_due, visits_created, next_due, lead_days, ' +
  'start_time, employee_ids, include_equipment, notes, is_active, last_generated_at'

function friendly(message: string): string {
  if (/SITE_NOT_FOR_CLIENT/.test(message)) return 'That site belongs to a different client.'
  if (/AREA_NOT_IN_SITE/.test(message)) return 'That area is at a different site.'
  if (/SERVICE_NOT_IN_COMPANY/.test(message)) return 'One of the services no longer exists.'
  if (/UNAUTHORIZED|row-level security|permission denied/i.test(message)) return 'You do not have permission to do this.'
  return message
}

/** Whole months between two ISO dates, rounded down (date-only, no time zones). */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0)
}

/** first + n months as YYYY-MM-DD, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = (m - 1) + months
  const ny = y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/**
 * How many visits of a plan starting on `firstDue` lie before `today`. A new plan whose first date is in the
 * past starts at its next future visit unless the past visits are wanted as jobs too.
 */
export function pastVisits(firstDue: string, intervalMonths: number, today: string): number {
  if (firstDue >= today) return 0
  let n = Math.max(0, Math.floor(monthsBetween(firstDue, today) / intervalMonths))
  while (addMonths(firstDue, n * intervalMonths) < today) n++
  while (n > 0 && addMonths(firstDue, (n - 1) * intervalMonths) >= today) n--
  return n
}

/** The service of the n-th visit (0-based) in the rotation. */
export function serviceForVisit(serviceIds: string[], visit: number): string | null {
  return serviceIds.length ? serviceIds[visit % serviceIds.length] : null
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
}

export async function listPlans(supabase: SupabaseClient, companyId: string): Promise<Result<ServicePlan[]>> {
  const { data, error } = await supabase.from('service_plans').select(PLAN_COLUMNS)
    .eq('company_id', companyId).order('next_due').limit(5000)
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []) as unknown as ServicePlan[] }
}

export type PlanInput = {
  clientId: string
  siteId: string
  areaId: string | null
  name: string
  serviceIds: string[]
  intervalMonths: number
  firstDue: string
  visitsCreated?: number
  leadDays: number
  startTime: string
  employeeIds: string[]
  includeEquipment: boolean
  notes: string
}

export async function savePlan(
  supabase: SupabaseClient, companyId: string, input: PlanInput, id?: string,
): Promise<Result<ServicePlan>> {
  if (!input.name.trim()) return { ok: false, message: 'Give the plan a name, e.g. Aircon maintenance.' }
  if (!input.clientId || !input.siteId) return { ok: false, message: 'Choose the client and site.' }
  if (input.serviceIds.length === 0) return { ok: false, message: 'Add at least one service.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.firstDue)) return { ok: false, message: 'Choose the first visit date.' }
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    site_id: input.siteId,
    area_id: input.areaId || null,
    name: input.name.trim(),
    service_ids: input.serviceIds,
    interval_months: input.intervalMonths,
    first_due: input.firstDue,
    lead_days: input.leadDays,
    start_time: input.startTime || '08:00',
    employee_ids: input.employeeIds,
    include_equipment: input.includeEquipment,
    notes: input.notes.trim() || null,
    next_due: input.firstDue, // recalculated by the database
  }
  if (input.visitsCreated !== undefined) row.visits_created = input.visitsCreated
  const q = id
    ? supabase.from('service_plans').update(row).eq('id', id).eq('company_id', companyId)
    : supabase.from('service_plans').insert({ company_id: companyId, ...row })
  const { data, error } = await q.select(PLAN_COLUMNS).single()
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: data as unknown as ServicePlan }
}

export async function setPlanActive(supabase: SupabaseClient, companyId: string, id: string, active: boolean): Promise<Result<void>> {
  const { error } = await supabase.from('service_plans').update({ is_active: active }).eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export async function removePlan(supabase: SupabaseClient, companyId: string, id: string): Promise<Result<void>> {
  const { error } = await supabase.from('service_plans').delete().eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

/** Creates the jobs that are due now (all plans, or one). Returns how many jobs were made. */
export async function createDueJobs(supabase: SupabaseClient, companyId: string, planId?: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('generate_due_plan_jobs', { p_company_id: companyId, p_plan_id: planId ?? null })
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: Number(data ?? 0) }
}

// ── Report: Done / Incomplete / Upcoming ─────────────────────────────────────

export type VisitOutcome = 'done' | 'incomplete' | 'overdue' | 'upcoming' | 'cancelled'

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  done: 'Done',
  incomplete: 'Incomplete',
  overdue: 'Not done yet (overdue)',
  upcoming: 'Coming up',
  cancelled: 'Cancelled',
}

export type PlanVisit = {
  id: string
  job_code: string | null
  title: string
  status: string
  scheduled_start: string | null
  plan_due_date: string
  service_plan_id: string
  service: { name: string } | null
  units: { status: string }[]
}

/**
 * Done: job completed and every unit on it done. Incomplete: completed but some units not done.
 * Overdue: due date passed and the job is not completed. Upcoming: due today or later, not completed.
 */
export function visitOutcome(v: Pick<PlanVisit, 'status' | 'plan_due_date' | 'units'>, today: string): VisitOutcome {
  if (v.status === 'cancelled') return 'cancelled'
  if (v.status === 'completed') return v.units.some(u => u.status !== 'done') ? 'incomplete' : 'done'
  return v.plan_due_date < today ? 'overdue' : 'upcoming'
}

export async function listPlanVisits(
  supabase: SupabaseClient, companyId: string, from: string, to: string,
): Promise<Result<PlanVisit[]>> {
  const { data, error } = await supabase.from('jobs')
    .select('id, job_code, title, status, scheduled_start, plan_due_date, service_plan_id, service:service_id(name), units:job_assets(status)')
    .eq('company_id', companyId).not('service_plan_id', 'is', null)
    .gte('plan_due_date', from).lte('plan_due_date', to)
    .order('plan_due_date').limit(5000)
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []) as unknown as PlanVisit[] }
}
