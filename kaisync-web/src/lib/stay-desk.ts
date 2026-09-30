/**
 * Front-desk day list from existing stays.
 * Checkout morning is a departure, not another night in house.
 * A same-day stay is an arrival while reserved and a departure once checked in.
 */

import type { PropertyStay, StayStatus } from '@/types/database'
import { stayCoversNight } from '@/lib/stay-calendar'

export type FrontDeskBucket = 'arrival' | 'in_house' | 'departure'

export type FrontDeskRow = {
  stay: PropertyStay
  bucket: FrontDeskBucket
  /** Reserved past the check-in date, or still checked in after the checkout date. */
  late: boolean
}

const ACTIVE: StayStatus[] = ['reserved', 'checked_in', 'checked_out']

export function frontDeskPlacement(
  stay: Pick<PropertyStay, 'status' | 'check_in_date' | 'check_out_date'>,
  day: string,
  today: string,
): { bucket: FrontDeskBucket; late: boolean } | null {
  if (!ACTIVE.includes(stay.status)) return null

  if (stay.status === 'reserved') {
    if (stay.check_in_date === day) return { bucket: 'arrival', late: false }
    if (day === today && stay.check_in_date < day && stay.check_out_date >= day) {
      return { bucket: 'arrival', late: true }
    }
    return null
  }

  const dueOut = stay.check_out_date === day
  const overdueOut = stay.status === 'checked_in' && day === today && stay.check_out_date < day
  if (stay.status === 'checked_out' && dueOut) return { bucket: 'departure', late: false }
  if (stay.status === 'checked_in' && (dueOut || overdueOut)) {
    return { bucket: 'departure', late: overdueOut }
  }

  if (stay.status === 'checked_in') {
    const staying = stay.check_in_date <= day && day < stay.check_out_date
    const earlyToday = day === today && stay.check_in_date > day
    if (staying || earlyToday) return { bucket: 'in_house', late: false }
    return null
  }

  if (stayCoversNight(stay, day) && stay.check_out_date !== day) {
    return { bucket: 'in_house', late: false }
  }
  return null
}

export function buildFrontDeskDay(
  stays: PropertyStay[],
  day: string,
  today: string,
  unitNumbers: Record<string, string> = {},
): { arrivals: FrontDeskRow[]; inHouse: FrontDeskRow[]; departures: FrontDeskRow[] } {
  const arrivals: FrontDeskRow[] = []
  const inHouse: FrontDeskRow[] = []
  const departures: FrontDeskRow[] = []

  for (const stay of stays) {
    const placed = frontDeskPlacement(stay, day, today)
    if (!placed) continue
    const row = { stay, bucket: placed.bucket, late: placed.late }
    if (placed.bucket === 'arrival') arrivals.push(row)
    else if (placed.bucket === 'in_house') inHouse.push(row)
    else departures.push(row)
  }

  const byRoom = (a: FrontDeskRow, b: FrontDeskRow) => {
    const room = (unitNumbers[a.stay.unit_id] ?? '').localeCompare(
      unitNumbers[b.stay.unit_id] ?? '',
      undefined,
      { numeric: true },
    )
    if (room !== 0) return room
    return `${a.stay.guest_surname} ${a.stay.guest_name}`.localeCompare(
      `${b.stay.guest_surname} ${b.stay.guest_name}`,
    )
  }
  arrivals.sort(byRoom)
  inHouse.sort(byRoom)
  departures.sort(byRoom)
  return { arrivals, inHouse, departures }
}
