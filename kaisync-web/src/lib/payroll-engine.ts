/**
 * Thin adapter over `lib/payroll/calculator.ts` — the full TypeScript port of
 * KaiFlow.Payroll (see docs/modules/payroll-web-program.md). Maps the web's
 * flat `PayrollSettings` + `employees` row shape to the calculator's structured
 * inputs and back to the `payment_approvals` row shape used by `payroll.ts`.
 */

import type { PayrollLineItem, PayrollSettings } from '@/types/database'
import {
  buildPolicyFromSettings,
  buildSessionsFromPunches,
  calculate,
  sumPunchHours,
  type EmployeeSnapshot,
  type PayBasis,
  type PunchLike,
} from '@/lib/payroll/calculator'
import type { YtdTotals } from '@/lib/payroll/irp5'
import type { LeaveSnapshot } from '@/lib/payroll/calculator'
import type { SalaryHistoryEntry } from '@/lib/payroll/salary-resolver'

export type { LeaveSnapshot, SalaryHistoryEntry }

export type EngineEmployee = {
  id: string
  name: string
  surname: string
  monthly_salary: number | null
  hourly_rate: number | null
  daily_rate: number | null
  daily_hours: number | null
  pay_by_hour: boolean | null
  pay_basis: string | null
  uif_exempt: boolean | null
  paye_rate_percent: number | null
  medical_aid_deduction: number | null
  pension_deduction: number | null
  union_deduction: number | null
  department: string | null
  cost_center?: string | null
  branch?: string | null
  worker_type: string | null
  employment_date?: string | null
  termination_date?: string | null
  date_of_birth?: string | null
  paye_fixed_amount?: number | null
  uif_rate_percent?: number | null
  uif_fixed_amount?: number | null
  tax_directive_rate_percent?: number | null
  pay_full_monthly_salary?: boolean | null
  overtime_rate?: number | null
  work_days_weekly?: number | null
}

export type { PunchLike }

export type PayslipOverrides = {
  payFullBaseSalary?: boolean
  waivePenalties?: boolean
  manualPayeOverride?: number | null
  manualAdjustment?: number | null
  bonusAmount?: number | null
}

export type EnginePayslip = {
  employee_id: string
  period_start: string
  period_end: string
  regular_hours: number
  overtime_hours: number
  working_days: number
  leave_days: number
  unpaid_leave_days: number
  absent_days: number
  regular_pay: number
  overtime_pay: number
  base_salary: number
  gross_pay: number
  deductions: number
  net_pay: number
  pay_basis: string
  branch_label: string | null
  cost_center: string | null
  earnings_breakdown: PayrollLineItem[]
  deductions_breakdown: PayrollLineItem[]
  policy_snapshot: Record<string, unknown>
  ytd_json: { gross_pay: number; paye: number; uif: number; net_pay: number }
  audit_log: { action: string; detail: string | null; at: string }[]
}

export { sumPunchHours }

function mapPayBasisIn(emp: EngineEmployee): PayBasis | undefined {
  if (emp.pay_by_hour) return 'hourly'
  const raw = (emp.pay_basis ?? '').toLowerCase()
  if (raw.includes('hour')) return 'hourly'
  if (raw.includes('day')) return 'daily'
  if (raw.includes('month') || raw.includes('salary')) return 'monthly_salary'
  return undefined
}

function mapPayBasisOut(basis: PayBasis): string {
  return basis === 'monthly_salary' ? 'monthly' : basis
}

function buildEmployeeSnapshot(emp: EngineEmployee, dailyHours: number): EmployeeSnapshot {
  return {
    id: emp.id,
    monthlySalary: emp.monthly_salary ?? 0,
    hourlyRate: emp.hourly_rate ?? 0,
    dailyRate: emp.daily_rate ?? 0,
    dailyHours,
    workDaysWeekly: emp.work_days_weekly ?? 5,
    overtimeRate: emp.overtime_rate ?? 0,
    payBasis: mapPayBasisIn(emp),
    payeRatePercent: emp.paye_rate_percent ?? null,
    uifExempt: Boolean(emp.uif_exempt),
    employmentDate: emp.employment_date ?? null,
    terminationDate: emp.termination_date ?? null,
    workerType: emp.worker_type ?? null,
    medicalAidDeduction: emp.medical_aid_deduction ?? 0,
    pensionDeduction: emp.pension_deduction ?? 0,
    unionDeduction: emp.union_deduction ?? 0,
    payFullMonthlySalary: Boolean(emp.pay_full_monthly_salary),
    payeFixedAmount: emp.paye_fixed_amount ?? 0,
    uifRatePercent: emp.uif_rate_percent ?? null,
    uifFixedAmount: emp.uif_fixed_amount ?? 0,
    dateOfBirth: emp.date_of_birth ?? null,
    taxDirectiveRatePercent: emp.tax_directive_rate_percent ?? null,
    costCenter: emp.cost_center ?? emp.department ?? null,
  }
}

