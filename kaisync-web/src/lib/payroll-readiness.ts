/**
 * Payroll readiness — ports KaiFlow.Timesheets.Maui/Helpers/PayrollReadiness.cs
 */

export type PayrollEmployeeLike = {
  id: string
  name: string
  surname: string
  is_active: boolean
  monthly_salary?: number | null
  hourly_rate?: number | null
  daily_rate?: number | null
  shift_template_id?: string | null
  bank_name?: string | null
  bank_account?: string | null
  worker_type?: string | null
  employment_date?: string | null
  termination_date?: string | null
}

export type PayrollReadinessInfo = {
  isReady: boolean
  statusLabel: string
  issues: string[]
}

export type PayrollGeneratePreview = {
  readyCount: number
  missingRatesCount: number
  missingShiftCount: number
  missingBankCount: number
  duplicateCount: number
  notInPeriodCount: number
  contractorCount: number
  detailLines: string[]
}

function hasPayRate(emp: PayrollEmployeeLike): boolean {
  return (emp.monthly_salary ?? 0) > 0 || (emp.hourly_rate ?? 0) > 0 || (emp.daily_rate ?? 0) > 0
}

function hasBanking(emp: PayrollEmployeeLike): boolean {
  return Boolean(emp.bank_name?.trim() && emp.bank_account?.trim())
}

export function assessPayrollReadiness(emp: PayrollEmployeeLike): PayrollReadinessInfo {
  const issues: string[] = []

  if (!emp.is_active) issues.push('Employee is inactive')
  if (!hasPayRate(emp)) issues.push('No monthly salary or hourly/daily rate')
  if (!emp.shift_template_id) issues.push('No shift template — grace period and OT may not apply')
  if (!hasBanking(emp)) issues.push('Banking details not set')
  if (emp.worker_type === 'contractor' || emp.worker_type === 'subcontractor') {
    issues.push('Contractor — review statutory deductions')
  }

  if (issues.length === 0) {
    return { isReady: true, statusLabel: 'Payroll ready', issues }
  }
  if (issues.some(i => i.includes('salary') || i.includes('rate'))) {
    return { isReady: false, statusLabel: 'Missing pay rates', issues }
  }
  return { isReady: false, statusLabel: 'Needs attention', issues }
}

export function isEligibleForPayroll(emp: PayrollEmployeeLike): boolean {
  return emp.is_active && hasPayRate(emp)
}

export function isEligibleForPeriod(
  emp: PayrollEmployeeLike,
  periodStart: string,
  periodEnd: string
): boolean {
  if (!isEligibleForPayroll(emp)) return false
  if (emp.employment_date && emp.employment_date > periodEnd) return false
  if (emp.termination_date && emp.termination_date < periodStart) return false
  return true
}

export function buildPayrollGeneratePreview(
  employees: PayrollEmployeeLike[],
  periodStart: string,
  periodEnd: string,
  existingEmployeeIds: Set<string>
): PayrollGeneratePreview {
  let ready = 0
  let missingRates = 0
  let missingShift = 0
  let missingBank = 0
  let duplicate = 0
  let notInPeriod = 0
  let contractor = 0
  const details: string[] = []

  for (const emp of employees.filter(e => e.is_active)) {
    if (!isEligibleForPeriod(emp, periodStart, periodEnd)) {
      notInPeriod++
      continue
    }
    if (existingEmployeeIds.has(emp.id)) {
      duplicate++
      details.push(`${emp.name} ${emp.surname}: payslip already exists for this period`)
      continue
    }

    const info = assessPayrollReadiness(emp)
    if (!hasPayRate(emp)) missingRates++
    if (!emp.shift_template_id) missingShift++
    if (!hasBanking(emp)) missingBank++
    if (emp.worker_type === 'contractor' || emp.worker_type === 'subcontractor') contractor++

    if (info.isReady || hasPayRate(emp)) ready++
    else details.push(`${emp.name} ${emp.surname}: ${info.issues.join(', ')}`)
  }

  return {
    readyCount: ready,
    missingRatesCount: missingRates,
    missingShiftCount: missingShift,
    missingBankCount: missingBank,
    duplicateCount: duplicate,
    notInPeriodCount: notInPeriod,
    contractorCount: contractor,
    detailLines: details,
  }
}
