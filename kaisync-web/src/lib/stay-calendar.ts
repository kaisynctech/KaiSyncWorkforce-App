/**
 * Month grid for guest-house rooms. Checkout morning is free (night < check_out_date).
 * A same-day stay occupies that one night.
 */

import type { PropertyStay, StayStatus } from '@/types/database'

export type CalendarNightKind = 'in_house' | 'reserved' | 'stayed'

const KIND_RANK: Record<CalendarNightKind, number> = {
  in_house: 3,
  reserved: 2,
  stayed: 1,
}

export function localIsoDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days)
  return localIsoDate(dt)
}

/** Every night in a calendar month. monthIndex is 0–11. */
export function monthNightDates(year: number, monthIndex: number): string[] {
  const count = new Date(year, monthIndex + 1, 0).getDate()
  const days: string[] = []
  for (let day = 1; day <= count; day += 1) {
    days.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  return days
}

export function calendarNightKind(status: StayStatus): CalendarNightKind | null {
  if (status === 'checked_in') return 'in_house'
  if (status === 'reserved') return 'reserved'
  if (status === 'checked_out') return 'stayed'
  return null
}

export function stayCoversNight(
  stay: Pick<PropertyStay, 'check_in_date' | 'check_out_date' | 'status'>,
  night: string,
): boolean {
  if (stay.status === 'cancelled' || stay.status === 'no_show') return false
  if (stay.check_in_date === stay.check_out_date) return night === stay.check_in_date
  return stay.check_in_date <= night && night < stay.check_out_date
}

/** Highest-priority stay covering this room-night, if any. */
export function nightAssignment(
  stays: PropertyStay[],
  unitId: string,
  night: string,
): PropertyStay | null {
  let best: PropertyStay | null = null
  let rank = 0
  for (const stay of stays) {
    if (stay.unit_id !== unitId) continue
    if (!stayCoversNight(stay, night)) continue
    const kind = calendarNightKind(stay.status)
    if (!kind) continue
    const next = KIND_RANK[kind]
    if (next > rank) {
      rank = next
      best = stay
    }
  }
  return best
}
