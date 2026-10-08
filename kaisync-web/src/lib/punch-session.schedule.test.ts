import { describe, expect, it } from 'vitest'
import { buildPunchSessions, type ShiftTemplateLike } from '@/lib/punch-session'
import { templateSchedulePayload } from '@/lib/shift-template-schedule'

const weekdayTemplate: ShiftTemplateLike = {
  id: 't',
  start_time: '08:00:00',
  end_time: '17:00:00',
  break_minutes: 0,
  ot_start_time: '17:00:00',
  weekend_start_time: '08:00:00',
  weekend_end_time: '13:00:00',
  weekend_ot_start_time: '13:00:00',
}

function hours(template: ShiftTemplateLike, clockIn: string, clockOut: string, otAfter = 30) {
  const [row] = buildPunchSessions(
    [
      { type: 'in', date_time: clockIn },
      { type: 'out', date_time: clockOut },
    ],
    {
      employeeId: 'e',
      otStartAfterMinutes: otAfter,
      shiftTemplate: template,
      timeZone: 'Africa/Johannesburg',
    },
  )
  return row
}

describe('template overtime and weekend hours', () => {
  it('starts weekday overtime at the template clock', () => {
    const row = hours(weekdayTemplate, '2026-10-08T06:00:00.000Z', '2026-10-08T16:00:00.000Z')
    expect(row.overtimeHours).toBe(1)
    expect(row.regularHours).toBe(9)
  })

  it('keeps the company grace when the overtime clock is blank', () => {
    const template = { ...weekdayTemplate, ot_start_time: null }
    const insideGrace = hours(template, '2026-10-08T06:00:00.000Z', '2026-10-08T15:20:00.000Z')
    const pastGrace = hours(template, '2026-10-08T06:00:00.000Z', '2026-10-08T16:00:00.000Z')
    expect(insideGrace.overtimeHours).toBe(0)
    expect(pastGrace.overtimeHours).toBe(0.5)
  })

  it('uses Saturday and Sunday hours', () => {
    const row = hours(weekdayTemplate, '2026-10-10T06:00:00.000Z', '2026-10-10T12:00:00.000Z')
    expect(row.overtimeHours).toBe(1)
    expect(row.regularHours).toBe(5)
  })
})

describe('templateSchedulePayload', () => {
  it('requires both weekend times', () => {
    const result = templateSchedulePayload({
      weekendEnabled: true,
      weekendStart: '08:00',
      weekendEnd: '',
      otStart: '',
      weekendOtStart: '',
    })
    expect(result.ok).toBe(false)
  })
})
