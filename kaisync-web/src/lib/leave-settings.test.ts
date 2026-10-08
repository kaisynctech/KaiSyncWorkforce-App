import { describe, expect, it } from 'vitest'
import { getAnnualDays } from '@/lib/leave-policy'
import {
  getCompanyAnnualDays,
  leavePolicyNameError,
  mergeLeaveDaySettings,
  parseCustomLeaveTypes,
  parseLeaveDayInput,
  readCustomLeaveTypes,
  resolveLeaveTypeOptions,
  summarizeCompanyLeave,
} from '@/lib/leave-settings'

describe('getCompanyAnnualDays', () => {
  it('prefers legacy leave_settings keys', () => {
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

describe('parseLeaveDayInput', () => {
  it('accepts whole days inside the cap', () => {
    expect(parseLeaveDayInput('21')).toBe(21)
    expect(parseLeaveDayInput('0')).toBe(0)
    expect(parseLeaveDayInput('366')).toBe(366)
  })

  it('rejects blank, fractions, and values above the cap', () => {
    expect(parseLeaveDayInput('')).toBeNull()
    expect(parseLeaveDayInput('15.5')).toBeNull()
    expect(parseLeaveDayInput('-1')).toBeNull()
    expect(parseLeaveDayInput('367')).toBeNull()
  })
})

describe('mergeLeaveDaySettings', () => {
  it('writes canonical keys and keeps unrelated settings', () => {
    const merged = mergeLeaveDaySettings(
      { notes: 'keep', annual_leave: 9 },
      {
        'Annual Leave': 21,
        'Sick Leave': 30,
        'Family Responsibility': 3,
        'Maternity Leave': 60,
        'Paternity Leave': 10,
        'Study Leave': 5,
        'Unpaid Leave': 365,
      },
    )
    expect(merged.annual_leave_days).toBe(21)
    expect(merged.sick_leave_days).toBe(30)
    expect(merged.notes).toBe('keep')
    expect(getCompanyAnnualDays('Annual Leave', merged)).toBe(21)
  })

  it('replaces additional policies and keeps them beside statutory days', () => {
    const merged = mergeLeaveDaySettings(
      { annual_leave_days: 15, custom_leave_types: [{ name: 'Old Policy', days: 2 }] },
      {
        'Annual Leave': 15,
        'Sick Leave': 10,
        'Family Responsibility': 3,
        'Maternity Leave': 60,
        'Paternity Leave': 10,
        'Study Leave': 5,
        'Unpaid Leave': 365,
      },
      [{ name: 'Compassionate Leave', days: 4 }],
    )
    expect(readCustomLeaveTypes(merged)).toEqual([{ name: 'Compassionate Leave', days: 4 }])
    expect(getCompanyAnnualDays('Compassionate Leave', merged)).toBe(4)
  })
})

describe('custom leave policies', () => {
  it('rejects a duplicate of a standard type', () => {
    expect(leavePolicyNameError('annual leave', [])).toMatch(/standard leave type/)
  })

  it('parses an additional policy', () => {
    const parsed = parseCustomLeaveTypes([{ name: '  Compassion  Leave ', days: '4' }])
    expect(parsed).toEqual({ ok: true, types: [{ name: 'Compassion Leave', days: 4 }] })
  })

  it('appears on leave type options and balances', () => {
    const settings = {
      custom_leave_types: [{ name: 'Compassionate Leave', days: 4 }],
    }
    const opts = resolveLeaveTypeOptions(settings)
    expect(opts.some(o => o.key === 'Compassionate Leave' && o.annualDays === 4)).toBe(true)
    const summary = summarizeCompanyLeave([], settings)
    expect(summary.find(s => s.leave_type === 'Compassionate Leave')?.annual_days).toBe(4)
  })
})