export function calculatePayslip(input: {
  employee: EngineEmployee
  settings: PayrollSettings
  punches: PunchLike[]
  periodStart: string
  periodEnd: string
  overrides?: PayslipOverrides
  paidLeaveDays?: number
  unpaidLeaveDays?: number
  absentDays?: number
  leaveRecords?: LeaveSnapshot[]
  salaryHistory?: SalaryHistoryEntry[] | null
  ytdPrior?: { gross_pay: number; paye: number; uif: number; net_pay: number }
}): EnginePayslip | null {
  const emp = input.employee
  const settings = input.settings
  const overrides = input.overrides ?? {}
  const dailyHours = emp.daily_hours && emp.daily_hours > 0 ? emp.daily_hours : 8

  const snapshot = buildEmployeeSnapshot(emp, dailyHours)
  const policy = buildPolicyFromSettings(settings)
  const sessions = buildSessionsFromPunches(input.punches, emp.id, input.periodStart, input.periodEnd, dailyHours)
  const otMultiplier = settings.overtime_multiplier > 0 ? settings.overtime_multiplier : 1.5

  const priorYtd: YtdTotals = {
    gross_pay: input.ytdPrior?.gross_pay ?? 0,
    net_pay: input.ytdPrior?.net_pay ?? 0,
    total_deductions: 0,
    paye: input.ytdPrior?.paye ?? 0,
    uif: input.ytdPrior?.uif ?? 0,
    taxable_earnings: input.ytdPrior?.gross_pay ?? 0,
    payslip_count: 0,
  }

  const leaveRecords = input.leaveRecords ?? []
  const useLeaveOverride = leaveRecords.length === 0 &&
    ((input.paidLeaveDays ?? 0) > 0 || (input.unpaidLeaveDays ?? 0) > 0)

  const result = calculate({
    employee: snapshot,
    policy,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    sessions,
    leave: leaveRecords,
    absences: [],
    dailyHours,
    otMultiplier,
    overrides: {
      payFullBaseSalary: overrides.payFullBaseSalary,
      waivePenalties: overrides.waivePenalties,
      manualPayeOverride: overrides.manualPayeOverride ?? null,
      manualAdjustment: overrides.manualAdjustment ?? 0,
      bonusAmount: overrides.bonusAmount ?? 0,
    },
    priorYtd,
    salaryHistory: input.salaryHistory ?? null,
    leaveOverride: useLeaveOverride
      ? { paidDays: input.paidLeaveDays ?? 0, unpaidDays: input.unpaidLeaveDays ?? 0 }
      : undefined,
    absentDaysOverride: input.absentDays ?? 0,
  })

  if (!result) return null

  const payBasisOut = mapPayBasisOut(result.payBasis)
  const ytd = result.ytdTotals!

  return {
    employee_id: emp.id,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    regular_hours: result.regularHours,
    overtime_hours: result.overtimeHours,
    working_days: result.workingDays,
    leave_days: result.leaveDays,
    unpaid_leave_days: result.unpaidLeaveDays,
    absent_days: result.absentDays,
    regular_pay: result.regularPay,
    overtime_pay: result.overtimePay,
    base_salary: result.baseSalary,
    gross_pay: result.grossPay,
    deductions: result.totalDeductions,
    net_pay: result.netPay,
    pay_basis: payBasisOut,
    branch_label: emp.branch ?? null,
    cost_center: emp.cost_center ?? emp.department ?? null,
    earnings_breakdown: result.earningsLines,
    deductions_breakdown: result.deductionLines,
    policy_snapshot: {
      source: 'kaisync-web-payroll-engine-v2',
      overtime_multiplier: otMultiplier,
      allow_overtime_for_salary: settings.allow_overtime_for_salary,
      uif_enabled: settings.uif_enabled,
      uif_rate_percent: settings.uif_rate_percent,
      paye_enabled: settings.paye_enabled,
      default_paye_rate_percent: settings.default_paye_rate_percent,
      use_sars_tax_tables: settings.use_sars_tax_tables,
      pay_basis: payBasisOut,
    },
    ytd_json: {
      gross_pay: ytd.gross_pay,
      paye: ytd.paye,
      uif: ytd.uif,
      net_pay: ytd.net_pay,
    },
    audit_log: [
      {
        action: 'calculated',
        detail: `Web engine (${payBasisOut}); gross ${result.grossPay}; net ${result.netPay}`,
        at: new Date().toISOString(),
      },
    ],
  }
}
