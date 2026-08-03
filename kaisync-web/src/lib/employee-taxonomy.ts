/** Canonical employee classification values (aligned with MAUI / payroll). */

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

export const ACCESS_LEVELS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr', label: 'HR' },
  { value: 'owner', label: 'Owner' },
] as const

export type EmploymentTypeValue = (typeof EMPLOYMENT_TYPES)[number]['value']
export type WorkerTypeValue = (typeof WORKER_TYPES)[number]['value']

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
