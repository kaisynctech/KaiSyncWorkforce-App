/** Shared list pagination helpers for Supply & Assets (W5). */

export const DEFAULT_PAGE_SIZE = 25
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const

export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const p = Math.max(1, page)
  const size = Math.max(1, pageSize)
  const from = (p - 1) * size
  return { from, to: from + size - 1 }
}

export function totalPages(total: number, pageSize: number): number {
  if (total <= 0) return 1
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

export function escapeIlike(value: string): string {
  return value.replace(/[%_,]/g, c => `\\${c}`)
}
