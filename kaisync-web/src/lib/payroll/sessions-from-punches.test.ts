import { describe, expect, it } from 'vitest'
import { buildTemplateAwareSessions } from './sessions-from-punches'

describe('buildTemplateAwareSessions', () => {
  const template = {
    id: 't1',
    start_time: '08:00:00',
    end_time: '17:00:00',
    break_minutes: 60,
  }
  // Africa/Johannesburg = UTC+2 (no DST). Wall 08:45 ZA → 06:45 UTC.
  const opts = {
    shiftTemplate: template,
    lateThresholdMinutes: 30,
    otStartAfterMinutes: 30,
    timeZone: 'Africa/Johannesburg',
  }

  it('flags late when clock-in exceeds late threshold', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T06:45:00.000Z' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T15:00:00.000Z' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      opts
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0].isLate).toBe(true)
    expect(sessions[0].isLeftEarly).toBe(false)
    expect(sessions[0].date).toBe('2026-08-03')
  })

  it('does not flag late within grace', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T06:20:00.000Z' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T15:00:00.000Z' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      opts
    )
    expect(sessions[0].isLate).toBe(false)
  })

  it('flags left early when clock-out before shift end', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T06:00:00.000Z' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T14:00:00.000Z' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      opts
    )
    expect(sessions[0].isLeftEarly).toBe(true)
  })

  it('never flags late/early without a template', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T10:00:00.000Z' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T14:00:00.000Z' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      { lateThresholdMinutes: 15, timeZone: 'Africa/Johannesburg' }
    )
    expect(sessions[0].isLate).toBe(false)
    expect(sessions[0].isLeftEarly).toBe(false)
  })

  it('uses company TZ (not UTC wall clock) for late detection on Edge-like UTC host', () => {
    // 07:00 UTC looks "on time" if compared with setHours(8) in UTC, but is 09:00 ZA → late.
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T07:00:00.000Z' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T15:00:00.000Z' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      opts
    )
    expect(sessions[0].isLate).toBe(true)
  })
})
