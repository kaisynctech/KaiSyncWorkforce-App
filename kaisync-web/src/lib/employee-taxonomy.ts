/** Canonical employee classification values (aligned with payroll). */

export const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'part-time', label: 'Part-Time' },
  { value: 'student', label: 'Student' },
] as const

export const WORKER_TYPES = [
  { value: 'employee', label: 'Employee' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'subcontractor', label: 'Subcontractor' },
] as const

/** Employees module only — contractors/subcontractors belong in Contractors. */
export const EMPLOYEE_WORKER_TYPES = [
  { value: 'employee', label: 'Employee' },
] as const

/** Canonical web access levels written to employees.access_level */
export const ACCESS_LEVELS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr', label: 'HR' },
  { value: 'owner', label: 'Owner' },
] as const

/** Levels assignable when creating an employee (Owner requires ownership transfer). */
export const CREATE_ACCESS_LEVELS = ACCESS_LEVELS.filter(
  (l) => l.value !== 'owner'
) as ReadonlyArray<(typeof ACCESS_LEVELS)[number]>

export type EmploymentTypeValue = (typeof EMPLOYMENT_TYPES)[number]['value']
export type WorkerTypeValue = (typeof WORKER_TYPES)[number]['value']
export type AccessLevelValue = (typeof ACCESS_LEVELS)[number]['value']

/** Levels that may manage / report-to pickers (includes legacy hr_admin stored values). */
export const MANAGER_ACCESS_LEVELS = ['owner', 'manager', 'hr', 'hr_admin'] as const

/**
 * Normalize any stored/legacy access_level to canonical web values.
 * hr_admin / hradmin / admin → hr
 */
export function normalizeAccessLevel(raw: string | null | undefined): AccessLevelValue {
  const key = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (key === 'owner') return 'owner'
  if (key === 'manager') return 'manager'
  if (key === 'hr' || key === 'hr_admin' || key === 'hradmin' || key === 'admin') return 'hr'
  return 'employee'
}

export function labelAccessLevel(raw: string | null | undefined): string {
  const v = normalizeAccessLevel(raw)
  return ACCESS_LEVELS.find(l => l.value === v)?.label ?? (raw || '—')
}

/** True when the person uses the company/HR dashboard (not field employee portal). */
export function isCompanyDashboardAccess(raw: string | null | undefined): boolean {
  const v = normalizeAccessLevel(raw)
  return v === 'owner' || v === 'hr' || v === 'manager'
}

/** Normalize stored / imported employment_type to canonical lowercase values. */
export function normalizeEmploymentType(raw: string | null | undefined): string {
  if (!raw?.trim()) return 'permanent'
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (key === 'parttime' || key === 'part-time') return 'part-time'
  if (key === 'permanent' || key === 'contract' || key === 'student') return key
  // Legacy Title Case from older web creates
  if (raw === 'Permanent') return 'permanent'
  if (raw === 'Contract') return 'contract'
  if (raw === 'Part-Time' || raw === 'Part Time') return 'part-time'
  if (raw === 'Student') return 'student'
  return key
}

export function employmentTypesMatch(stored: string | null | undefined, filter: string): boolean {
  if (!filter) return true
  return normalizeEmploymentType(stored) === normalizeEmploymentType(filter)
}

export function normalizeWorkerType(raw: string | null | undefined): WorkerTypeValue {
  const key = (raw ?? '').trim().toLowerCase()
  if (key === 'contractor' || key === 'subcontractor') return key
  return 'employee'
}

export function labelEmploymentType(raw: string | null | undefined): string {
  const v = normalizeEmploymentType(raw)
  return EMPLOYMENT_TYPES.find(t => t.value === v)?.label ?? (raw || '—')
}

export function labelWorkerType(raw: string | null | undefined): string {
  const v = normalizeWorkerType(raw)
  return WORKER_TYPES.find(t => t.value === v)?.label ?? 'Employee'
}
