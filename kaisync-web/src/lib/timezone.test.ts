import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPANY_TIMEZONE,
  toZonedDateStr,
  zonedTimeOnPunchDay,
  zonedWallTimeToUtc,
} from '@/lib/timezone'

describe('timezone helpers (Africa/Johannesburg = UTC+2, no DST)', () => {
  it('formats UTC midnight as previous calendar evening in ZA is still previous day', () => {
    // 2026-08-03 00:00 UTC = 02:00 ZA → still 2026-08-03
    expect(toZonedDateStr(new Date('2026-08-03T00:00:00.000Z'), DEFAULT_COMPANY_TIMEZONE)).toBe(
      '2026-08-03'
    )
  })

  it('maps wall 08:00 ZA to 06:00 UTC', () => {
    const utc = zonedWallTimeToUtc(2026, 8, 3, 8, 0, DEFAULT_COMPANY_TIMEZONE)
    expect(utc.toISOString()).toBe('2026-08-03T06:00:00.000Z')
  })

  it('builds shift start on punch day in company TZ', () => {
    // Punch at 06:45 UTC = 08:45 ZA on 3 Aug
    const punch = new Date('2026-08-03T06:45:00.000Z')
    const shiftStart = zonedTimeOnPunchDay(punch, 8, 0, DEFAULT_COMPANY_TIMEZONE)
    expect(shiftStart.toISOString()).toBe('2026-08-03T06:00:00.000Z')
    const minsLate = (punch.getTime() - shiftStart.getTime()) / 60000
    expect(minsLate).toBe(45)
  })
})
