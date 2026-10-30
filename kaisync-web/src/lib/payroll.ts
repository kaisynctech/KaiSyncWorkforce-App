/**
 * Shared Payroll API for the HR web app.
 * Approve/reject use live RPCs; release updates shared_with_employee;
 * generate/recalculate call the `payroll-generate-v2` Edge Function, which runs the
 * SAME calculation engine (`supabase/functions/_shared/payroll/*`, mirrored from
 * `kaisync-web/src/lib/payroll/*`) server-side — persisted pay is never
 * browser-authoritative. See docs/modules/payroll-web-program.md.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PayslipOverrides } from '@/lib/payroll-engine'
import {
  buildPayrollGeneratePreview,
  type PayrollGeneratePreview,
  type PayrollEmployeeLike,
} from '@/lib/payroll-readiness'
import { executeWithStepUp, isStepUpRequiredMessage } from '@/lib/step-up'
import { calendarMonthBounds } from '@/lib/payroll/period'

export type PayrollResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export function formatPayrollActionError(message: string): string {
  const m = message.toLowerCase()
  if (isStepUpRequiredMessage(message)) {
    return 'Step-up verification is required before approving payments. Re-enter your password when prompted.'
  }
  if (m.includes('insufficient') || m.includes('permission') || m.includes('not authorized')) {
    return 'You do not have permission to perform this payroll action.'
  }
  return message
}

export type ApproveOptions = {
  /** When set, STEP_UP_REQUIRED triggers password re-auth + hr_confirm_step_up . */
  promptPassword?: () => Promise<string | null>
}

export async function approvePaymentRun(
  supabase: SupabaseClient,
  companyId: string,
  paymentApprovalId: string,
  options?: ApproveOptions
): Promise<PayrollResult<void>> {
  const run = async (): Promise<PayrollResult<void>> => {
    const { error } = await supabase.rpc('approve_payment_run', {
      p_company_id: companyId,
      p_payment_approval_id: paymentApprovalId,
    })
    if (error) return { ok: false, message: formatPayrollActionError(error.message) }
    return { ok: true, data: undefined }
  }

  if (!options?.promptPassword) return run()

  return executeWithStepUp(supabase, companyId, run, options.promptPassword)
}

export async function rejectPaymentRun(
  supabase: SupabaseClient,
  companyId: string,
  paymentApprovalId: string
): Promise<PayrollResult<void>> {
  const { error } = await supabase.rpc('reject_payment_run', {
    p_company_id: companyId,
    p_payment_approval_id: paymentApprovalId,
  })
  if (error) return { ok: false, message: formatPayrollActionError(error.message) }
  return { ok: true, data: undefined }
}

