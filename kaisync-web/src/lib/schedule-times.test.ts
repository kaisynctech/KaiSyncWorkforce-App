import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => { process.env.TZ = 'Africa/Johannesburg' })

describe('scheduling times in South Africa', async () => {
  const { localDayOf, localDayRangeIso, localTimeOf, repeatDates, shiftTimesIso } = await import('./schedule-times')

  it('07:00–16:00 is stored as 05:00–14:00 UTC (it used to be stored as 07:00 UTC)', () => {
    process.env.TZ = 'Africa/Johannesburg'
    const t = shiftTimesIso('2026-10-23', '07:00', '16:00')
    expect(t.startIso).toBe('2026-10-23T05:00:00.000Z')
    expect(t.endIso).toBe('2026-10-23T14:00:00.000Z')
    expect(t.overnight).toBe(false)
    expect(localTimeOf(t.startIso, '')).toBe('07:00')
  })

  it('a night shift ends the next day', () => {
    process.env.TZ = 'Africa/Johannesburg'
    const t = shiftTimesIso('2026-10-23', '19:00', '04:00')
    expect(t.overnight).toBe(true)
    expect(t.startIso).toBe('2026-10-23T17:00:00.000Z')
    expect(t.endIso).toBe('2026-10-24T02:00:00.000Z')
  })

  it('a local day runs from 22:00 UTC the day before', () => {
    process.env.TZ = 'Africa/Johannesburg'
    expect(localDayRangeIso('2026-10-23')).toEqual({ fromIso: '2026-10-22T22:00:00.000Z', toIso: '2026-10-23T22:00:00.000Z' })
    expect(localDayOf('2026-10-22T23:30:00.000Z')).toBe('2026-10-23')
  })

  it('repeats on chosen weekdays until a date', () => {
    process.env.TZ = 'Africa/Johannesburg'
    // Mon 26 Oct to Sun 8 Nov, Mon–Sat
    const dates = repeatDates('2026-10-26', '2026-11-08', new Set([1, 2, 3, 4, 5, 6]))
    expect(dates).toHaveLength(12)
    expect(dates[0]).toBe('2026-10-26')
    expect(dates).not.toContain('2026-11-01')
    expect(repeatDates('2026-10-26', '', new Set([1]))).toEqual(['2026-10-26'])
  })

  it('job times: local date/time to ISO and back (were 2 h off)', async () => {
    process.env.TZ = 'Africa/Johannesburg'
    const { localDateTimeToIso, localDateTimeInputOf } = await import('./schedule-times')
    expect(localDateTimeToIso('2026-10-26', '08:00')).toBe('2026-10-26T06:00:00.000Z')
    expect(localDateTimeToIso('2026-10-26T08:00')).toBe('2026-10-26T06:00:00.000Z')
    expect(localDateTimeToIso('', '08:00')).toBeNull()
    expect(localDateTimeInputOf('2026-10-26T06:00:00+00:00')).toBe('2026-10-26T08:00')
    expect(localDateTimeInputOf(null)).toBe('')
  })
})
