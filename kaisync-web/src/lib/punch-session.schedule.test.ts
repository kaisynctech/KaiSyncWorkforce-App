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

  it('uses Saturday hours without applying them to Sunday', () => {
    const saturday = hours(weekdayTemplate, '2026-10-10T06:00:00.000Z', '2026-10-10T12:00:00.000Z')
    const sunday = hours(weekdayTemplate, '2026-10-11T06:00:00.000Z', '2026-10-11T12:00:00.000Z')
    expect(saturday.overtimeHours).toBe(1)
    expect(saturday.regularHours).toBe(5)
    expect(sunday.overtimeHours).toBe(0)
    expect(sunday.regularHours).toBe(6)
  })

  it('uses Sunday hours only on Sunday', () => {
    const template = {
      ...weekdayTemplate,
      sunday_start_time: '09:00:00',
      sunday_end_time: '12:00:00',
      sunday_ot_start_time: '12:00:00',
    }
    const row = hours(template, '2026-10-11T07:00:00.000Z', '2026-10-11T11:00:00.000Z')
    expect(row.overtimeHours).toBe(1)
    expect(row.regularHours).toBe(3)
  })

  it('pays early overtime from the early clock until the shift start', () => {
    const template: ShiftTemplateLike = {
      ...weekdayTemplate,
      start_time: '07:00:00',
      end_time: '16:00:00',
      ot_start_time: '16:00:00',
      early_ot_start_time: '06:00:00',
    }
    const onTheLine = hours(template, '2026-10-08T04:00:00.000Z', '2026-10-08T14:00:00.000Z')
    const afterTheLine = hours(template, '2026-10-08T04:30:00.000Z', '2026-10-08T14:00:00.000Z')
    const beforeTheLine = hours(template, '2026-10-08T03:00:00.000Z', '2026-10-08T14:00:00.000Z')
    expect(onTheLine.overtimeHours).toBe(1)
    expect(onTheLine.regularHours).toBe(9)
    expect(afterTheLine.overtimeHours).toBe(0.5)
    expect(beforeTheLine.overtimeHours).toBe(1)
    expect(beforeTheLine.regularHours).toBe(9)
  })

  it('pays weekend early overtime against the weekend start', () => {
    const template = { ...weekdayTemplate, weekend_early_ot_start_time: '07:00:00' }
    const row = hours(template, '2026-10-10T05:00:00.000Z', '2026-10-10T12:00:00.000Z')
    expect(row.overtimeHours).toBe(2)
    expect(row.regularHours).toBe(5)
  })
})

describe('templateSchedulePayload', () => {
  it('requires both Saturday times', () => {
    const result = templateSchedulePayload({
      startTime: '08:00',
      otStart: '',
      earlyOtStart: '',
      saturday: { enabled: true, start: '08:00', end: '', otStart: '', earlyOtStart: '' },
      sunday: { enabled: false, start: '', end: '', otStart: '', earlyOtStart: '' },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an early overtime clock that is not before the start', () => {
    const result = templateSchedulePayload({
      startTime: '07:00',
      otStart: '',
      earlyOtStart: '07:00',
      saturday: { enabled: false, start: '', end: '', otStart: '', earlyOtStart: '' },
      sunday: { enabled: false, start: '', end: '', otStart: '', earlyOtStart: '' },
    })
    expect(result.ok).toBe(false)
  })
})
