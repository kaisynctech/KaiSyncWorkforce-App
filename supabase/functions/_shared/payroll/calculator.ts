/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/payroll/calculator.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * Ports KaiFlow.Payroll/PayrollCalculator.cs — the full calculation pipeline.
 *
 * Deviations from the C# reference (documented in docs/modules/payroll-web-program.md):
 * - UIF/PAYE fall back to company-level `policy.statutory` rate/enabled flags when no
 *   employee-level rate is set, since most companies don't set per-employee statutory rates.
 * - PAYE has an additional final fallback to `policy.statutory.defaultPayeRatePercent`.
 * - `leaveOverride` / `absentDaysOverride` let callers that only have aggregate day counts
 *   (not per-day leave/absence records) still drive the pipeline — used by the
 *   `payroll-engine.ts` adapter for backward compatibility with existing callers.
 */

import type { PayrollLineItem } from './types.ts'
import {
  addDaysISO,
  dayNumber,
  daysInMonth,
  isEmployedInPeriod,
  monthlySalaryFactor,
  proRateFactor,
  yearMonthOf,
  type ISODate,
} from './period.ts'
import { countDaysInPeriod, isUnpaidLeave } from './leave-days.ts'
import { resolveAsOf, type SalaryHistoryEntry } from './salary-resolver.ts'
import { calculateMonthlyPaye } from './sars-paye.ts'
import { mergeYtd, type YtdTotals } from './irp5.ts'

export type PayBasis = 'monthly_salary' | 'hourly' | 'daily'

export type PenaltyMode = 'none' | 'per_day' | 'per_occurrence' | 'threshold'
export type PenaltyApplyTo = 'all' | 'hourly_only' | 'salary_only'

export type PenaltyPolicy = {
  mode: PenaltyMode
  thresholdCount: number
  deductDays: number
  deductHours: number
  applyTo: PenaltyApplyTo
}

export type StatutoryPolicy = {
  uifEnabled: boolean
  uifRatePercent: number
  uifCeilingMonthly: number
  payeEnabled: boolean
  defaultPayeRatePercent: number
  useSarsTaxTables: boolean
}

export type Policy = {
  defaultPayBasis: PayBasis
  salaryIgnoreAttendanceDeductions: boolean
  absentPenalty: PenaltyPolicy
  latePenalty: PenaltyPolicy
  earlyPenalty: PenaltyPolicy
  statutory: StatutoryPolicy
  allowOvertimeForSalary: boolean
  paySalaryOnPublicHolidays: boolean
  payHourlyOnPublicHolidays: boolean
  payFullSalaryForMidMonthJoiners: boolean
  publicHolidays: ISODate[]
}

export type EmployeeSnapshot = {
  id: string
  monthlySalary: number
  hourlyRate: number
  dailyRate: number
  dailyHours: number
  workDaysWeekly: number
  overtimeRate: number
  payBasis?: PayBasis | null
  payeRatePercent?: number | null
  uifExempt: boolean
  employmentDate?: ISODate | null
  terminationDate?: ISODate | null
  workerType?: string | null
  medicalAidDeduction: number
  pensionDeduction: number
  unionDeduction: number
  payFullMonthlySalary: boolean
  payeFixedAmount: number
  uifRatePercent?: number | null
  uifFixedAmount: number
  dateOfBirth?: ISODate | null
  taxDirectiveRatePercent?: number | null
  costCenter?: string | null
}

export type SessionSnapshot = {
  date: ISODate
  regularHours: number
  overtimeHours: number
  isLate: boolean
  isLeftEarly: boolean
  isOpen: boolean
}

export type LeaveSnapshot = {
  leaveType: string
  startDate: ISODate
  endDate: ISODate
  halfDayStart: boolean
  halfDayEnd: boolean
  totalDays: number
  isApproved: boolean
}

export type AbsenceSnapshot = { date: ISODate }

export type PayslipOverridesInput = {
  payFullBaseSalary?: boolean
  waivePenalties?: boolean
  manualPayeOverride?: number | null
  manualAdjustment?: number
  adjustmentNote?: string | null
  bonusAmount?: number
  bonusNote?: string | null
}

