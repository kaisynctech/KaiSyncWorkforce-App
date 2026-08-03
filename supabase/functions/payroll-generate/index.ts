/**
 * Server-side payroll generate/recalculate — runs the SAME calculation engine as the
 * web app (`kaisync-web/src/lib/payroll/*`, copied verbatim into `_shared/payroll/`)
 * so persisted `payment_approvals` rows are not browser-authoritative. This is the
 * non-repudiation follow-up tracked as "remaining gap #2" in
 * docs/modules/payroll-web-program.md.
 *
 * Auth: caller's JWT → `employees` row with matching `user_id`/`company_id`,
 * `is_active = true`, and `access_level` in owner|hr|hr_admin|admin.
 *
 * `get_company_settings` is a SECURITY DEFINER RPC whose internal authorization check
 * (`user_company_ids()`) reads `auth.uid()` from the request JWT — it must be called
 * with the caller's own session client, not the service-role admin client (which has
 * no `auth.uid()`). All other reads/writes use the admin client since we've already
 * performed our own authorization check above.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  calculatePayslip,
  type EngineEmployee,
  type LeaveSnapshot,
  type PayslipOverrides,
  type PunchLike,
  type SalaryHistoryEntry,
  type ShiftTemplateLike,
} from '../_shared/payroll/adapter.ts'
import { prefsToSettings, withCompanyTimezone, type PayrollSettings } from '../_shared/payroll/prefs.ts'
import type { AbsenceSnapshot } from '../_shared/payroll/calculator.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const EMP_SELECT =
  'id, name, surname, is_active, monthly_salary, hourly_rate, daily_rate, daily_hours, pay_by_hour, pay_basis, uif_exempt, paye_rate_percent, paye_fixed_amount, uif_rate_percent, uif_fixed_amount, medical_aid_deduction, pension_deduction, union_deduction, department, cost_center, branch, worker_type, shift_template_id, bank_name, bank_account, bank_branch_code, employment_date, termination_date, date_of_birth, tax_directive_rate_percent, pay_full_monthly_salary, overtime_rate, work_days_weekly, account_type, tax_number'

type EmployeeRow = EngineEmployee & {
  is_active: boolean
  employment_date: string | null
  termination_date: string | null
}

type RequestBody = {
  company_id: string
  action: 'generate' | 'recalculate'
  period_start: string
  period_end: string
  payment_id?: string
  overrides?: {
    payFullBaseSalary?: boolean
    waivePenalties?: boolean
    manualPayeOverride?: number | null
    manualAdjustment?: number | null
    bonusAmount?: number | null
  }
}

function hasPayRate(emp: EmployeeRow): boolean {
  return (emp.monthly_salary ?? 0) > 0 || (emp.hourly_rate ?? 0) > 0 || (emp.daily_rate ?? 0) > 0
}

/** Mirrors kaisync-web/src/lib/payroll-readiness.ts isEligibleForPeriod. */
function isEligibleForPeriod(emp: EmployeeRow, periodStart: string, periodEnd: string): boolean {
  if (!emp.is_active || !hasPayRate(emp)) return false
  if (emp.employment_date && emp.employment_date > periodEnd) return false
  if (emp.termination_date && emp.termination_date < periodStart) return false
  return true
}

async function loadSettings(
  userClient: SupabaseClient,
  companyId: string
): Promise<{ ok: true; settings: PayrollSettings } | { ok: false; message: string }> {
  const { data, error } = await userClient.rpc('get_company_settings', { p_company_id: companyId })
  if (error) return { ok: false, message: error.message }
  const row = (data ?? {}) as { payroll_preferences?: Record<string, unknown>; timezone?: string }
  const prefs =
    row.payroll_preferences && typeof row.payroll_preferences === 'object' ? row.payroll_preferences : {}
  return {
    ok: true,
    settings: withCompanyTimezone(prefsToSettings(companyId, prefs), row.timezone),
  }
}

async function loadLeaveRecordsInPeriod(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<LeaveSnapshot[]> {
  const { data } = await admin
    .from('leave_requests')
    .select('leave_type, start_date, end_date, total_days, half_day_start, half_day_end, status')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart)

  return (data ?? []).map(row => ({
    leaveType: row.leave_type ?? 'Annual Leave',
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    halfDayStart: Boolean(row.half_day_start),
    halfDayEnd: Boolean(row.half_day_end),
    totalDays: Number(row.total_days ?? 0),
    isApproved: true,
  }))
}

