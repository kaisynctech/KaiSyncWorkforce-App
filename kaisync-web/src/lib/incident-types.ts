/** Mirrors MAUI IncidentReport / IncidentCategories / IncidentStatuses. */

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

export const INCIDENT_CATEGORIES = [
  'general',
  'safety',
  'injury',
  'equipment',
  'property',
  'environmental',
] as const
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]

export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export const MANAGE_ACCESS_LEVELS = ['owner', 'admin', 'hr_admin', 'hr', 'manager'] as const

export const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-surface-elevated text-text-secondary border border-divider',
  medium: 'bg-warning/10 text-warning',
  high: 'bg-error/10 text-error',
  critical: 'bg-error text-white',
}

export const STATUS_STYLES: Record<string, string> = {
  open: 'bg-primary/10 text-primary',
  investigating: 'bg-warning/10 text-warning',
  resolved: 'bg-success/10 text-success',
  closed: 'bg-surface-elevated text-text-secondary',
}

/** MAUI IsOpen — open or investigating. */
export function isIncidentOpen(status: string | null | undefined, isClosed?: boolean | null): boolean {
  if (isClosed === true) return false
  const s = (status ?? '').toLowerCase()
  return s === 'open' || s === 'investigating'
}

export function formatIncidentLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

export function canManageIncident(
  accessLevel: string | null | undefined,
  assigneeId: string | null | undefined,
  employeeId: string | null | undefined,
): boolean {
  const level = (accessLevel ?? '').toLowerCase()
  if ((MANAGE_ACCESS_LEVELS as readonly string[]).includes(level)) return true
  return !!assigneeId && !!employeeId && assigneeId === employeeId
}

/** employee_get_incident returns json (object), not a set. */
export function parseIncidentRpcJson<T>(data: unknown): T | null {
  if (data == null) return null
  if (Array.isArray(data)) return (data[0] as T) ?? null
  if (typeof data === 'object') return data as T
  if (typeof data === 'string') {
    try {
      return parseIncidentRpcJson<T>(JSON.parse(data))
    } catch {
      return null
    }
  }
  return null
}

export function displayIncidentTitle(
  title: string | null | undefined,
  description: string | null | undefined,
): string {
  if (title?.trim()) return title.trim()
  const d = (description ?? '').trim()
  if (!d) return 'Incident'
  return d.length > 80 ? `${d.slice(0, 80)}…` : d
}
