/**
 * Prefs-aware payroll calculation for web generate/recalc.
 *
 * Incremental enterprise path: reads company_settings.payroll_preferences +
 * employee rates + period punches, writes payment_approvals with breakdowns.
 * Not a full SARS tax-table port of KaiFlow.Payroll (Phase 5+).
 */

import type { PayrollSettings } from '@/types/database'
import type { PayrollLineItem } from '@/types/database'

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
}

export type PunchLike = {
  employee_id: string
  type: string
  date_time: string
}

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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Pair in→out punches and sum hours in period. */
export function sumPunchHours(
  punches: PunchLike[],
  employeeId: string,
  periodStart: string,
  periodEnd: string
): { regularHours: number; workingDays: number } {
  const inPeriod = punches
    .filter(p => p.employee_id === employeeId && p.date_time)
    .filter(p => {
      const d = p.date_time.slice(0, 10)
      return d >= periodStart && d <= periodEnd
    })
    .sort((a, b) => a.date_time.localeCompare(b.date_time))

  let hours = 0
  const days = new Set<string>()
  let i = 0
  while (i < inPeriod.length) {
    const p = inPeriod[i]
    if (p.type === 'in') {
      const out = inPeriod.slice(i + 1).find(x => x.type === 'out')
      if (out) {
        const ms = new Date(out.date_time).getTime() - new Date(p.date_time).getTime()
        if (ms > 0) {
          hours += ms / 3600000
          days.add(p.date_time.slice(0, 10))
        }
        i = inPeriod.indexOf(out) + 1
        continue
      }
    }
    i++
  }
  return { regularHours: round2(hours), workingDays: days.size }
}

