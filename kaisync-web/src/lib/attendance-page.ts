/** Rows shown on the Overview attendance tables before the next page. */
export const ATTENDANCE_PAGE_SIZE = 50

export function attendancePageCount(total: number, pageSize = ATTENDANCE_PAGE_SIZE): number {
  if (total <= 0) return 1
  return Math.ceil(total / pageSize)
}

export function attendancePageItems<T>(
  items: readonly T[],
  page: number,
  pageSize = ATTENDANCE_PAGE_SIZE,
): T[] {
  const pages = attendancePageCount(items.length, pageSize)
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function attendanceRangeLabel(
  total: number,
  page: number,
  pageSize = ATTENDANCE_PAGE_SIZE,
): string {
  if (total <= 0) return '0 people'
  const pages = attendancePageCount(total, pageSize)
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * pageSize + 1
  const end = Math.min(total, current * pageSize)
  if (total <= pageSize) return total === 1 ? '1 person' : `${total} people`
  return `${start}–${end} of ${total}`
}
