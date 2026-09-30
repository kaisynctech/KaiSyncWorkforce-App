import { describe, expect, it } from 'vitest'
import {
  addIsoDays,
  calendarNightKind,
  monthNightDates,
  nightAssignment,
  stayCoversNight,
} from '@/lib/stay-calendar'
import type { PropertyStay } from '@/types/database'

function stay(partial: Partial<PropertyStay> & Pick<PropertyStay, 'id' | 'unit_id' | 'status' | 'check_in_date' | 'check_out_date'>): PropertyStay {
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

describe('stay calendar nights', () => {
  it('lists every night in the month', () => {
    const days = monthNightDates(2026, 9)
    expect(days).toHaveLength(31)
    expect(days[0]).toBe('2026-10-01')
    expect(days[30]).toBe('2026-10-31')
  })

  it('frees the checkout morning and keeps a same-day stay', () => {
    const ranged = stay({
      id: '1',
      unit_id: 'u',
      status: 'reserved',
      check_in_date: '2026-10-01',
      check_out_date: '2026-10-04',
    })
    expect(stayCoversNight(ranged, '2026-10-01')).toBe(true)
    expect(stayCoversNight(ranged, '2026-10-03')).toBe(true)
    expect(stayCoversNight(ranged, '2026-10-04')).toBe(false)

    const sameDay = stay({
      id: '2',
      unit_id: 'u',
      status: 'checked_in',
      check_in_date: '2026-10-05',
      check_out_date: '2026-10-05',
    })
    expect(stayCoversNight(sameDay, '2026-10-05')).toBe(true)
  })

  it('ignores cancelled stays and prefers an in-house guest over a past one', () => {
    const past = stay({
      id: 'past',
      unit_id: 'u',
      status: 'checked_out',
      check_in_date: '2026-10-01',
      check_out_date: '2026-10-03',
      guest_name: 'Old',
    })
    const live = stay({
      id: 'live',
      unit_id: 'u',
      status: 'checked_in',
      check_in_date: '2026-10-01',
      check_out_date: '2026-10-03',
      guest_name: 'Now',
    })
    const gone = stay({
      id: 'gone',
      unit_id: 'u',
      status: 'cancelled',
      check_in_date: '2026-10-01',
      check_out_date: '2026-10-03',
    })
    expect(stayCoversNight(gone, '2026-10-01')).toBe(false)
    expect(nightAssignment([past, live, gone], 'u', '2026-10-02')?.id).toBe('live')
    expect(calendarNightKind('reserved')).toBe('reserved')
    expect(addIsoDays('2026-10-31', 1)).toBe('2026-11-01')
  })
})
