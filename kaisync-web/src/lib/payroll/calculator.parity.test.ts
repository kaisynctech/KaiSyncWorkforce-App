import { describe, expect, it } from 'vitest'
import { calculate, type EmployeeSnapshot, type Policy } from './calculator'
import { calculateMonthlyPaye } from './sars-paye'

function basePolicy(): Policy {
  return {
    defaultPayBasis: 'monthly_salary',
    salaryIgnoreAttendanceDeductions: true,
    absentPenalty: { mode: 'none', thresholdCount: 3, deductDays: 1, deductHours: 0, applyTo: 'all' },
    latePenalty: { mode: 'none', thresholdCount: 3, deductDays: 0, deductHours: 0.5, applyTo: 'all' },
    earlyPenalty: { mode: 'none', thresholdCount: 3, deductDays: 0, deductHours: 0.5, applyTo: 'all' },
    statutory: {
      uifEnabled: false,
      uifRatePercent: 1,
      uifCeilingMonthly: 17_712,
      payeEnabled: false,
      defaultPayeRatePercent: 0,
      useSarsTaxTables: false,
    },
    allowOvertimeForSalary: true,
    paySalaryOnPublicHolidays: true,
    payHourlyOnPublicHolidays: false,
    payFullSalaryForMidMonthJoiners: false,
    publicHolidays: [],
  }
}

function baseEmployee(): EmployeeSnapshot {
  return {
    id: 'e1',
    monthlySalary: 0,
    hourlyRate: 0,
    dailyRate: 0,
    dailyHours: 8,
    workDaysWeekly: 5,
    overtimeRate: 0,
    payBasis: undefined,
    payeRatePercent: null,
    uifExempt: true,
    employmentDate: null,
    terminationDate: null,
    workerType: 'employee',
    medicalAidDeduction: 0,
    pensionDeduction: 0,
    unionDeduction: 0,
    payFullMonthlySalary: false,
    payeFixedAmount: 0,
    uifRatePercent: null,
    uifFixedAmount: 0,
    dateOfBirth: null,
    taxDirectiveRatePercent: null,
    costCenter: null,
  }
}

describe('calculator parity with KaiFlow.Payroll', () => {
  it('pro-rates monthly salary for a mid-month joiner (20000 * 16/31)', () => {
    const result = calculate({
      employee: { ...baseEmployee(), monthlySalary: 20_000, payBasis: 'monthly_salary', employmentDate: '2026-08-16' },
      policy: basePolicy(),
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      sessions: [],
      leave: [],
      absences: [],
      dailyHours: 8,
      otMultiplier: 1.5,
    })

    expect(result).not.toBeNull()
    expect(result!.baseSalary).toBeCloseTo((20_000 * 16) / 31, 2)
    expect(result!.grossPay).toBeCloseTo((20_000 * 16) / 31, 2)
    expect(result!.notes).toContain('pro-rated for join/leave dates')
  })

  it('returns null when terminated before the period starts', () => {
    const result = calculate({
      employee: {
        ...baseEmployee(),
        monthlySalary: 20_000,
        payBasis: 'monthly_salary',
        terminationDate: '2026-07-15',
      },
      policy: basePolicy(),
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      sessions: [],
      leave: [],
      absences: [],
      dailyHours: 8,
      otMultiplier: 1.5,
    })

    expect(result).toBeNull()
  })

  it('applies a per-day absent penalty for hourly employees', () => {
    const policy = basePolicy()
    policy.absentPenalty = { mode: 'per_day', thresholdCount: 1, deductDays: 1, deductHours: 0, applyTo: 'all' }

    const result = calculate({
      employee: { ...baseEmployee(), hourlyRate: 100, payBasis: 'hourly' },
      policy,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      sessions: [],
      leave: [],
      absences: [{ date: '2026-08-05' }],
      dailyHours: 8,
      otMultiplier: 1.5,
    })

    expect(result).not.toBeNull()
    const absentLine = result!.deductionLines.find(d => d.label.startsWith('Absent'))
    expect(absentLine?.amount).toBe(800) // 1 day * 1 deductDays * (100 hourlyRate * 8 dailyHours)
  })

  it('skips attendance penalties when waivePenalties override is set', () => {
    const policy = basePolicy()
    policy.absentPenalty = { mode: 'per_day', thresholdCount: 1, deductDays: 1, deductHours: 0, applyTo: 'all' }

    const result = calculate({
      employee: { ...baseEmployee(), hourlyRate: 100, payBasis: 'hourly' },
      policy,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      sessions: [],
      leave: [],
      absences: [{ date: '2026-08-05' }],
      dailyHours: 8,
      otMultiplier: 1.5,
      overrides: { waivePenalties: true },
    })

    expect(result).not.toBeNull()
    expect(result!.deductionLines.some(d => d.label.startsWith('Absent'))).toBe(false)
    expect(result!.notes).toContain('penalties waived')
  })

  it('uses SARS tax tables when policy.statutory.useSarsTaxTables is true', () => {
    const policy = basePolicy()
    policy.statutory = { ...policy.statutory, payeEnabled: true, useSarsTaxTables: true }

    const result = calculate({
      employee: { ...baseEmployee(), monthlySalary: 30_000, payBasis: 'monthly_salary', uifExempt: true },
      policy,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      sessions: [],
      leave: [],
      absences: [],
      dailyHours: 8,
      otMultiplier: 1.5,
    })

    expect(result).not.toBeNull()
    const payeLine = result!.deductionLines.find(d => d.label === 'PAYE')
    expect(payeLine?.amount).toBeCloseTo(calculateMonthlyPaye(30_000), 2)
  })
})
