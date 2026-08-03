/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/timezone.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * Company-timezone helpers for payroll/attendance.
 * Default KaiSync TZ is Africa/Johannesburg (company_settings.timezone).
 */

export const DEFAULT_COMPANY_TIMEZONE = 'Africa/Johannesburg'

/** Calendar date YYYY-MM-DD in the given IANA timezone. */
export function toZonedDateStr(instant: Date, timeZone: string = DEFAULT_COMPANY_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(p => p.type === type)?.value ?? '0')

  let hour = get('hour')
  if (hour === 24) hour = 0

  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asUtc - date.getTime()
}

/**
 * Convert a wall-clock date/time in `timeZone` to a UTC Date.
 * Two-pass adjustment handles DST transitions.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = DEFAULT_COMPANY_TIMEZONE
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  let offset = tzOffsetMs(new Date(utc), timeZone)
  utc = Date.UTC(year, month - 1, day, hour, minute, 0) - offset
  offset = tzOffsetMs(new Date(utc), timeZone)
  utc = Date.UTC(year, month - 1, day, hour, minute, 0) - offset
  return new Date(utc)
}

/** Shift start/end on the punch's calendar day in company TZ. */
export function zonedTimeOnPunchDay(
  punchInstant: Date,
  hour: number,
  minute: number,
  timeZone: string = DEFAULT_COMPANY_TIMEZONE
): Date {
  const dateStr = toZonedDateStr(punchInstant, timeZone)
  const [y, m, d] = dateStr.split('-').map(Number)
  return zonedWallTimeToUtc(y, m, d, hour, minute, timeZone)
}
