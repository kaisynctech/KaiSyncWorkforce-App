import { describe, expect, it } from 'vitest'
import { manualTimesheetProblem } from '@/lib/manual-timesheet'

describe('manualTimesheetProblem', () => {
  const base = { employeeId: 'e', workDate: '2026-10-01', timeIn: '08:00', timeOut: '17:00' }

  it('accepts a same-day pair', () => {
    expect(manualTimesheetProblem(base)).toBeNull()
  })

  it('requires time out after time in', () => {
    expect(manualTimesheetProblem({ ...base, timeOut: '08:00' })).toBe('Time out must be after time in on the same day.')
    expect(manualTimesheetProblem({ ...base, timeOut: '07:30' })).toBe('Time out must be after time in on the same day.')
  })

  it('requires an employee and a date', () => {
    expect(manualTimesheetProblem({ ...base, employeeId: '' })).toBe('Choose an employee.')
    expect(manualTimesheetProblem({ ...base, workDate: '' })).toBe('Choose a date.')
  })
})
