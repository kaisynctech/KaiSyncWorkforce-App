/**
 * Scheduling times in the user's local time (South Africa for KaiSync companies).
 * Before 23 Oct 2026 the scheduling page sent "2026-10-23T07:00:00" with no time zone, so the
 * database stored 07:00 UTC and every shift showed two hours late (09:00 in South Africa).
 */
import { localISODate } from '@/lib/utils'

/** Start and end of a local calendar day (or days), as ISO instants for a timestamptz query. */
export function localDayRangeIso(firstDay: string, lastDay: string = firstDay): { fromIso: string; toIso: string } {
  const from = new Date(`${firstDay}T00:00:00`)
  const to = new Date(`${lastDay}T00:00:00`)
  to.setDate(to.getDate() + 1)
  return { fromIso: from.toISOString(), toIso: to.toISOString() }
}

/** Local date + "HH:MM" start/end to ISO instants. An end at or before the start is the next day. */
export function shiftTimesIso(day: string, start: string, end: string): { startIso: string; endIso: string; overnight: boolean } {
  const s = new Date(`${day}T${start}:00`)
  const e = new Date(`${day}T${end}:00`)
  const overnight = e.getTime() <= s.getTime()
  if (overnight) e.setDate(e.getDate() + 1)
  return { startIso: s.toISOString(), endIso: e.toISOString(), overnight }
}

/** Local calendar day of an ISO instant. */
export function localDayOf(iso: string): string {
  return localISODate(new Date(iso))
}

/** Local "HH:MM" of an ISO instant. */
export function localTimeOf(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Days 0 (Sunday) … 6 (Saturday). */
export const WEEKDAYS = [
  { day: 1, short: 'Mon' }, { day: 2, short: 'Tue' }, { day: 3, short: 'Wed' }, { day: 4, short: 'Thu' },
  { day: 5, short: 'Fri' }, { day: 6, short: 'Sat' }, { day: 0, short: 'Sun' },
] as const

export const MAX_REPEAT_DAYS = 93

/**
 * Every date from `first` to `until` (inclusive) on the chosen weekdays.
 * With no repeat (`until` empty or before `first`) it is just `first`.
 */
export function repeatDates(first: string, until: string | null | undefined, weekdays: ReadonlySet<number>): string[] {
  if (!until || until <= first) return [first]
  const out: string[] = []
  const d = new Date(`${first}T12:00:00`)
  for (let i = 0; i <= MAX_REPEAT_DAYS; i++) {
    const iso = localISODate(d)
    if (iso > until) break
    if (weekdays.size === 0 || weekdays.has(d.getDay())) out.push(iso)
    d.setDate(d.getDate() + 1)
  }
  return out
}
