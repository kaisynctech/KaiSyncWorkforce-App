import { describe, expect, it } from 'vitest'
import { buildTemplateAwareSessions } from './sessions-from-punches'

describe('buildTemplateAwareSessions', () => {
  const template = {
    id: 't1',
    start_time: '08:00:00',
    end_time: '17:00:00',
    break_minutes: 60,
  }

  it('flags late when clock-in exceeds late threshold', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T08:45:00' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T17:00:00' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      { shiftTemplate: template, lateThresholdMinutes: 30, otStartAfterMinutes: 30 }
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0].isLate).toBe(true)
    expect(sessions[0].isLeftEarly).toBe(false)
  })

  it('does not flag late within grace', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T08:20:00' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T17:00:00' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      { shiftTemplate: template, lateThresholdMinutes: 30 }
    )
    expect(sessions[0].isLate).toBe(false)
  })

  it('flags left early when clock-out before shift end', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T08:00:00' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T16:00:00' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      { shiftTemplate: template, lateThresholdMinutes: 30 }
    )
    expect(sessions[0].isLeftEarly).toBe(true)
  })

  it('never flags late/early without a template', () => {
    const sessions = buildTemplateAwareSessions(
      [
        { employee_id: 'e1', type: 'in', date_time: '2026-08-03T10:00:00' },
        { employee_id: 'e1', type: 'out', date_time: '2026-08-03T14:00:00' },
      ],
      'e1',
      '2026-08-01',
      '2026-08-31',
      { lateThresholdMinutes: 15 }
    )
    expect(sessions[0].isLate).toBe(false)
    expect(sessions[0].isLeftEarly).toBe(false)
  })
})
