import type { EnabledModules } from '@/lib/company-modules'
import type { DispatchSettings } from '@/lib/branch-geofence'

/** Payload from public.employee_get_overview_bundle */
export type EmployeeOverviewBundle = {
  company: {
    id: string
    name: string
    enabled_modules: EnabledModules
    dispatch_settings: DispatchSettings
  } | null
  employee: {
    id: string
    company_id: string
    name: string
    surname: string
    branch_id: string | null
    branch: string | null
    enforce_branch_geofence?: boolean

    registration_status: string
    is_active: boolean
    access_level: string
  } | null
  branches: Array<{
    id: string
    name: string
    latitude: number | null
    longitude: number | null
    is_active: boolean | null
  }>
  last_punch: Record<string, unknown> | null
  jobs: unknown[]
  leave_requests: unknown[]
  is_on_leave: boolean
  colleagues_on_leave: unknown[]
  incidents: unknown[]
  punches_today: unknown[]
  punches_week: unknown[]
  pa_tasks: unknown[]
  absences_today: unknown[]
  notifications: unknown
  work_teams: unknown[]
}

export function parseOverviewBundle(data: unknown): EmployeeOverviewBundle | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  return {
    company: (raw.company as EmployeeOverviewBundle['company']) ?? null,
    employee: (raw.employee as EmployeeOverviewBundle['employee']) ?? null,
    branches: Array.isArray(raw.branches) ? raw.branches as EmployeeOverviewBundle['branches'] : [],
    last_punch: (raw.last_punch as Record<string, unknown> | null) ?? null,
    jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
    leave_requests: Array.isArray(raw.leave_requests) ? raw.leave_requests : [],
    is_on_leave: raw.is_on_leave === true,
    colleagues_on_leave: Array.isArray(raw.colleagues_on_leave) ? raw.colleagues_on_leave : [],
    incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
    punches_today: Array.isArray(raw.punches_today) ? raw.punches_today : [],
    punches_week: Array.isArray(raw.punches_week) ? raw.punches_week : [],
    pa_tasks: Array.isArray(raw.pa_tasks) ? raw.pa_tasks : [],
    absences_today: Array.isArray(raw.absences_today) ? raw.absences_today : [],
    notifications: raw.notifications ?? [],
    work_teams: Array.isArray(raw.work_teams) ? raw.work_teams : [],
  }
}
