import { describe, expect, it } from 'vitest'
import { getAnnualDays } from '@/lib/leave-policy'
import {
  getCompanyAnnualDays,
  resolveLeaveTypeOptions,
} from '@/lib/leave-settings'

describe('getCompanyAnnualDays', () => {
  it('prefers MAUI leave_settings keys', () => {
    expect(
      getCompanyAnnualDays('Annual Leave', { annual_leave_days: 21 })
    ).toBe(21)
    expect(
      getCompanyAnnualDays('Sick Leave', { sick_leave_days: '12' })
    ).toBe(12)
  })

  it('falls back to leave-policy defaults', () => {
    expect(getCompanyAnnualDays('Annual Leave', {})).toBe(getAnnualDays('Annual Leave'))
    expect(getCompanyAnnualDays('Study Leave', null)).toBe(5)
  })

  it('matches leave types case-insensitively', () => {
    expect(
      getCompanyAnnualDays('annual leave', { annual_leave_days: 18 })
    ).toBe(18)
  })
})

describe('resolveLeaveTypeOptions', () => {
  it('overrides annual days from settings', () => {
    const opts = resolveLeaveTypeOptions({ annual_leave_days: 20 })
    const annual = opts.find(o => o.key === 'Annual Leave')
    expect(annual?.annualDays).toBe(20)
  })
})
