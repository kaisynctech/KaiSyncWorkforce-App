import { describe, expect, it } from 'vitest'
import { buildFrontDeskDay } from '@/lib/stay-desk'
import type { PropertyStay } from '@/types/database'

const TODAY = '2026-10-03'

function stay(
  partial: Partial<PropertyStay> & Pick<PropertyStay, 'id' | 'unit_id' | 'status' | 'check_in_date' | 'check_out_date'>,
): PropertyStay {
  return {
    company_id: 'c',
    site_id: 's',
    guest_name: 'Ada',
    guest_surname: 'Lovelace',
    guest_phone: null,
    guest_email: null,
    id_number: null,
    passport_number: null,
    check_in_at: null,
    check_out_at: null,
    adults: 1,
    children: 0,
    nightly_rate: null,
    total_amount: null,
    deposit_amount: null,
    deposit_status: 'none',
    currency: 'ZAR',
    notes: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

const rooms = { r1: '1', r2: '2', r10: '10' }

describe('buildFrontDeskDay', () => {
  it('splits today into arrivals, in-house guests, and departures', () => {
    const desk = buildFrontDeskDay([
      stay({ id: 'a', unit_id: 'r2', status: 'reserved', check_in_date: TODAY, check_out_date: '2026-10-05', guest_surname: 'Due' }),
      stay({ id: 'b', unit_id: 'r1', status: 'checked_in', check_in_date: '2026-10-01', check_out_date: '2026-10-06', guest_surname: 'Staying' }),
      stay({ id: 'c', unit_id: 'r10', status: 'checked_in', check_in_date: '2026-10-01', check_out_date: TODAY, guest_surname: 'Leaving' }),
      stay({ id: 'd', unit_id: 'r1', status: 'cancelled', check_in_date: TODAY, check_out_date: '2026-10-04' }),
      stay({ id: 'e', unit_id: 'r2', status: 'no_show', check_in_date: TODAY, check_out_date: '2026-10-04' }),
      stay({ id: 'f', unit_id: 'r10', status: 'reserved', check_in_date: '2026-10-08', check_out_date: '2026-10-10' }),
    ], TODAY, TODAY, rooms)

    expect(desk.arrivals.map(row => row.stay.id)).toEqual(['a'])
    expect(desk.inHouse.map(row => row.stay.id)).toEqual(['b'])
    expect(desk.departures.map(row => row.stay.id)).toEqual(['c'])
    expect(desk.arrivals[0].late).toBe(false)
  })

  it('keeps a guest who already checked in today on the in-house list', () => {
    const desk = buildFrontDeskDay([
      stay({ id: 'in', unit_id: 'r1', status: 'checked_in', check_in_date: TODAY, check_out_date: '2026-10-05' }),
    ], TODAY, TODAY)
    expect(desk.arrivals).toHaveLength(0)
    expect(desk.inHouse.map(row => row.stay.id)).toEqual(['in'])
  })

  it('flags a reserved guest who has not arrived and a guest still in after checkout', () => {
    const desk = buildFrontDeskDay([
      stay({ id: 'late-in', unit_id: 'r1', status: 'reserved', check_in_date: '2026-10-01', check_out_date: '2026-10-05' }),
      stay({ id: 'late-out', unit_id: 'r2', status: 'checked_in', check_in_date: '2026-09-28', check_out_date: '2026-10-02' }),
      stay({ id: 'old', unit_id: 'r10', status: 'reserved', check_in_date: '2026-09-01', check_out_date: '2026-09-02' }),
    ], TODAY, TODAY)

    expect(desk.arrivals.map(row => row.stay.id)).toEqual(['late-in'])
    expect(desk.arrivals[0].late).toBe(true)
    expect(desk.departures.map(row => row.stay.id)).toEqual(['late-out'])
    expect(desk.departures[0].late).toBe(true)
    expect(desk.inHouse).toHaveLength(0)
  })

  it('treats a same-day stay as an arrival until check-in, then as a departure', () => {
    const reserved = buildFrontDeskDay([
      stay({ id: 's', unit_id: 'r1', status: 'reserved', check_in_date: TODAY, check_out_date: TODAY }),
    ], TODAY, TODAY)
    expect(reserved.arrivals.map(row => row.stay.id)).toEqual(['s'])

    const arrived = buildFrontDeskDay([
      stay({ id: 's', unit_id: 'r1', status: 'checked_in', check_in_date: TODAY, check_out_date: TODAY }),
    ], TODAY, TODAY)
    expect(arrived.departures.map(row => row.stay.id)).toEqual(['s'])
    expect(arrived.inHouse).toHaveLength(0)
  })

  it('shows who left and who stayed on a past day', () => {
    const day = '2026-10-02'
    const desk = buildFrontDeskDay([
      stay({ id: 'left', unit_id: 'r2', status: 'checked_out', check_in_date: '2026-10-01', check_out_date: day }),
      stay({ id: 'was', unit_id: 'r1', status: 'checked_out', check_in_date: '2026-10-01', check_out_date: '2026-10-05' }),
    ], day, TODAY, rooms)
    expect(desk.departures.map(row => row.stay.id)).toEqual(['left'])
    expect(desk.inHouse.map(row => row.stay.id)).toEqual(['was'])
  })
})
