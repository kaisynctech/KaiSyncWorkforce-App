/**
 * Shared Payroll API for the HR web app.
 * Approve/reject use live RPCs; release updates shared_with_employee;
 * generate uses prefs-aware client engine (not SQL stub alone).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  calculatePayslip,
  type EngineEmployee,
  type PunchLike,
  type PayslipOverrides,
} from '@/lib/payroll-engine'
import {
  buildPayrollGeneratePreview,
  isEligibleForPeriod,
  type PayrollGeneratePreview,
  type PayrollEmployeeLike,
} from '@/lib/payroll-readiness'
import { loadPayrollSettings } from '@/lib/payroll-settings'
import type { PayrollSettings } from '@/types/database'

export type PayrollResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export function formatPayrollActionError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('step_up') || m.includes('step-up') || m.includes('step up')) {
    return 'Step-up verification is required before approving payments. Complete step-up in Settings security, then try again.'
  }
  if (m.includes('insufficient') || m.includes('permission') || m.includes('not authorized')) {
    return 'You do not have permission to perform this payroll action.'
  }
  return message
}

export async function approvePaymentRun(
  supabase: SupabaseClient,
  companyId: string,
  paymentApprovalId: string
): Promise<PayrollResult<void>> {
  const { error } = await supabase.rpc('approve_payment_run', {
    p_company_id: companyId,
    p_payment_approval_id: paymentApprovalId,
  })
  if (error) return { ok: false, message: formatPayrollActionError(error.message) }
  return { ok: true, data: undefined }
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

/** MAUI SharePayslipWithEmployeeAsync — no release RPC; update column. */
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
  'id, name, surname, is_active, monthly_salary, hourly_rate, daily_rate, daily_hours, pay_by_hour, pay_basis, uif_exempt, paye_rate_percent, medical_aid_deduction, pension_deduction, union_deduction, department, cost_center, branch, worker_type, shift_template_id, bank_name, bank_account, employment_date, account_type'

export async function previewPayrollGenerate(
  supabase: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollResult<PayrollGeneratePreview>> {
  const [{ data: emps, error: empErr }, { data: existing, error: existErr }] = await Promise.all([
    supabase.from('employees').select(EMP_SELECT).eq('company_id', companyId).eq('is_active', true),
    supabase
      .from('payment_approvals')
      .select('employee_id')
      .eq('company_id', companyId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd),
  ])
  if (empErr) return { ok: false, message: empErr.message }
  if (existErr) return { ok: false, message: existErr.message }

  const existingIds = new Set((existing ?? []).map(r => r.employee_id as string))
  return {
    ok: true,
    data: buildPayrollGeneratePreview(
      (emps ?? []) as PayrollEmployeeLike[],
      periodStart,
      periodEnd,
      existingIds
    ),
  }
}

async function loadLeaveDaysInPeriod(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ paid: number; unpaid: number }> {
  const { data } = await supabase
    .from('leave_requests')
    .select('leave_type, start_date, end_date, total_days, half_day_start, half_day_end')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart)

  let paid = 0
  let unpaid = 0
  for (const row of data ?? []) {
    const start = row.start_date > periodStart ? row.start_date : periodStart
    const end = row.end_date < periodEnd ? row.end_date : periodEnd
    const days =
      Math.max(
        0,
        Math.round(
          (new Date(end).getTime() - new Date(start).getTime()) / 86400000
        ) + 1
      )
    const type = (row.leave_type ?? '').toLowerCase()
    if (type.includes('unpaid')) unpaid += days
    else paid += days
  }
  return { paid, unpaid }
}

async function loadYtdPrior(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  periodStart: string
): Promise<{ gross_pay: number; paye: number; uif: number; net_pay: number }> {
  const year = periodStart.slice(0, 4)
  const { data } = await supabase
    .from('payment_approvals')
    .select('gross_pay, net_pay, deductions_breakdown, ytd_json')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .gte('period_start', `${year}-01-01`)
    .lt('period_start', periodStart)
    .in('status', ['approved', 'paid', 'pending'])

  let gross = 0
  let net = 0
  let paye = 0
  let uif = 0
  for (const row of data ?? []) {
    gross += Number(row.gross_pay ?? 0)
    net += Number(row.net_pay ?? 0)
    const lines = (row.deductions_breakdown ?? []) as { label?: string; amount?: number }[]
    for (const line of lines) {
      const label = (line.label ?? '').toLowerCase()
      if (label === 'paye') paye += Number(line.amount ?? 0)
      if (label === 'uif') uif += Number(line.amount ?? 0)
    }
  }
  return { gross_pay: gross, paye, uif, net_pay: net }
}