export type CalculationInput = {
  employee: EmployeeSnapshot
  policy: Policy
  periodStart: ISODate
  periodEnd: ISODate
  sessions: SessionSnapshot[]
  leave: LeaveSnapshot[]
  absences: AbsenceSnapshot[]
  dailyHours: number
  otMultiplier: number
  overrides?: PayslipOverridesInput
  priorYtd?: YtdTotals | null
  salaryHistory?: SalaryHistoryEntry[] | null
  /** Aggregate day-count fallback when per-day leave records aren't available. */
  leaveOverride?: { paidDays: number; unpaidDays: number }
  /** Aggregate day-count fallback when per-day absence records aren't available. */
  absentDaysOverride?: number
}

export type CalculationResult = {
  payBasis: PayBasis
  baseSalary: number
  workingDays: number
  leaveDays: number
  absentDays: number
  unpaidLeaveDays: number
  regularHours: number
  overtimeHours: number
  regularPay: number
  overtimePay: number
  grossPay: number
  totalDeductions: number
  netPay: number
  lateCount: number
  earlyCount: number
  earningsLines: PayrollLineItem[]
  deductionLines: PayrollLineItem[]
  notes: string | null
  ytdTotals?: YtdTotals | null
}

export type PunchLike = {
  employee_id: string
  type: string
  date_time: string
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Pair in→out punches and sum hours in period (whole-period totals, not per-day). */
export function sumPunchHours(
  punches: PunchLike[],
  employeeId: string,
  periodStart: ISODate,
  periodEnd: ISODate
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
          hours += ms / 3_600_000
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

/**
 * Legacy day-bucket hours helper (no template). Prefer `buildTemplateAwareSessions`
 * in `sessions-from-punches.ts` for late/early + MAUI-parity OT.
 */
export function buildSessionsFromPunches(
  punches: PunchLike[],
  employeeId: string,
  periodStart: ISODate,
  periodEnd: ISODate,
  dailyHours: number
): SessionSnapshot[] {
  const inPeriod = punches
    .filter(p => p.employee_id === employeeId && p.date_time)
    .filter(p => {
      const d = p.date_time.slice(0, 10)
      return d >= periodStart && d <= periodEnd
    })
    .sort((a, b) => a.date_time.localeCompare(b.date_time))

  const hoursByDay = new Map<string, number>()
  const openDays = new Set<string>()
  let i = 0
  while (i < inPeriod.length) {
    const p = inPeriod[i]
    if (p.type === 'in') {
      const outIdx = inPeriod.findIndex((x, idx) => idx > i && x.type === 'out')
      if (outIdx >= 0) {
        const out = inPeriod[outIdx]
        const day = p.date_time.slice(0, 10)
        const ms = new Date(out.date_time).getTime() - new Date(p.date_time).getTime()
        if (ms > 0) hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + ms / 3_600_000)
        i = outIdx + 1
        continue
      }
      openDays.add(p.date_time.slice(0, 10))
    }
    i++
  }

  const sessions: SessionSnapshot[] = []
  for (const [date, hours] of hoursByDay) {
    const regular = Math.min(hours, dailyHours)
    const overtime = Math.max(0, hours - dailyHours)
    sessions.push({
      date,
      regularHours: round2(regular),
      overtimeHours: round2(overtime),
      isLate: false,
      isLeftEarly: false,
      isOpen: false,
    })
  }
  for (const date of openDays) {
    if (!hoursByDay.has(date)) {
      sessions.push({ date, regularHours: 0, overtimeHours: 0, isLate: false, isLeftEarly: false, isOpen: true })
    }
  }
  return sessions
}

function resolvePayBasis(emp: EmployeeSnapshot, policy: Policy): PayBasis {
  if (emp.payBasis) return emp.payBasis
  if (emp.monthlySalary > 0) return 'monthly_salary'
  if (emp.hourlyRate > 0) return 'hourly'
  if (emp.dailyRate > 0) return 'daily'
  return policy.defaultPayBasis
}

function resolveHourlyRate(emp: EmployeeSnapshot, dailyHours: number): number {
  if (emp.hourlyRate > 0) return emp.hourlyRate
  if (emp.dailyRate > 0 && dailyHours > 0) return emp.dailyRate / dailyHours
  if (emp.monthlySalary > 0 && emp.workDaysWeekly > 0 && dailyHours > 0) {
    const workDaysPerMonth = (emp.workDaysWeekly * 52.0) / 12.0
    const daily = emp.monthlySalary / workDaysPerMonth
    return daily / dailyHours
  }
  return 0
}

function countLeaveOnlyDays(
  leave: LeaveSnapshot[],
  periodStart: ISODate,
  periodEnd: ISODate,
  sessionDates: Set<string>,
  absentDates: Set<string>,
  unpaid: boolean
): number {
  let only = 0
  for (const l of leave) {
    if (!l.isApproved || isUnpaidLeave(l.leaveType) !== unpaid) continue
    const overlapStart = l.startDate < periodStart ? periodStart : l.startDate
    const overlapEnd = l.endDate > periodEnd ? periodEnd : l.endDate
    let d = overlapStart
    while (d <= overlapEnd) {
      if (!sessionDates.has(d) && !absentDates.has(d)) {
        if (d === l.startDate && d === l.endDate) {
          if (l.totalDays > 0 && l.totalDays < 1) only += l.totalDays
          else if (l.halfDayStart || l.halfDayEnd) only += 0.5
          else only += 1
        } else if (d === l.startDate && l.halfDayStart) only += 0.5
        else if (d === l.endDate && l.halfDayEnd) only += 0.5
        else only += 1
      }
      d = addDaysISO(d, 1)
    }
  }
  return only
}

function countOverlapLeaveDays(
  leave: LeaveSnapshot[],
  periodStart: ISODate,
  periodEnd: ISODate,
  sessionDates: Set<string>,
  unpaid: boolean
): number {
  let overlap = 0
  for (const l of leave) {
    if (!l.isApproved || isUnpaidLeave(l.leaveType) !== unpaid) continue
    const overlapStart = l.startDate < periodStart ? periodStart : l.startDate
    const overlapEnd = l.endDate > periodEnd ? periodEnd : l.endDate
    let d = overlapStart
    while (d <= overlapEnd) {
      if (sessionDates.has(d)) {
        if (d === l.startDate && d === l.endDate) {
          if (l.totalDays > 0 && l.totalDays < 1) overlap += l.totalDays
          else if (l.halfDayStart || l.halfDayEnd) overlap += 0.5
        } else if (d === l.startDate && l.halfDayStart) overlap += 0.5
        else if (d === l.endDate && l.halfDayEnd) overlap += 0.5
      }
      d = addDaysISO(d, 1)
    }
  }
  return overlap
}

function shouldApplyPenalty(penalty: PenaltyPolicy, policy: Policy, payBasis: PayBasis): boolean {
  if (penalty.mode === 'none') return false
  if (payBasis === 'monthly_salary' && policy.salaryIgnoreAttendanceDeductions) {
    return penalty.applyTo === 'salary_only'
  }
  if (payBasis !== 'monthly_salary' && penalty.applyTo === 'salary_only') return false
  if (payBasis === 'monthly_salary' && penalty.applyTo === 'hourly_only') return false
  return true
}

function addPenalty(
  deductions: PayrollLineItem[],
  penalty: PenaltyPolicy,
  dayCount: number,
  occurrenceCount: number,
  dailyRate: number,
  hourlyRate: number,
  labelPrefix: string
): void {
  let amount = 0
  let label = labelPrefix

  switch (penalty.mode) {
    case 'per_day':
      if (dayCount > 0) {
        amount = dayCount * penalty.deductDays * dailyRate
        label = `${labelPrefix} (${dayCount} day(s))`
      }
      break
    case 'threshold':
      if (dayCount >= penalty.thresholdCount && dayCount > 0) {
        amount = penalty.deductDays * dailyRate
        label = `${labelPrefix} (${penalty.thresholdCount}+ days)`
      } else if (occurrenceCount >= penalty.thresholdCount && occurrenceCount > 0) {
        amount = penalty.deductHours * hourlyRate
        label = `${labelPrefix} (${penalty.thresholdCount}+ times)`
      }
      break
    case 'per_occurrence':
      if (occurrenceCount > 0) {
        amount = occurrenceCount * penalty.deductHours * hourlyRate
        label = `${labelPrefix} (${occurrenceCount}×)`
      }
      break
  }

  if (amount > 0) deductions.push({ label, amount })
}

function addAttendancePenalties(
  deductions: PayrollLineItem[],
  policy: Policy,
  payBasis: PayBasis,
  absentDays: number,
  lateCount: number,
  earlyCount: number,
  hourlyRate: number,
  dailyRate: number
): void {
  if (shouldApplyPenalty(policy.absentPenalty, policy, payBasis)) {
    addPenalty(deductions, policy.absentPenalty, absentDays, 0, dailyRate, hourlyRate, 'Absent')
  }
  if (shouldApplyPenalty(policy.latePenalty, policy, payBasis)) {
    addPenalty(deductions, policy.latePenalty, 0, lateCount, dailyRate, hourlyRate, 'Late arrival')
  }
  if (shouldApplyPenalty(policy.earlyPenalty, policy, payBasis)) {
    addPenalty(deductions, policy.earlyPenalty, 0, earlyCount, dailyRate, hourlyRate, 'Early departure')
  }
}

function addFixedEmployeeDeductions(deductions: PayrollLineItem[], emp: EmployeeSnapshot): void {
  if (emp.medicalAidDeduction > 0) deductions.push({ label: 'Medical aid', amount: emp.medicalAidDeduction })
  if (emp.pensionDeduction > 0) deductions.push({ label: 'Pension', amount: emp.pensionDeduction })
  if (emp.unionDeduction > 0) deductions.push({ label: 'Union', amount: emp.unionDeduction })
}

function addPublicHolidayEarnings(
  earnings: PayrollLineItem[],
  regularPay: number,
  payBasis: PayBasis,
  holidays: ISODate[],
  dailyRate: number,
  hourlyRate: number,
  dailyHours: number,
  policy: Policy
): number {
  if (holidays.length === 0) return regularPay

  const paySalary = payBasis === 'monthly_salary' && policy.paySalaryOnPublicHolidays
  const payHourly = payBasis !== 'monthly_salary' && policy.payHourlyOnPublicHolidays
  if (!paySalary && !payHourly) return regularPay

  let amount = 0
  if (payBasis === 'daily') amount = holidays.length * dailyRate
  else if (payBasis === 'monthly_salary') amount = 0
  else amount = holidays.length * dailyHours * hourlyRate

  if (amount > 0) {
    earnings.push({ label: `Public holidays (${holidays.length})`, amount })
    return regularPay + amount
  }
  return regularPay
}

function addStatutoryDeductions(
  deductions: PayrollLineItem[],
  policy: Policy,
  emp: EmployeeSnapshot,
  grossPay: number,
  periodFactor: number,
  overrides: PayslipOverridesInput
): void {
  if (!emp.uifExempt && grossPay > 0 && policy.statutory.uifEnabled) {
    let uif: number | null = null
    if (emp.uifFixedAmount > 0) {
      uif = emp.uifFixedAmount
    } else {
      const ratePercent = emp.uifRatePercent && emp.uifRatePercent > 0 ? emp.uifRatePercent : policy.statutory.uifRatePercent
      if (ratePercent > 0) {
        const ceiling = policy.statutory.uifCeilingMonthly * periodFactor
        const uifBase = Math.min(grossPay, ceiling)
        uif = round2((uifBase * ratePercent) / 100)
      }
    }
    if (uif != null && uif > 0) deductions.push({ label: 'UIF', amount: uif })
  }

  if (grossPay > 0) {
    let paye: number | null = null
    if (overrides.manualPayeOverride != null) {
      paye = overrides.manualPayeOverride
    } else if (policy.statutory.payeEnabled) {
      if (emp.payeFixedAmount > 0) {
        paye = emp.payeFixedAmount
      } else if (policy.statutory.useSarsTaxTables) {
        paye = calculateMonthlyPaye(grossPay, emp.dateOfBirth, emp.taxDirectiveRatePercent ?? emp.payeRatePercent)
      } else if (emp.payeRatePercent != null && emp.payeRatePercent > 0) {
        paye = round2((grossPay * emp.payeRatePercent) / 100)
      } else if (policy.statutory.defaultPayeRatePercent > 0) {
        paye = round2((grossPay * policy.statutory.defaultPayeRatePercent) / 100)
      }
    }
    if (paye != null && paye > 0) deductions.push({ label: 'PAYE', amount: paye })
  }
}

export function calculate(input: CalculationInput): CalculationResult | null {
  let emp = input.employee
  if (!isEmployedInPeriod(input.periodStart, input.periodEnd, emp.employmentDate, emp.terminationDate)) {
    return null
  }

  const resolved = resolveAsOf(emp.monthlySalary, emp.hourlyRate, emp.dailyRate, input.periodEnd, input.salaryHistory)
  emp = { ...emp, monthlySalary: resolved.monthlySalary, hourlyRate: resolved.hourlyRate, dailyRate: resolved.dailyRate }

  const policy = input.policy
  const overrides = input.overrides ?? {}
  const payBasis = resolvePayBasis(emp, policy)
  const isContractor = emp.workerType === 'contractor' || emp.workerType === 'subcontractor'

  const proRate = overrides.payFullBaseSalary
    ? 1.0
    : proRateFactor(input.periodStart, input.periodEnd, emp.employmentDate, emp.terminationDate)
  if (proRate <= 0) return null

  const absentDates = new Set(input.absences.map(a => a.date))
  const closedSessions = input.sessions.filter(s => !s.isOpen && !absentDates.has(s.date))

  const sessionDates = new Set(closedSessions.map(s => s.date))
  const workingDays = sessionDates.size
  const lateCount = closedSessions.filter(s => s.isLate).length
  const earlyCount = closedSessions.filter(s => s.isLeftEarly).length

  const hourlyRate = resolveHourlyRate(emp, input.dailyHours)
  const dailyRate = emp.dailyRate > 0 ? emp.dailyRate : hourlyRate * input.dailyHours
  const otMultiplier = emp.overtimeRate > 0 ? emp.overtimeRate : input.otMultiplier

  const allowOt = payBasis !== 'monthly_salary' || policy.allowOvertimeForSalary
  const overtimeHours = allowOt ? closedSessions.reduce((s, x) => s + x.overtimeHours, 0) : 0

  let paidLeaveDays = 0
  let unpaidLeaveDays = 0
  if (input.leaveOverride) {
    paidLeaveDays = input.leaveOverride.paidDays
    unpaidLeaveDays = input.leaveOverride.unpaidDays
  } else {
    for (const l of input.leave) {
      if (!l.isApproved) continue
      const days = countDaysInPeriod(
        l.startDate,
        l.endDate,
        input.periodStart,
        input.periodEnd,
        l.halfDayStart,
        l.halfDayEnd,
        l.totalDays
      )
      if (isUnpaidLeave(l.leaveType)) unpaidLeaveDays += days
      else paidLeaveDays += days
    }
  }

  const paidLeaveOnlyDays = input.leaveOverride
    ? input.leaveOverride.paidDays
    : countLeaveOnlyDays(input.leave, input.periodStart, input.periodEnd, sessionDates, absentDates, false)
  const overlapLeaveDays = input.leaveOverride
    ? 0
    : countOverlapLeaveDays(input.leave, input.periodStart, input.periodEnd, sessionDates, false)
  const absentDays = input.absentDaysOverride ?? absentDates.size

  const holidaysInPeriod = policy.publicHolidays.filter(
    h => h >= input.periodStart && h <= input.periodEnd && !sessionDates.has(h) && !absentDates.has(h)
  )

  const earnings: PayrollLineItem[] = []
  let regularPay = 0
  let regularHours = 0
  let baseSalary = 0

  switch (payBasis) {
    case 'monthly_salary': {
      const payFullSalary =
        Boolean(overrides.payFullBaseSalary) || emp.payFullMonthlySalary || policy.payFullSalaryForMidMonthJoiners
      const salaryFactor = payFullSalary
        ? 1.0
        : monthlySalaryFactor(input.periodStart, input.periodEnd, emp.employmentDate, emp.terminationDate)
      if (salaryFactor <= 0) return null

      baseSalary = emp.monthlySalary * salaryFactor
      regularPay = baseSalary
      regularHours = workingDays * input.dailyHours
      const salaryLabel = payFullSalary
        ? 'Base salary (full month)'
        : salaryFactor < 1.0
          ? 'Base salary (pro-rated for join/leave)'
          : 'Base salary'
      earnings.push({ label: salaryLabel, amount: baseSalary })
      break
    }

    case 'daily': {
      const paidDays = workingDays + paidLeaveOnlyDays + overlapLeaveDays
      regularHours = paidDays * input.dailyHours
      regularPay = paidDays * dailyRate
      if (workingDays > 0) earnings.push({ label: 'Days worked', amount: workingDays * dailyRate })
      if (paidLeaveOnlyDays + overlapLeaveDays > 0) {
        earnings.push({ label: 'Paid leave (daily)', amount: (paidLeaveOnlyDays + overlapLeaveDays) * dailyRate })
      }
      break
    }

    default: {
      const workedHours = closedSessions.reduce((s, x) => s + x.regularHours, 0)
      const leaveHours = (paidLeaveOnlyDays + overlapLeaveDays) * input.dailyHours
      regularHours = workedHours + leaveHours
      regularPay = regularHours * hourlyRate
      if (workedHours > 0) earnings.push({ label: 'Regular hours', amount: workedHours * hourlyRate })
      if (leaveHours > 0) earnings.push({ label: 'Paid leave', amount: leaveHours * hourlyRate })
      break
    }
  }

  regularPay = addPublicHolidayEarnings(
    earnings,
    regularPay,
    payBasis,
    holidaysInPeriod,
    dailyRate,
    hourlyRate,
    input.dailyHours,
    policy
  )

  const overtimePay = overtimeHours * hourlyRate * otMultiplier
  if (overtimePay > 0) earnings.push({ label: 'Overtime', amount: overtimePay })

  const bonusAmount = overrides.bonusAmount ?? 0
  if (bonusAmount > 0) {
    earnings.push({ label: overrides.bonusNote?.trim() ? overrides.bonusNote : 'Bonus', amount: bonusAmount })
  }

  let unpaidLeaveDeduction = 0
  if (unpaidLeaveDays > 0 && payBasis === 'monthly_salary' && !overrides.waivePenalties) {
    unpaidLeaveDeduction = unpaidLeaveDays * dailyRate
    regularPay = Math.max(0, regularPay - unpaidLeaveDeduction)
  }

  const grossPay = regularPay + overtimePay + bonusAmount

  const deductions: PayrollLineItem[] = []
  if (unpaidLeaveDeduction > 0) {
    deductions.push({ label: `Unpaid leave (${unpaidLeaveDays.toFixed(1)} day(s))`, amount: unpaidLeaveDeduction })
  }
  if (!overrides.waivePenalties) {
    addAttendancePenalties(deductions, policy, payBasis, absentDays, lateCount, earlyCount, hourlyRate, dailyRate)
  }

  addFixedEmployeeDeductions(deductions, emp)

  const manualAdjustment = overrides.manualAdjustment ?? 0
  if (manualAdjustment > 0) {
    const label = overrides.adjustmentNote?.trim() ? overrides.adjustmentNote : 'Manual adjustment'
    deductions.push({ label, amount: manualAdjustment })
  }

  if (!isContractor) {
    const { year, month } = yearMonthOf(input.periodEnd)
    const periodDays = dayNumber(input.periodEnd) - dayNumber(input.periodStart) + 1
    const statutoryFactor =
      payBasis === 'monthly_salary'
        ? monthlySalaryFactor(input.periodStart, input.periodEnd, emp.employmentDate, emp.terminationDate)
        : periodDays / daysInMonth(year, month)
    addStatutoryDeductions(deductions, policy, emp, grossPay, statutoryFactor, overrides)
  }

  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0)
  const netPay = Math.max(0, grossPay - totalDeductions)

  const noteParts: string[] = []
  if (
    payBasis === 'monthly_salary' &&
    !overrides.payFullBaseSalary &&
    !emp.payFullMonthlySalary &&
    !policy.payFullSalaryForMidMonthJoiners
  ) {
    const sf = monthlySalaryFactor(input.periodStart, input.periodEnd, emp.employmentDate, emp.terminationDate)
    if (sf < 1.0) noteParts.push('pro-rated for join/leave dates')
  } else if (overrides.payFullBaseSalary || emp.payFullMonthlySalary || policy.payFullSalaryForMidMonthJoiners) {
    if (payBasis === 'monthly_salary') noteParts.push('full monthly salary')
  } else if (proRate < 1.0 && !overrides.payFullBaseSalary) {
    noteParts.push('pro-rated for join/leave dates')
  }
  if (lateCount > 0) noteParts.push(`${lateCount} late arrival${lateCount > 1 ? 's' : ''}`)
  if (earlyCount > 0) noteParts.push(`${earlyCount} early departure${earlyCount > 1 ? 's' : ''}`)
  if (absentDays > 0) noteParts.push(`${absentDays} absent day${absentDays > 1 ? 's' : ''}`)
  if (unpaidLeaveDays > 0) noteParts.push(`${unpaidLeaveDays.toFixed(1)} unpaid leave day(s)`)
  if (paidLeaveDays > 0) noteParts.push(`${paidLeaveDays.toFixed(1)} paid leave day(s)`)
  if (holidaysInPeriod.length > 0) noteParts.push(`${holidaysInPeriod.length} public holiday(s)`)
  if (overrides.payFullBaseSalary) noteParts.push('full base salary override')
  if (overrides.waivePenalties) noteParts.push('penalties waived')
  if (bonusAmount > 0) noteParts.push('bonus included')

  const result: CalculationResult = {
    payBasis,
    baseSalary,
    workingDays,
    leaveDays: round2(paidLeaveDays),
    absentDays,
    unpaidLeaveDays: round2(unpaidLeaveDays),
    regularHours,
    overtimeHours,
    regularPay,
    overtimePay,
    grossPay,
    totalDeductions,
    netPay,
    lateCount,
    earlyCount,
    earningsLines: earnings,
    deductionLines: deductions,
    notes: noteParts.length > 0 ? noteParts.join(', ') : null,
  }

  const ytdTotals = input.priorYtd
    ? mergeYtd(input.priorYtd, {
        grossPay: result.grossPay,
        netPay: result.netPay,
        totalDeductions: result.totalDeductions,
        deductionLines: result.deductionLines,
      })
    : null

  return { ...result, ytdTotals }
}

