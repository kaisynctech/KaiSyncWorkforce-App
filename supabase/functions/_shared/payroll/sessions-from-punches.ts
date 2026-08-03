/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/payroll/sessions-from-punches.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * Template-aware payroll sessions — reuses MAUI-parity punch-session metrics
 * so late/early/OT match attendance UI and KaiFlow PunchSession.Build.
 */

import {
  buildPunchSessions,
  toLocalDateStr,
  type ShiftTemplateLike,
} from './punch-session.ts'
import { DEFAULT_COMPANY_TIMEZONE, toZonedDateStr } from './timezone.ts'
import type { ISODate } from './period.ts'
import type { PunchLike, SessionSnapshot } from './calculator.ts'

export type SessionBuildOptions = {
  shiftTemplate?: ShiftTemplateLike | null
  lateThresholdMinutes?: number
  otStartAfterMinutes?: number
  dailyHours?: number
  /** IANA timezone from company_settings.timezone. */
  timeZone?: string
}

export function buildTemplateAwareSessions(
  punches: PunchLike[],
  employeeId: string,
  periodStart: ISODate,
  periodEnd: ISODate,
  options: SessionBuildOptions = {}
): SessionSnapshot[] {
  const dailyHours = options.dailyHours && options.dailyHours > 0 ? options.dailyHours : 8
  const timeZone = options.timeZone || DEFAULT_COMPANY_TIMEZONE
  const inPeriod = punches.filter(p => {
    if (p.employee_id !== employeeId || !p.date_time) return false
    const d = toZonedDateStr(new Date(p.date_time), timeZone)
    return d >= periodStart && d <= periodEnd
  })

  const rows = buildPunchSessions(inPeriod, {
    employeeId,
    dailyHours,
    lateThresholdMinutes: options.lateThresholdMinutes ?? 30,
    otStartAfterMinutes: options.otStartAfterMinutes ?? 30,
    shiftTemplate: options.shiftTemplate ?? null,
    timeZone,
  })

  // Closed sessions only for payroll (MAUI filters !IsOpen)
  return rows
    .filter(s => !s.isOpen && !s.isAbsentDay && !s.isLeaveDay)
    .map(s => ({
      date: toLocalDateStr(s.clockIn, timeZone) as ISODate,
      regularHours: s.regularHours,
      overtimeHours: s.overtimeHours,
      isLate: s.isLate,
      isLeftEarly: s.isLeftEarly,
      isOpen: false,
    }))
    .filter(s => s.date >= periodStart && s.date <= periodEnd)
}