export async function generatePayrollPeriod(
  supabase: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollResult<{ generated: number; skipped: number; errors: string[] }>> {
  const settingsRes = await loadPayrollSettings(supabase, companyId)
  if (!settingsRes.ok) return { ok: false, message: settingsRes.message }
  const settings: PayrollSettings = settingsRes.settings

  const [{ data: emps, error: empErr }, { data: existing }, { data: punches, error: punchErr }] =
    await Promise.all([
      supabase.from('employees').select(EMP_SELECT).eq('company_id', companyId).eq('is_active', true),
      supabase
        .from('payment_approvals')
        .select('employee_id')
        .eq('company_id', companyId)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd),
      supabase
        .from('time_punches')
        .select('employee_id, type, date_time')
        .eq('company_id', companyId)
        .gte('date_time', `${periodStart}T00:00:00`)
        .lte('date_time', `${periodEnd}T23:59:59`),
    ])

  if (empErr) return { ok: false, message: empErr.message }
  if (punchErr) return { ok: false, message: punchErr.message }

  const existingIds = new Set((existing ?? []).map(r => r.employee_id as string))
  const punchRows = (punches ?? []) as PunchLike[]
  let generated = 0
  let skipped = 0
  const errors: string[] = []

  for (const raw of (emps ?? []) as (EngineEmployee & PayrollEmployeeLike)[]) {
    if (!isEligibleForPeriod(raw, periodStart, periodEnd)) {
      skipped++
      continue
    }
    if (existingIds.has(raw.id)) {
      skipped++
      continue
    }

    const leave = await loadLeaveDaysInPeriod(supabase, companyId, raw.id, periodStart, periodEnd)
    const ytdPrior = await loadYtdPrior(supabase, companyId, raw.id, periodStart)
    const slip = calculatePayslip({
      employee: raw,
      settings,
      punches: punchRows,
      periodStart,
      periodEnd,
      paidLeaveDays: leave.paid,
      unpaidLeaveDays: leave.unpaid,
      ytdPrior,
    })
    if (!slip) {
      skipped++
      continue
    }

    const { error: insertErr } = await supabase.from('payment_approvals').insert({
      company_id: companyId,
      employee_id: slip.employee_id,
      period_start: slip.period_start,
      period_end: slip.period_end,
      regular_hours: slip.regular_hours,
      overtime_hours: slip.overtime_hours,
      working_days: slip.working_days,
      leave_days: slip.leave_days,
      unpaid_leave_days: slip.unpaid_leave_days,
      absent_days: slip.absent_days,
      regular_pay: slip.regular_pay,
      overtime_pay: slip.overtime_pay,
      base_salary: slip.base_salary,
      gross_pay: slip.gross_pay,
      deductions: slip.deductions,
      net_pay: slip.net_pay,
      pay_basis: slip.pay_basis,
      branch_label: slip.branch_label,
      cost_center: slip.cost_center,
      earnings_breakdown: slip.earnings_breakdown,
      deductions_breakdown: slip.deductions_breakdown,
      policy_snapshot: slip.policy_snapshot,
      ytd_json: slip.ytd_json,
      audit_log: slip.audit_log,
      status: 'pending',
      shared_with_employee: false,
    })

    if (insertErr) {
      errors.push(`${raw.name} ${raw.surname}: ${insertErr.message}`)
    } else {
      generated++
    }
  }

  if (generated === 0 && errors.length > 0) {
    return { ok: false, message: errors[0] }
  }
  return { ok: true, data: { generated, skipped, errors } }
}

