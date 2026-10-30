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
  refreshCount: number
  notInPeriodCount: number
  contractorCount: number
  companyHasDefaultTemplate: boolean
  detailLines: string[]
}

function hasPayRate(emp: Pick<PayrollEmployeeLike, 'monthly_salary' | 'hourly_rate' | 'daily_rate'>): boolean {
  return (emp.monthly_salary ?? 0) > 0 || (emp.hourly_rate ?? 0) > 0 || (emp.daily_rate ?? 0) > 0
}

function hasBanking(emp: PayrollEmployeeLike): boolean {
  return Boolean(emp.bank_name?.trim() && emp.bank_account?.trim())
}

export function assessPayrollReadiness(
  emp: PayrollEmployeeLike,
  options?: { companyHasDefaultTemplate?: boolean }
): PayrollReadinessInfo {
  const issues: string[] = []

  if (!emp.is_active) issues.push('Employee is inactive')
  if (!hasPayRate(emp)) issues.push('No monthly salary or hourly/daily rate')
  if (!emp.shift_template_id && !options?.companyHasDefaultTemplate) {
    issues.push('No shift template, and the company has no default template')
  }
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

/** An active employee whose employment overlaps this month, whether or not they have a payslip. */
export function isOnPayrollRoster(
  emp: Pick<PayrollEmployeeLike, 'is_active' | 'worker_type' | 'employment_date' | 'termination_date'>,
  periodStart: string,
  periodEnd: string
): boolean {
  if (!emp.is_active) return false
  if (emp.worker_type === 'contractor' || emp.worker_type === 'subcontractor') return false
  if (emp.employment_date && emp.employment_date > periodEnd) return false
  if (emp.termination_date && emp.termination_date < periodStart) return false
  return true
}

export function payrollRosterGap(emp: Pick<PayrollEmployeeLike, 'monthly_salary' | 'hourly_rate' | 'daily_rate'>): string {
  return hasPayRate(emp)
    ? 'No payslip yet. Press Update payslips.'
    : 'No pay rate, so Update payslips leaves this person off.'
}

export function buildPayrollGeneratePreview(
  employees: PayrollEmployeeLike[],
  periodStart: string,
  periodEnd: string,
  existingEmployeeIds: Set<string>,
  options?: { companyHasDefaultTemplate?: boolean; lockedEmployeeIds?: Set<string> }
): PayrollGeneratePreview {
  const companyHasDefaultTemplate = Boolean(options?.companyHasDefaultTemplate)
  const lockedEmployeeIds = options?.lockedEmployeeIds ?? new Set<string>()
  let ready = 0
  let missingRates = 0
  let missingShift = 0
  let missingBank = 0
  let duplicate = 0
  let refresh = 0
  let notInPeriod = 0
  let contractor = 0
  const details: string[] = []

  for (const emp of employees.filter(e => e.is_active)) {
    if (!isEligibleForPeriod(emp, periodStart, periodEnd)) {
      notInPeriod++
      if (isOnPayrollRoster(emp, periodStart, periodEnd) && !hasPayRate(emp)) {
        missingRates++
        details.push(`${emp.name} ${emp.surname}: no pay rate, so no payslip is created`)
      }
      continue
    }
    if (lockedEmployeeIds.has(emp.id)) {
      duplicate++
      details.push(`${emp.name} ${emp.surname}: approved payslip for this month is left as it is`)
      continue
    }
    if (existingEmployeeIds.has(emp.id)) refresh++

    const info = assessPayrollReadiness(emp, { companyHasDefaultTemplate })
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
    refreshCount: refresh,
    notInPeriodCount: notInPeriod,
    contractorCount: contractor,
    companyHasDefaultTemplate,
    detailLines: details,
  }
}
