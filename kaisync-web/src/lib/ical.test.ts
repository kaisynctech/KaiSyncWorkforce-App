import { describe, expect, it } from 'vitest'
import { guestNameFromIcalSummary, parseIcalEvents, unfoldIcal } from '@/lib/ical'

describe('iCal parser', () => {
  it('unfolds continuation lines', () => {
    const lines = unfoldIcal('SUMMARY:Reserved - \r\n Jane Doe\n')
    expect(lines[0]).toBe('SUMMARY:Reserved - Jane Doe')
  })

  it('parses all-day events and skips cancelled ones', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:stay-1',
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261004',
      'SUMMARY:Reserved - Jane Doe',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:gone',
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261002',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:one-night',
      'DTSTART:20261010T140000Z',
      'SUMMARY:Not available',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')

    const events = parseIcalEvents(ics)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      uid: 'stay-1',
      startDate: '2026-10-01',
      endDate: '2026-10-04',
      summary: 'Reserved - Jane Doe',
    })
    expect(events[1]).toMatchObject({
      uid: 'one-night',
      startDate: '2026-10-10',
      endDate: '2026-10-11',
    })
  })

  it('maps blocked summaries to a placeholder guest', () => {
    expect(guestNameFromIcalSummary('Not available')).toEqual({ name: 'Blocked', surname: '(iCal)' })
    expect(guestNameFromIcalSummary('Reserved - Jane Doe')).toEqual({ name: 'Jane', surname: 'Doe' })
  })
})