export async function recalculatePayslip(
  supabase: SupabaseClient,
  companyId: string,
  paymentId: string,
  overrides?: PayslipOverrides
): Promise<PayrollResult<void>> {
  const settingsRes = await loadPayrollSettings(supabase, companyId)
  if (!settingsRes.ok) return { ok: false, message: settingsRes.message }

  const { data: payment, error: payErr } = await supabase
    .from('payment_approvals')
    .select('*')
    .eq('id', paymentId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (payErr) return { ok: false, message: payErr.message }
  if (!payment) return { ok: false, message: 'Payslip not found.' }
  if (payment.status !== 'pending') {
    return { ok: false, message: 'Only pending payslips can be recalculated.' }
  }

  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select(EMP_SELECT)
    .eq('id', payment.employee_id)
    .maybeSingle()
  if (empErr) return { ok: false, message: empErr.message }
  if (!emp) return { ok: false, message: 'Employee not found.' }

  const { data: punches } = await supabase
    .from('time_punches')
    .select('employee_id, type, date_time')
    .eq('company_id', companyId)
    .eq('employee_id', payment.employee_id)
    .gte('date_time', `${payment.period_start}T00:00:00`)
    .lte('date_time', `${payment.period_end}T23:59:59`)

  const leave = await loadLeaveDaysInPeriod(
    supabase,
    companyId,
    payment.employee_id,
    payment.period_start,
    payment.period_end
  )
  const ytdPrior = await loadYtdPrior(
    supabase,
    companyId,
    payment.employee_id,
    payment.period_start
  )

  const mergedOverrides: PayslipOverrides = {
    payFullBaseSalary: overrides?.payFullBaseSalary ?? payment.pay_full_base_salary ?? false,
    waivePenalties: overrides?.waivePenalties ?? payment.waive_penalties ?? false,
    manualPayeOverride:
      overrides?.manualPayeOverride !== undefined
        ? overrides.manualPayeOverride
        : payment.manual_paye_override,
    manualAdjustment:
      overrides?.manualAdjustment !== undefined
        ? overrides.manualAdjustment
        : payment.manual_adjustment,
    bonusAmount:
      overrides?.bonusAmount !== undefined ? overrides.bonusAmount : payment.bonus_amount,
  }

  const slip = calculatePayslip({
    employee: emp as EngineEmployee,
    settings: settingsRes.settings,
    punches: (punches ?? []) as PunchLike[],
    periodStart: payment.period_start,
    periodEnd: payment.period_end,
    overrides: mergedOverrides,
    paidLeaveDays: leave.paid,
    unpaidLeaveDays: leave.unpaid,
    ytdPrior,
  })
  if (!slip) return { ok: false, message: 'Could not calculate payslip for this employee/period.' }

  const priorAudit = Array.isArray(payment.audit_log) ? payment.audit_log : []
  const { error: updErr } = await supabase
    .from('payment_approvals')
    .update({
      regular_hours: slip.regular_hours,
      overtime_hours: slip.overtime_hours,
      working_days: slip.working_days,
      leave_days: slip.leave_days,
      unpaid_leave_days: slip.unpaid_leave_days,
      absent_days: slip.absent_days,
      regular_pay: slip.regular_pay,
      overtime_pay: slip.overtime_pay,
      base_salary: slip.base_salary,
      gross_pay: slip.gross_pay,
      deductions: slip.deductions,
      net_pay: slip.net_pay,
      pay_basis: slip.pay_basis,
      branch_label: slip.branch_label,
      cost_center: slip.cost_center,
      earnings_breakdown: slip.earnings_breakdown,
      deductions_breakdown: slip.deductions_breakdown,
      policy_snapshot: slip.policy_snapshot,
      ytd_json: slip.ytd_json,
      pay_full_base_salary: mergedOverrides.payFullBaseSalary ?? false,
      waive_penalties: mergedOverrides.waivePenalties ?? false,
      manual_paye_override: mergedOverrides.manualPayeOverride ?? null,
      manual_adjustment: mergedOverrides.manualAdjustment ?? null,
      bonus_amount: mergedOverrides.bonusAmount ?? null,
      audit_log: [...priorAudit, ...slip.audit_log],
    })
    .eq('id', paymentId)
  if (updErr) return { ok: false, message: updErr.message }
  return { ok: true, data: undefined }
}
