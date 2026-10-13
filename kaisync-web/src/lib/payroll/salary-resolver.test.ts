import { describe, expect, it } from 'vitest'
import { resolveAsOf } from './salary-resolver'

describe('resolveAsOf', () => {
  it('uses the later salary record when two changes share a date', () => {
    const resolved = resolveAsOf(1000, 10, 80, '2026-10-31', [
      { effective_date: '2026-10-31', monthly_salary: 4000, hourly_rate: 20, daily_rate: 160, created_at: '2026-10-01T08:00:00Z' },
      { effective_date: '2026-10-31', monthly_salary: 5000, hourly_rate: 25, daily_rate: 200, created_at: '2026-10-13T08:00:00Z' },
    ])
    expect(resolved.monthlySalary).toBe(5000)
  })
})
