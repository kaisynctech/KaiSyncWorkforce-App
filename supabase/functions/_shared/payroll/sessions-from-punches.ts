/**
 * Template-aware payroll sessions — reuses MAUI-parity punch-session metrics
 * so late/early/OT match attendance UI and KaiFlow PunchSession.Build.
 */

import {
  buildPunchSessions,
  toLocalDateStr,
  type ShiftTemplateLike,
} from './punch-session.ts'
import type { ISODate } from './period.ts'
import type { PunchLike, SessionSnapshot } from './calculator.ts'

export type SessionBuildOptions = {
  shiftTemplate?: ShiftTemplateLike | null
  lateThresholdMinutes?: number
  otStartAfterMinutes?: number
  dailyHours?: number
}

export function buildTemplateAwareSessions(
  punches: PunchLike[],
  employeeId: string,
  periodStart: ISODate,
  periodEnd: ISODate,
  options: SessionBuildOptions = {}
): SessionSnapshot[] {
  const dailyHours = options.dailyHours && options.dailyHours > 0 ? options.dailyHours : 8
  const inPeriod = punches.filter(p => {
    if (p.employee_id !== employeeId || !p.date_time) return false
    const d = p.date_time.slice(0, 10)
    return d >= periodStart && d <= periodEnd
  })

  const rows = buildPunchSessions(inPeriod, {
    employeeId,
    dailyHours,
    lateThresholdMinutes: options.lateThresholdMinutes ?? 30,
    otStartAfterMinutes: options.otStartAfterMinutes ?? 30,
    shiftTemplate: options.shiftTemplate ?? null,
  })

  return rows
    .filter(s => !s.isOpen && !s.isAbsentDay && !s.isLeaveDay)
    .map(s => ({
      date: toLocalDateStr(s.clockIn) as ISODate,
      regularHours: s.regularHours,
      overtimeHours: s.overtimeHours,
      isLate: s.isLate,
      isLeftEarly: s.isLeftEarly,
      isOpen: false,
    }))
    .filter(s => s.date >= periodStart && s.date <= periodEnd)
}
