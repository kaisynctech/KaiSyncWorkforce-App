/**
 * Shared list pagination helpers for property module tables.
 */

export const PROPERTY_LIST_PAGE_SIZE = 50
export const UNIT_LIST_PAGE_SIZE = 50

export function paginateSlice<T>(items: T[], page: number, pageSize: number): T[] {
  const p = Math.max(1, page)
  const start = (p - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function totalPages(count: number, pageSize: number): number {
  if (count <= 0) return 1
  return Math.max(1, Math.ceil(count / pageSize))
}

export type ArrearsBucket = 'current' | '1_30' | '31_60' | '61_plus'

export function arrearsBucket(dueDate: string | null, today = new Date()): ArrearsBucket {
  if (!dueDate) return 'current'
  const due = new Date(dueDate + 'T00:00:00')
  const t = new Date(today)
  t.setHours(0, 0, 0, 0)
  const days = Math.floor((t.getTime() - due.getTime()) / 86_400_000)
  if (days <= 0) return 'current'
  if (days <= 30) return '1_30'
  if (days <= 60) return '31_60'
  return '61_plus'
}

export function arrearsBucketLabel(b: ArrearsBucket): string {
  switch (b) {
    case 'current': return 'Not yet due'
    case '1_30': return '1–30 days'
    case '31_60': return '31–60 days'
    case '61_plus': return '61+ days'
  }
}

export function daysPastDue(dueDate: string | null, today = new Date()): number {
  if (!dueDate) return 0
  const due = new Date(dueDate + 'T00:00:00')
  const t = new Date(today)
  t.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((t.getTime() - due.getTime()) / 86_400_000))
}
