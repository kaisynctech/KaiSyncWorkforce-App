/**
 * Server-side copy of `kaisync-web/src/lib/payroll/leave-days.ts`.
 * Ports KaiFlow.Payroll/LeaveDayCalculator.cs.
 */

import { addDaysISO, type ISODate } from './period.ts'

export function isUnpaidLeave(leaveType: string): boolean {
  return leaveType.trim().toLowerCase() === 'unpaid leave'
}

export function countDaysInPeriod(
  start: ISODate,
  end: ISODate,
  periodStart: ISODate,
  periodEnd: ISODate,
  halfDayStart: boolean,
  halfDayEnd: boolean,
  totalDaysHint: number
): number {
  const overlapStart = start < periodStart ? periodStart : start
  const overlapEnd = end > periodEnd ? periodEnd : end
  if (overlapEnd < overlapStart) return 0

  if (overlapStart === overlapEnd && overlapStart === start && overlapEnd === end && totalDaysHint > 0) {
    return totalDaysHint
  }

  let days = 0
  let d = overlapStart
  while (d <= overlapEnd) {
    if (d === start && d === end) {
      if (totalDaysHint > 0 && totalDaysHint < 1) days += totalDaysHint
      else if (halfDayStart || halfDayEnd) days += 0.5
      else days += 1
    } else if (d === start && halfDayStart) {
      days += 0.5
    } else if (d === end && halfDayEnd) {
      days += 0.5
    } else {
      days += 1
    }
    d = addDaysISO(d, 1)
  }

  return days
}
