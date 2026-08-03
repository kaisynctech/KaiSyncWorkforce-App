/**
 * Build an employees INSERT payload that matches the live NOT NULL schema.
 *
 * Critical: Postgres does NOT apply column DEFAULTs when the client sends
 * explicit null. Empty optional money fields must be 0, not null.
 */

export type EmployeeCreateInput = {
  companyId: string
  name: string
  surname: string
  email?: string | null
  phone?: string | null
  idNumber?: string | null
  position?: string | null
  department?: string | null
  branchId?: string | null
  shiftTemplateId?: string | null
  employmentType: string
  workerType: string
  accessLevel: string
  managerId?: string | null
  employmentDate?: string | null
  monthlySalary?: number | null
  payByHour?: boolean
  payBasis?: string | null
  payeRatePercent?: number | null
  uifExempt?: boolean
  medicalAidDeduction?: number | null
  pensionDeduction?: number | null
  unionDeduction?: number | null
  workDaysWeekly?: number | null
  dailyHours?: number | null
  hourlyRate?: number | null
  dailyRate?: number | null
  bankName?: string | null
  bankAccount?: string | null
  bankBranchCode?: string | null
  accountType?: string | null
}

function numOrZero(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0
  return value
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

/** Payload keys are live DB column names only. */
export function buildEmployeeCreatePayload(input: EmployeeCreateInput): Record<string, unknown> {
  const workDaysWeekly = numOrZero(input.workDaysWeekly) || 5
  const dailyHours = numOrZero(input.dailyHours) || 8
  const monthlySalary = numOrZero(input.monthlySalary)
  const dailyRate = numOrZero(input.dailyRate)
  const hourlyRate = numOrZero(input.hourlyRate)

  return {
    company_id: input.companyId,
    name: input.name.trim(),
    surname: input.surname.trim(),
    email: emptyToNull(input.email),
    phone: emptyToNull(input.phone),
    id_number: emptyToNull(input.idNumber),
    position: emptyToNull(input.position),
    department: emptyToNull(input.department),
    branch_id: emptyToNull(input.branchId),
    shift_template_id: emptyToNull(input.shiftTemplateId),
    employment_type: input.employmentType,
    worker_type: input.workerType,
    access_level: input.accessLevel || 'employee',
    manager_id: emptyToNull(input.managerId),
    employment_date: emptyToNull(input.employmentDate),

    // NOT NULL numerics — never send null
    monthly_salary: monthlySalary,
    hourly_rate: hourlyRate,
    daily_rate: dailyRate,
    weekly_rate: 0,
    overtime_rate: 0,
    double_time_rate: 0,
    work_days_weekly: workDaysWeekly,
    daily_hours: dailyHours,
    medical_aid_deduction: numOrZero(input.medicalAidDeduction),
    pension_deduction: numOrZero(input.pensionDeduction),
    union_deduction: numOrZero(input.unionDeduction),
    paye_fixed_amount: 0,
    uif_fixed_amount: 0,

    pay_by_hour: Boolean(input.payByHour),
    pay_basis: input.payByHour ? (input.payBasis || 'hourly') : null,
    paye_rate_percent: input.payeRatePercent ?? null,
    uif_exempt: Boolean(input.uifExempt),
    pay_full_monthly_salary: false,

    bank_name: emptyToNull(input.bankName),
    bank_account: emptyToNull(input.bankAccount),
    bank_branch_code: emptyToNull(input.bankBranchCode),
    account_type: emptyToNull(input.accountType),

    is_active: true,
    registration_status: 'active',
    pin_reset_required: false,
    pin_failed_attempts: 0,
    login_failed_attempts: 0,
    is_account_locked: false,
  }
}