function resolvePayBasis(emp: EngineEmployee, settings: PayrollSettings): 'monthly' | 'hourly' | 'daily' {
  if (emp.pay_by_hour) return 'hourly'
  const raw = (emp.pay_basis ?? settings.payroll_default_pay_basis ?? 'monthly').toLowerCase()
  if (raw.includes('hour')) return 'hourly'
  if (raw.includes('day')) return 'daily'
  if ((emp.monthly_salary ?? 0) > 0) return 'monthly'
  if ((emp.hourly_rate ?? 0) > 0) return 'hourly'
  if ((emp.daily_rate ?? 0) > 0) return 'daily'
  return 'monthly'
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
  ytdPrior?: { gross_pay: number; paye: number; uif: number; net_pay: number }
}): EnginePayslip | null {
  const emp = input.employee
  const settings = input.settings
  const overrides = input.overrides ?? {}
  const dailyHours = emp.daily_hours && emp.daily_hours > 0 ? emp.daily_hours : 8
  const { regularHours: punchedHours, workingDays } = sumPunchHours(
    input.punches,
    emp.id,
    input.periodStart,
    input.periodEnd
  )

  const payBasis = resolvePayBasis(emp, settings)
  const otMultiplier = settings.overtime_multiplier > 0 ? settings.overtime_multiplier : 1.5
  const allowOt = payBasis !== 'monthly' || settings.allow_overtime_for_salary

  let regularHours = punchedHours
  let overtimeHours = 0
  if (allowOt && workingDays > 0) {
    const expected = workingDays * dailyHours
    if (punchedHours > expected) {
      overtimeHours = round2(punchedHours - expected)
      regularHours = round2(expected)
    }
  }

  const hourlyRate =
    (emp.hourly_rate ?? 0) > 0
      ? emp.hourly_rate!
      : (emp.monthly_salary ?? 0) > 0
        ? emp.monthly_salary! / (22 * dailyHours)
        : (emp.daily_rate ?? 0) > 0
          ? emp.daily_rate! / dailyHours
          : settings.default_hourly_rate

  const dailyRate =
    (emp.daily_rate ?? 0) > 0
      ? emp.daily_rate!
      : hourlyRate * dailyHours

  const earnings: PayrollLineItem[] = []
  let regularPay = 0
  let overtimePay = 0
  let baseSalary = 0

  if (payBasis === 'monthly') {
    baseSalary = round2(emp.monthly_salary ?? 0)
    regularPay = baseSalary
    earnings.push({
      label: overrides.payFullBaseSalary ? 'Base salary (full month)' : 'Base salary',
      amount: regularPay,
    })
  } else if (payBasis === 'daily') {
    regularPay = round2(workingDays * dailyRate)
    earnings.push({ label: `Daily rate × ${workingDays} days`, amount: regularPay })
  } else {
    regularPay = round2(regularHours * hourlyRate)
    earnings.push({ label: `Regular hours (${regularHours.toFixed(2)}h)`, amount: regularPay })
  }

  if (overtimeHours > 0 && allowOt) {
    overtimePay = round2(overtimeHours * hourlyRate * otMultiplier)
    earnings.push({
      label: `Overtime (${overtimeHours.toFixed(2)}h × ${otMultiplier})`,
      amount: overtimePay,
    })
  }

  const bonus = round2(overrides.bonusAmount ?? 0)
  if (bonus > 0) earnings.push({ label: 'Bonus', amount: bonus })

  let unpaidLeaveDeduction = 0
  const unpaidDays = input.unpaidLeaveDays ?? 0
  if (unpaidDays > 0 && payBasis === 'monthly' && baseSalary > 0) {
    unpaidLeaveDeduction = round2((baseSalary / 22) * unpaidDays)
  } else if (unpaidDays > 0 && payBasis !== 'monthly') {
    unpaidLeaveDeduction = round2(unpaidDays * dailyRate)
  }

  let grossPay = round2(regularPay + overtimePay + bonus - unpaidLeaveDeduction)
  if (grossPay < 0) grossPay = 0

  const deductions: PayrollLineItem[] = []
  if (unpaidLeaveDeduction > 0) {
    // Shown for transparency; already removed from gross
    deductions.push({ label: `Unpaid leave (${unpaidDays}d)`, amount: unpaidLeaveDeduction })
  }

  const medical = round2(emp.medical_aid_deduction ?? 0)
  const pension = round2(emp.pension_deduction ?? 0)
  const union = round2(emp.union_deduction ?? 0)
  if (medical > 0) deductions.push({ label: 'Medical aid', amount: medical })
  if (pension > 0) deductions.push({ label: 'Pension', amount: pension })
  if (union > 0) deductions.push({ label: 'Union', amount: union })

  let uif = 0
  const isContractor = emp.worker_type === 'contractor' || emp.worker_type === 'subcontractor'
  if (settings.uif_enabled && !emp.uif_exempt && !isContractor) {
    const uifBase = Math.min(grossPay, settings.uif_ceiling_monthly || grossPay)
    uif = round2(uifBase * (settings.uif_rate_percent || 1) / 100)
    if (uif > 0) deductions.push({ label: 'UIF', amount: uif })
  }

  let paye = 0
  if (overrides.manualPayeOverride != null && !Number.isNaN(overrides.manualPayeOverride)) {
    paye = round2(overrides.manualPayeOverride)
  } else if (settings.paye_enabled && !isContractor) {
    const rate =
      emp.paye_rate_percent != null && emp.paye_rate_percent > 0
        ? emp.paye_rate_percent
        : settings.default_paye_rate_percent
    if (rate > 0) paye = round2(grossPay * rate / 100)
  }
  if (paye > 0) deductions.push({ label: 'PAYE', amount: paye })

  const adjustment = round2(overrides.manualAdjustment ?? 0)
  if (adjustment > 0) deductions.push({ label: 'Manual adjustment', amount: adjustment })

  // Net uses statutory + benefit deductions only (unpaid leave already off gross)
  const deductionTotal = round2(medical + pension + union + uif + paye + adjustment)
  const netPay = round2(Math.max(0, grossPay - deductionTotal))

  const prior = input.ytdPrior ?? { gross_pay: 0, paye: 0, uif: 0, net_pay: 0 }

  return {
    employee_id: emp.id,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    regular_hours: regularHours,
    overtime_hours: overtimeHours,
    working_days: workingDays,
    leave_days: input.paidLeaveDays ?? 0,
    unpaid_leave_days: unpaidDays,
    absent_days: input.absentDays ?? 0,
    regular_pay: regularPay,
    overtime_pay: overtimePay,
    base_salary: baseSalary,
    gross_pay: grossPay,
    deductions: deductionTotal,
    net_pay: netPay,
    pay_basis: payBasis,
    branch_label: emp.branch ?? null,
    cost_center: emp.cost_center ?? emp.department ?? null,
    earnings_breakdown: earnings,
    deductions_breakdown: deductions,
    policy_snapshot: {
      source: 'kaisync-web-payroll-engine',
      overtime_multiplier: otMultiplier,
      allow_overtime_for_salary: settings.allow_overtime_for_salary,
      uif_enabled: settings.uif_enabled,
      uif_rate_percent: settings.uif_rate_percent,
      paye_enabled: settings.paye_enabled,
      default_paye_rate_percent: settings.default_paye_rate_percent,
      pay_basis: payBasis,
    },
    ytd_json: {
      gross_pay: round2(prior.gross_pay + grossPay),
      paye: round2(prior.paye + paye),
      uif: round2(prior.uif + uif),
      net_pay: round2(prior.net_pay + netPay),
    },
    audit_log: [
      {
        action: 'calculated',
        detail: `Web engine (${payBasis}); gross ${grossPay}; net ${netPay}`,
        at: new Date().toISOString(),
      },
    ],
  }
}