async function loadSalaryHistory(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<SalaryHistoryEntry[]> {
  const { data } = await admin
    .from('employee_salary_history')
    .select('effective_date, monthly_salary, hourly_rate, daily_rate')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .order('effective_date', { ascending: false })

  return (data ?? []).map(row => ({
    effective_date: row.effective_date as string,
    monthly_salary: Number(row.monthly_salary ?? 0),
    hourly_rate: Number(row.hourly_rate ?? 0),
    daily_rate: Number(row.daily_rate ?? 0),
  }))
}

async function loadShiftTemplates(
  admin: SupabaseClient,
  companyId: string
): Promise<{ byId: Map<string, ShiftTemplateLike>; defaultTemplate: ShiftTemplateLike | null }> {
  const { data } = await admin
    .from('employee_shift_templates')
    .select('id, start_time, end_time, break_minutes, is_default')
    .eq('company_id', companyId)

  const byId = new Map<string, ShiftTemplateLike>()
  let defaultTemplate: ShiftTemplateLike | null = null
  for (const row of data ?? []) {
    const tmpl: ShiftTemplateLike = {
      id: row.id as string,
      start_time: row.start_time as string | null,
      end_time: row.end_time as string | null,
      break_minutes: Number(row.break_minutes ?? 0),
    }
    byId.set(tmpl.id, tmpl)
    if (row.is_default && !defaultTemplate) defaultTemplate = tmpl
  }
  return { byId, defaultTemplate }
}

async function loadAbsencesInPeriod(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<AbsenceSnapshot[]> {
  const { data } = await admin
    .from('daily_absences')
    .select('date')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .gte('date', periodStart)
    .lte('date', periodEnd)

  return (data ?? []).map(row => ({ date: row.date as string }))
}

async function loadYtdPrior(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string,
  periodStart: string
): Promise<{ gross_pay: number; paye: number; uif: number; net_pay: number }> {
  const year = periodStart.slice(0, 4)
  const { data } = await admin
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

async function handleGenerate(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  body: RequestBody,
  actorUserId: string
) {
  const { company_id: companyId, period_start: periodStart, period_end: periodEnd } = body

  const { data: lockRow, error: lockErr } = await admin
    .from('payroll_period_locks')
    .select('company_id')
    .eq('company_id', companyId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()
  if (lockErr) return json({ ok: false, error: lockErr.message }, 500)
  if (lockRow) return json({ ok: false, error: 'This payroll period is locked and cannot be regenerated.' }, 409)

  const settingsRes = await loadSettings(userClient, companyId)
  if (!settingsRes.ok) return json({ ok: false, error: settingsRes.message }, 400)
  const settings = settingsRes.settings

  const [
    { data: emps, error: empErr },
    { data: existing, error: existErr },
    { data: punches, error: punchErr },
    templates,
  ] = await Promise.all([
    admin.from('employees').select(EMP_SELECT).eq('company_id', companyId).eq('is_active', true),
    admin
      .from('payment_approvals')
      .select('employee_id')
      .eq('company_id', companyId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd),
    admin
      .from('time_punches')
      .select('employee_id, type, date_time')
      .eq('company_id', companyId)
      .gte('date_time', `${periodStart}T00:00:00`)
      .lte('date_time', `${periodEnd}T23:59:59`),
    loadShiftTemplates(admin, companyId),
  ])

  if (empErr) return json({ ok: false, error: empErr.message }, 500)
  if (existErr) return json({ ok: false, error: existErr.message }, 500)
  if (punchErr) return json({ ok: false, error: punchErr.message }, 500)

  const existingIds = new Set((existing ?? []).map(r => r.employee_id as string))
  const punchRows = (punches ?? []) as PunchLike[]
  let generated = 0
  let skipped = 0
  const errors: string[] = []

  for (const raw of (emps ?? []) as EmployeeRow[]) {
    if (!isEligibleForPeriod(raw, periodStart, periodEnd)) {
      skipped++
      continue
    }
    if (existingIds.has(raw.id)) {
      skipped++
      continue
    }

    const [leaveRecords, salaryHistory, ytdPrior, absences] = await Promise.all([
      loadLeaveRecordsInPeriod(admin, companyId, raw.id, periodStart, periodEnd),
      loadSalaryHistory(admin, companyId, raw.id),
      loadYtdPrior(admin, companyId, raw.id, periodStart),
      loadAbsencesInPeriod(admin, companyId, raw.id, periodStart, periodEnd),
    ])

    const shiftTemplate =
      (raw.shift_template_id ? templates.byId.get(raw.shift_template_id) : null) ??
      templates.defaultTemplate

    const slip = calculatePayslip({
      employee: raw,
      settings,
      punches: punchRows,
      periodStart,
      periodEnd,
      leaveRecords,
      absences,
      shiftTemplate,
      salaryHistory,
      ytdPrior,
    })
    if (!slip) {
      skipped++
      continue
    }

    const { error: insertErr } = await admin.from('payment_approvals').insert({
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
      audit_log: [
        ...slip.audit_log,
        { action: 'generated', detail: `By user ${actorUserId} via payroll-generate EF`, at: new Date().toISOString() },
      ],
      status: 'pending',
      shared_with_employee: false,
    })

    if (insertErr) {
      errors.push(`${raw.name} ${raw.surname}: ${insertErr.message}`)
    } else {
      generated++
    }
  }

  return json({ ok: true, generated, skipped, errors })
}

async function handleRecalculate(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  body: RequestBody,
  actorUserId: string
) {
  const { company_id: companyId, payment_id: paymentId } = body
  if (!paymentId) return json({ ok: false, error: 'Missing payment_id for recalculate.' }, 400)

  const { data: payment, error: payErr } = await admin
    .from('payment_approvals')
    .select('*')
    .eq('id', paymentId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (payErr) return json({ ok: false, error: payErr.message }, 500)
  if (!payment) return json({ ok: false, error: 'Payslip not found.' }, 404)
  if (payment.status !== 'pending') {
    return json({ ok: false, error: 'Only pending payslips can be recalculated.' }, 400)
  }

  const settingsRes = await loadSettings(userClient, companyId)
  if (!settingsRes.ok) return json({ ok: false, error: settingsRes.message }, 400)

  const { data: emp, error: empErr } = await admin
    .from('employees')
    .select(EMP_SELECT)
    .eq('id', payment.employee_id)
    .maybeSingle()
  if (empErr) return json({ ok: false, error: empErr.message }, 500)
  if (!emp) return json({ ok: false, error: 'Employee not found.' }, 404)

  const { data: punches } = await admin
    .from('time_punches')
    .select('employee_id, type, date_time')
    .eq('company_id', companyId)
    .eq('employee_id', payment.employee_id)
    .gte('date_time', `${payment.period_start}T00:00:00`)
    .lte('date_time', `${payment.period_end}T23:59:59`)

  const [leaveRecords, salaryHistory, ytdPrior, absences, templates] = await Promise.all([
    loadLeaveRecordsInPeriod(admin, companyId, payment.employee_id, payment.period_start, payment.period_end),
    loadSalaryHistory(admin, companyId, payment.employee_id),
    loadYtdPrior(admin, companyId, payment.employee_id, payment.period_start),
    loadAbsencesInPeriod(admin, companyId, payment.employee_id, payment.period_start, payment.period_end),
    loadShiftTemplates(admin, companyId),
  ])

  const overrides = body.overrides ?? {}
  const mergedOverrides: PayslipOverrides = {
    payFullBaseSalary: overrides.payFullBaseSalary ?? payment.pay_full_base_salary ?? false,
    waivePenalties: overrides.waivePenalties ?? payment.waive_penalties ?? false,
    manualPayeOverride:
      overrides.manualPayeOverride !== undefined ? overrides.manualPayeOverride : payment.manual_paye_override,
    manualAdjustment:
      overrides.manualAdjustment !== undefined ? overrides.manualAdjustment : payment.manual_adjustment,
    bonusAmount: overrides.bonusAmount !== undefined ? overrides.bonusAmount : payment.bonus_amount,
  }

  const empRow = emp as EngineEmployee
  const shiftTemplate =
    (empRow.shift_template_id ? templates.byId.get(empRow.shift_template_id) : null) ??
    templates.defaultTemplate

  const slip = calculatePayslip({
    employee: empRow,
    settings: settingsRes.settings,
    punches: (punches ?? []) as PunchLike[],
    periodStart: payment.period_start,
    periodEnd: payment.period_end,
    overrides: mergedOverrides,
    leaveRecords,
    absences,
    shiftTemplate,
    salaryHistory,
    ytdPrior,
  })
  if (!slip) return json({ ok: false, error: 'Could not calculate payslip for this employee/period.' }, 400)

  const priorAudit = Array.isArray(payment.audit_log) ? payment.audit_log : []
  const { error: updErr } = await admin
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
      audit_log: [
        ...priorAudit,
        ...slip.audit_log,
        {
          action: 'recalculated',
          detail: `By user ${actorUserId} via payroll-generate EF (server)`,
          at: new Date().toISOString(),
        },
      ],
    })
    .eq('id', paymentId)
  if (updErr) return json({ ok: false, error: updErr.message }, 500)

  return json({ ok: true })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session' }, 401)

    const body = (await req.json()) as RequestBody
    if (!body.company_id || !body.action) {
      return json({ error: 'Missing company_id or action' }, 400)
    }
    if (body.action !== 'generate' && body.action !== 'recalculate') {
      return json({ error: 'action must be "generate" or "recalculate"' }, 400)
    }
    if (body.action === 'generate' && (!body.period_start || !body.period_end)) {
      return json({ error: 'Missing period_start or period_end' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const { data: actor } = await admin
      .from('employees')
      .select('id, access_level')
      .eq('user_id', user.id)
      .eq('company_id', body.company_id)
      .eq('is_active', true)
      .maybeSingle()
    const level = (actor?.access_level ?? '').toLowerCase()
    if (!actor || !['owner', 'hr', 'hr_admin', 'admin'].includes(level)) {
      return json({ error: 'Not authorized' }, 403)
    }

    if (body.action === 'generate') {
      return await handleGenerate(admin, userClient, body, user.id)
    }
    return await handleRecalculate(admin, userClient, body, user.id)
  } catch (err) {
    console.error('payroll-generate error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
