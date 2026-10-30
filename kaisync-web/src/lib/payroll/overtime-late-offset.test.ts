import { describe, expect, it } from 'vitest'
import { payableOvertimeHours } from '@/lib/payroll/overtime-late-offset'

describe('overtime less late arrival', () => {
  it('subtracts one late hour from two overtime hours when the row is ticked', () => {
    expect(payableOvertimeHours(2, 60, true)).toBe(1)
  })

  it('leaves the overtime unchanged when the row is not ticked', () => {
    expect(payableOvertimeHours(2, 60, false)).toBe(2)
  })

  it('does not pay a negative overtime when lateness is longer than the overtime', () => {
    expect(payableOvertimeHours(1, 120, true)).toBe(0)
  })
})