export function buildPolicyFromSettings(settings: {
  payroll_default_pay_basis: string
  allow_overtime_for_salary: boolean
  pay_full_salary_for_mid_month_joiners: boolean
  pay_salary_on_public_holidays: boolean
  pay_hourly_on_public_holidays: boolean
  deduct_absent_from_pay: boolean
  salary_ignore_attendance_deductions: boolean
  absent_penalty_mode: string
  absent_penalty_threshold: number
  absent_penalty_deduct_days: number
  late_penalty_mode: string
  late_penalty_threshold: number
  late_penalty_deduct_hours: number
  early_penalty_mode: string
  early_penalty_threshold: number
  early_penalty_deduct_hours: number
  uif_enabled: boolean
  uif_rate_percent: number
  uif_ceiling_monthly: number
  paye_enabled: boolean
  default_paye_rate_percent: number
  use_sars_tax_tables: boolean
  public_holidays_text: string
}): Policy {
  const normalizeBasis = (raw: string): PayBasis => {
    const s = raw.toLowerCase()
    if (s.includes('hour')) return 'hourly'
    if (s.includes('day')) return 'daily'
    return 'monthly_salary'
  }
  const normalizeMode = (raw: string): PenaltyMode =>
    raw === 'per_day' || raw === 'per_occurrence' || raw === 'threshold' ? raw : 'none'

  let absentMode = normalizeMode(settings.absent_penalty_mode)
  if (absentMode === 'none' && settings.deduct_absent_from_pay) absentMode = 'per_day'

  return {
    defaultPayBasis: normalizeBasis(settings.payroll_default_pay_basis),
    salaryIgnoreAttendanceDeductions: settings.salary_ignore_attendance_deductions,
    absentPenalty: {
      mode: absentMode,
      thresholdCount: settings.absent_penalty_threshold,
      deductDays: settings.absent_penalty_deduct_days,
      deductHours: 0,
      applyTo: 'all',
    },
    latePenalty: {
      mode: normalizeMode(settings.late_penalty_mode),
      thresholdCount: settings.late_penalty_threshold,
      deductDays: 0,
      deductHours: settings.late_penalty_deduct_hours,
      applyTo: 'all',
    },
    earlyPenalty: {
      mode: normalizeMode(settings.early_penalty_mode),
      thresholdCount: settings.early_penalty_threshold,
      deductDays: 0,
      deductHours: settings.early_penalty_deduct_hours,
      applyTo: 'all',
    },
    statutory: {
      uifEnabled: settings.uif_enabled,
      uifRatePercent: settings.uif_rate_percent,
      uifCeilingMonthly: settings.uif_ceiling_monthly,
      payeEnabled: settings.paye_enabled,
      defaultPayeRatePercent: settings.default_paye_rate_percent,
      useSarsTaxTables: settings.use_sars_tax_tables,
    },
    allowOvertimeForSalary: settings.allow_overtime_for_salary,
    paySalaryOnPublicHolidays: settings.pay_salary_on_public_holidays,
    payHourlyOnPublicHolidays: settings.pay_hourly_on_public_holidays,
    payFullSalaryForMidMonthJoiners: settings.pay_full_salary_for_mid_month_joiners,
    publicHolidays: parsePublicHolidays(settings.public_holidays_text ?? ''),
  }
}

function parsePublicHolidays(text: string): ISODate[] {
  return text
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
}
