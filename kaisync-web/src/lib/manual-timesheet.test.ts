import { describe, expect, it } from 'vitest'
import { manualTimesheetIsOvernight, manualTimesheetProblem } from '@/lib/manual-timesheet'

describe('manualTimesheetProblem', () => {
  const base = { employeeId: 'e', workDate: '2026-10-01', timeIn: '08:00', timeOut: '17:00' }

  it('accepts a same-day pair', () => {
    expect(manualTimesheetProblem(base)).toBeNull()
  })

  it('rejects a time out equal to the time in', () => {
    expect(manualTimesheetProblem({ ...base, timeOut: '08:00' })).toBe('Time out must be different from time in.')
  })

  it('accepts a night shift that ends the next morning', () => {
    expect(manualTimesheetProblem({ ...base, timeIn: '19:00', timeOut: '04:00' })).toBeNull()
    expect(manualTimesheetIsOvernight('19:00', '04:00')).toBe(true)
    expect(manualTimesheetIsOvernight('08:00', '17:00')).toBe(false)
    expect(manualTimesheetIsOvernight('9:30', '10:00')).toBe(false)
  })

  it('requires an employee and a date', () => {
    expect(manualTimesheetProblem({ ...base, employeeId: '' })).toBe('Choose an employee.')
    expect(manualTimesheetProblem({ ...base, workDate: '' })).toBe('Choose a date.')
  })
})
