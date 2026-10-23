import { describe, expect, it } from 'vitest'
import { calculatePayslip, sumPunchHours } from '@/lib/payroll-engine'
import type { PayrollSettings } from '@/types/database'
import { PAYROLL_SETTINGS_DEFAULTS } from '@/lib/payroll-settings'

const settings: PayrollSettings = {
  id: 'co',
  company_id: 'co',
  ...PAYROLL_SETTINGS_DEFAULTS,
  overtime_multiplier: 1.5,
  allow_overtime_for_salary: false,
  uif_enabled: true,
  uif_rate_percent: 1,
  uif_ceiling_monthly: 17712,
  paye_enabled: true,
  default_paye_rate_percent: 18,
}

const emp = {
  id: 'e1',
  name: 'Ada',
  surname: 'Lovelace',
  monthly_salary: 22000,
  hourly_rate: 0,
  daily_rate: 0,
  daily_hours: 8,
  pay_by_hour: false,
  pay_basis: 'monthly',
  uif_exempt: false,
  paye_rate_percent: null,
  medical_aid_deduction: 500,
  pension_deduction: 0,
  union_deduction: 0,
  department: 'Ops',
  branch: 'CPT',
  worker_type: 'employee',
}

describe('sumPunchHours', () => {
  it('pairs in/out punches within the period', () => {
    const punches = [
      { employee_id: 'e1', type: 'in', date_time: '2026-08-01T08:00:00' },
      { employee_id: 'e1', type: 'out', date_time: '2026-08-01T16:00:00' },
      { employee_id: 'e1', type: 'in', date_time: '2026-08-02T08:00:00' },
      { employee_id: 'e1', type: 'out', date_time: '2026-08-02T17:00:00' },
    ]
    const { regularHours, workingDays } = sumPunchHours(punches, 'e1', '2026-08-01', '2026-08-31')
    expect(workingDays).toBe(2)
    expect(regularHours).toBe(17)
  })
})

describe('calculatePayslip', () => {
  it('computes monthly salary with UIF, PAYE, and medical', () => {
    const slip = calculatePayslip({
      employee: emp,
      settings,
      punches: [],
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    })
    expect(slip).not.toBeNull()
    expect(slip!.gross_pay).toBe(22000)
    expect(slip!.deductions_breakdown.some(d => d.label === 'Medical aid')).toBe(true)
    expect(slip!.deductions_breakdown.some(d => d.label === 'UIF')).toBe(true)
    expect(slip!.deductions_breakdown.some(d => d.label === 'PAYE')).toBe(true)
    expect(slip!.net_pay).toBeLessThan(slip!.gross_pay)
    expect(slip!.policy_snapshot.source).toBe('kaisync-web-payroll-engine-v2')
  })

  it('skips UIF for contractors and exempt employees', () => {
    const contractor = calculatePayslip({
      employee: { ...emp, worker_type: 'contractor' },
      settings,
      punches: [],
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    })
    expect(contractor!.deductions_breakdown.some(d => d.label === 'UIF')).toBe(false)

    const exempt = calculatePayslip({
      employee: { ...emp, uif_exempt: true },
      settings,
      punches: [],
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    })
    expect(exempt!.deductions_breakdown.some(d => d.label === 'UIF')).toBe(false)
  })

  it('pays hourly with overtime split', () => {
    const punches = [
      { employee_id: 'e1', type: 'in', date_time: '2026-08-01T08:00:00' },
      { employee_id: 'e1', type: 'out', date_time: '2026-08-01T18:00:00' }, // 10h
    ]
    const slip = calculatePayslip({
      employee: {
        ...emp,
        monthly_salary: 0,
        hourly_rate: 100,
        pay_by_hour: true,
        pay_basis: 'hourly',
      },
      settings: { ...settings, allow_overtime_for_salary: true },
      punches,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    })
    expect(slip!.regular_hours).toBe(8)
    expect(slip!.overtime_hours).toBe(2)
    expect(slip!.overtime_pay).toBe(300) // 2 * 100 * 1.5
  })

  it('honours manual PAYE override and bonus', () => {
    const slip = calculatePayslip({
      employee: emp,
      settings,
      punches: [],
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      overrides: { manualPayeOverride: 1000, bonusAmount: 500 },
    })
    expect(slip!.earnings_breakdown.some(e => e.label === 'Bonus')).toBe(true)
    expect(slip!.deductions_breakdown.find(d => d.label === 'PAYE')?.amount).toBe(1000)
  })
})

describe('fixes found on Ironvale (23 Oct 2026)', () => {
  const noTax: PayrollSettings = { ...settings, uif_enabled: false, paye_enabled: false }

  it('one unpaid leave day comes off net pay once', () => {
    const slip = calculatePayslip({
      employee: { ...emp, monthly_salary: 21670, medical_aid_deduction: 0, work_days_weekly: 5 } as never,
      settings: noTax, punches: [], periodStart: '2026-08-01', periodEnd: '2026-08-31', unpaidLeaveDays: 1,
    })
    expect(slip!.gross_pay).toBe(21670)
    expect(slip!.net_pay).toBe(20669.85)
  })

  it('day-rate staff are paid per day, not per hour', () => {
    const day = { ...emp, monthly_salary: 0, hourly_rate: 51.63, daily_rate: 413, pay_by_hour: true, pay_basis: 'daily', medical_aid_deduction: 0 }
    const punches = [
      { employee_id: 'e1', type: 'in', date_time: '2026-10-19T08:00:00Z' },
      { employee_id: 'e1', type: 'out', date_time: '2026-10-19T16:00:00Z' },
      { employee_id: 'e1', type: 'in', date_time: '2026-10-20T08:00:00Z' },
      { employee_id: 'e1', type: 'out', date_time: '2026-10-20T16:00:00Z' },
    ]
    const slip = calculatePayslip({ employee: day as never, settings: noTax, punches, periodStart: '2026-10-01', periodEnd: '2026-10-31' })
    expect(slip!.pay_basis).toBe('daily')
    expect(slip!.gross_pay).toBe(826)
  })

  it('money is in whole cents', () => {
    const hourly = { ...emp, monthly_salary: 0, hourly_rate: 51.63, daily_rate: 0, daily_hours: 8.25, pay_by_hour: true, pay_basis: 'hourly', medical_aid_deduction: 0 }
    const punches = [
      { employee_id: 'e1', type: 'in', date_time: '2026-10-19T08:00:00Z' },
      { employee_id: 'e1', type: 'out', date_time: '2026-10-19T16:15:00Z' },
    ]
    const slip = calculatePayslip({ employee: hourly as never, settings, punches, periodStart: '2026-10-01', periodEnd: '2026-10-31' })
    for (const v of [slip!.gross_pay, slip!.deductions, slip!.net_pay]) expect(Math.round(v * 100) / 100).toBe(v)
  })
})