/** no release RPC; update column. */
export async function releasePayslipToEmployee(
  supabase: SupabaseClient,
  companyId: string,
  paymentApprovalId: string
): Promise<PayrollResult<void>> {
  const { data: row, error: readErr } = await supabase
    .from('payment_approvals')
    .select('id, status, shared_with_employee, audit_log')
    .eq('id', paymentApprovalId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (readErr) return { ok: false, message: readErr.message }
  if (!row) return { ok: false, message: 'Payslip not found.' }
  if (row.status !== 'approved' && row.status !== 'paid') {
    return { ok: false, message: 'Only approved payslips can be released to employees.' }
  }
  if (row.shared_with_employee) return { ok: true, data: undefined }

  const audit = Array.isArray(row.audit_log) ? [...row.audit_log] : []
  audit.push({
    action: 'released',
    detail: 'Shared with employee',
    at: new Date().toISOString(),
  })

  const { error } = await supabase
    .from('payment_approvals')
    .update({
      shared_with_employee: true,
      audit_log: audit,
    })
    .eq('id', paymentApprovalId)
    .eq('company_id', companyId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

export async function lockPayrollPeriod(
  supabase: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollResult<void>> {
  const { error } = await supabase.rpc('hr_lock_payroll_period', {
    p_company_id: companyId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

export async function unlockPayrollPeriod(
  supabase: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollResult<void>> {
  const { error } = await supabase.rpc('hr_unlock_payroll_period', {
    p_company_id: companyId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

const EMP_SELECT =
  'id, name, surname, is_active, monthly_salary, hourly_rate, daily_rate, daily_hours, pay_by_hour, pay_basis, uif_exempt, paye_rate_percent, paye_fixed_amount, uif_rate_percent, uif_fixed_amount, medical_aid_deduction, pension_deduction, union_deduction, department, cost_center, branch, worker_type, shift_template_id, bank_name, bank_account, bank_branch_code, employment_date, termination_date, date_of_birth, tax_directive_rate_percent, pay_full_monthly_salary, overtime_rate, work_days_weekly, account_type, tax_number'

export async function previewPayrollGenerate(
  supabase: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollResult<PayrollGeneratePreview>> {
  const month = calendarMonthBounds(periodStart)
  const [{ data: emps, error: empErr }, { data: existing, error: existErr }, { count: defaultCount, error: defaultErr }] = await Promise.all([
    supabase.from('employees').select(EMP_SELECT).eq('company_id', companyId).eq('is_active', true),
    supabase
      .from('payment_approvals')
      .select('employee_id, status')
      .eq('company_id', companyId)
      .gte('period_start', month.start)
      .lte('period_start', month.end)
      .neq('status', 'rejected'),
    supabase
      .from('employee_shift_templates')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_default', true),
  ])
  if (empErr) return { ok: false, message: empErr.message }
  if (existErr) return { ok: false, message: existErr.message }
  if (defaultErr) return { ok: false, message: defaultErr.message }

  const pendingIds = new Set(
    (existing ?? []).filter(r => r.status === 'pending').map(r => r.employee_id as string)
  )
  const lockedIds = new Set(
    (existing ?? []).filter(r => r.status !== 'pending').map(r => r.employee_id as string)
  )
  return {
    ok: true,
    data: buildPayrollGeneratePreview(
      (emps ?? []) as PayrollEmployeeLike[],
      month.start,
      month.end,
      pendingIds,
      { companyHasDefaultTemplate: (defaultCount ?? 0) > 0, lockedEmployeeIds: lockedIds }
    ),
  }
}

type PayrollGenerateFunctionBody = {
  company_id: string
  action: 'generate' | 'recalculate' | 'save_lines'
  period_start?: string
  period_end?: string
  payment_id?: string
  offset?: number
  limit?: number
  only_missing?: boolean
  lines?: Record<string, unknown>
  overrides?: {
    payFullBaseSalary?: boolean
    waivePenalties?: boolean
    manualPayeOverride?: number | null
    manualAdjustment?: number | null
    adjustmentNote?: string | null
    bonusAmount?: number | null
    bonusNote?: string | null
  }
}

/**
 * Calls the payroll Edge Function — the server-side source of truth for
 * payroll math (same engine as web, run with the service role so persisted
 * `payment_approvals` rows can't be forged from the browser). Never falls back to a
 * client-side calculation: if the function is unreachable or errors, the caller must
 * see a clear failure rather than a silently different (browser-computed) payslip.
 */
/**
 * W5: payroll-generate-v2 works in chunks (with the payslip deduction fixes). The live site keeps
 * using payroll-generate until this code goes live, so the two never mix.
 */
const PAYROLL_FUNCTION = 'payroll-generate-v2'

async function callPayrollGenerateFunction(
  supabase: SupabaseClient,
  body: PayrollGenerateFunctionBody
): Promise<PayrollResult<Record<string, unknown>>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    return { ok: false, message: 'Payroll server is not configured (missing NEXT_PUBLIC_SUPABASE_URL).' }
  }

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) return { ok: false, message: sessionErr.message }
  const token = sessionData.session?.access_token
  if (!token) return { ok: false, message: 'Not signed in.' }

  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/${PAYROLL_FUNCTION}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach the payroll server: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = await res.json()
  } catch {
    return { ok: false, message: `Payroll server returned an unexpected response (status ${res.status}).` }
  }

  if (!res.ok || payload.ok === false) {
    const message = (payload.error as string) ?? (payload.message as string) ?? `Payroll server error (status ${res.status}).`
    return { ok: false, message: formatPayrollActionError(message) }
  }

  return { ok: true, data: payload }
}

export type PayrollGenerateProgress = { done: number; total: number }

/**
 * Creates or updates the month's payslips, a chunk of people at a time, so a company of any
 * size finishes (one call per chunk stays well inside the server time limit).
 */
export async function generatePayrollPeriod(
  supabase: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string,
  onProgress?: (progress: PayrollGenerateProgress) => void,
  options?: { onlyMissing?: boolean }
): Promise<PayrollResult<{ generated: number; updated: number; skipped: number; errors: string[] }>> {
  let generated = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []
  let offset: number | null = 0
  let guard = 0
  while (offset !== null && guard++ < 1000) {
    const result = await callPayrollGenerateFunction(supabase, {
      company_id: companyId,
      action: 'generate',
      period_start: periodStart,
      period_end: periodEnd,
      offset,
      limit: 150,
      only_missing: options?.onlyMissing === true,
    })
    if (!result.ok) {
      if (generated + updated === 0) return result
      errors.push(result.message)
      break
    }
    generated += Number(result.data.generated ?? 0)
    updated += Number(result.data.updated ?? 0)
    skipped += Number(result.data.skipped ?? 0)
    if (Array.isArray(result.data.errors)) errors.push(...(result.data.errors as string[]))
    const total = Number(result.data.total ?? 0)
    const processed = Number(result.data.processed ?? total)
    onProgress?.({ done: Math.min(processed, total), total })
    const next = result.data.next_offset
    offset = typeof next === 'number' && next > offset ? next : null
  }
  return { ok: true, data: { generated, updated, skipped, errors } }
}

/** After pay or bank details change on the employee, refresh this month's pending payslip from that record. */
export async function refreshCurrentPendingPayslip(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
): Promise<void> {
  const today = new Date()
  const month = calendarMonthBounds(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`)
  const { data, error } = await supabase
    .from('payment_approvals')
    .select('id')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .gte('period_start', month.start)
    .lte('period_start', month.end)
    .limit(1)
    .maybeSingle()
  if (error || !data?.id) return
  await recalculatePayslip(supabase, companyId, data.id)
}

export async function recalculatePayslip(
  supabase: SupabaseClient,
  companyId: string,
  paymentId: string,
  overrides?: PayslipOverrides
): Promise<PayrollResult<void>> {
  const result = await callPayrollGenerateFunction(supabase, {
    company_id: companyId,
    action: 'recalculate',
    payment_id: paymentId,
    overrides: overrides
      ? {
          payFullBaseSalary: overrides.payFullBaseSalary,
          waivePenalties: overrides.waivePenalties,
          manualPayeOverride: overrides.manualPayeOverride,
          manualAdjustment: overrides.manualAdjustment,
          adjustmentNote: overrides.adjustmentNote,
          bonusAmount: overrides.bonusAmount,
          bonusNote: overrides.bonusNote,
        }
      : undefined,
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export type PayslipLineAmounts = {
  regular: number
  overtime: number
  bonus: number
  incentive: number
  refund: number
  uif: number
  paye: number
  loanDeduction: number
  loanBalance: number
  unpaidLeave: number
  /** Absent dates in this month that are not paid. */
  unpaidAbsenceDates?: string[]
  /** Overtime days where lateness is taken off that day's overtime. */
  overtimeLateOffsetDates?: string[]
  extraEarnings?: { id: string; label: string; amount: number }[]
  extraDeductions?: { id: string; label: string; amount: number }[]
  meibcApplied?: boolean
  /** The employee's own medical aid / pension / union lines are already on this payslip. */
  employeeDeductionsApplied?: boolean
}

export async function savePayslipLines(
  supabase: SupabaseClient,
  companyId: string,
  paymentId: string,
  lines: PayslipLineAmounts,
  flags: { payFullBaseSalary: boolean; waivePenalties: boolean }
): Promise<PayrollResult<{ gross_pay: number; deductions: number; net_pay: number }>> {
  const result = await callPayrollGenerateFunction(supabase, {
    company_id: companyId,
    action: 'save_lines',
    payment_id: paymentId,
    lines,
    overrides: {
      payFullBaseSalary: flags.payFullBaseSalary,
      waivePenalties: flags.waivePenalties,
    },
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: {
      gross_pay: Number(result.data.gross_pay ?? 0),
      deductions: Number(result.data.deductions ?? 0),
      net_pay: Number(result.data.net_pay ?? 0),
    },
  }
}
