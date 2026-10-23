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
import { calendarMonthBounds } from '../_shared/payroll/period.ts'
import { calculateMonthlyPaye } from '../_shared/payroll/sars-paye.ts'

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
  'id, name, surname, is_active, monthly_salary, hourly_rate, daily_rate, daily_hours, pay_by_hour, pay_basis, uif_exempt, paye_rate_percent, paye_fixed_amount, uif_rate_percent, uif_fixed_amount, medical_aid_deduction, medical_aid_dependants, pension_deduction, union_deduction, department, cost_center, branch, worker_type, shift_template_id, bank_name, bank_account, bank_branch_code, employment_date, termination_date, date_of_birth, tax_directive_rate_percent, pay_full_monthly_salary, overtime_rate, work_days_weekly, account_type, tax_number'

type EmployeeRow = EngineEmployee & {
  is_active: boolean
  employment_date: string | null
  termination_date: string | null
}

type RequestBody = {
  company_id: string
  action: 'generate' | 'recalculate' | 'save_lines'
  period_start: string
  period_end: string
  payment_id?: string
  /** generate: first person (by id order) in this chunk, and how many to do. */
  offset?: number
  limit?: number
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

function lineAmount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

const WINTERSTECH_COMPANY_ID = 'a3453fd7-d217-42a9-b89a-b61fce77b2fd'
const MEIBC_ADMIN_LEVY_MONTHLY = 9.57
const MEIBC_DISPUTE_LEVY_MONTHLY = 3.46
const MEIBC_SICK_PAY_RATE = 0.0009

type ExtraLine = { id: string; label: string; amount: number }

function parseExtraLines(raw: unknown): ExtraLine[] {
  if (!Array.isArray(raw)) return []
  const lines: ExtraLine[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const label = String(item.label ?? '').trim()
    if (!label) continue
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : crypto.randomUUID()
    lines.push({ id, label, amount: lineAmount(item.amount) })
  }
  return lines
}

function sumExtra(lines: ExtraLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100
}

/** Employee MEIBC levies for Winterstech. Employer contributions stay off the payslip. */
function withWinterstechMeibc(companyId: string | undefined, raw: Record<string, unknown>): Record<string, unknown> {
  if (companyId !== WINTERSTECH_COMPANY_ID || raw.meibcApplied === true) return raw
  const regular = lineAmount(raw.regular)
  const sick = Math.round(regular * MEIBC_SICK_PAY_RATE * 100) / 100
  return {
    ...raw,
    meibcApplied: true,
    extraDeductions: [
      ...parseExtraLines(raw.extraDeductions),
      { id: 'meibc-admin', label: 'MEIBC Admin Levy', amount: MEIBC_ADMIN_LEVY_MONTHLY },
      { id: 'meibc-dispute', label: 'MEIBC Dispute Levy', amount: MEIBC_DISPUTE_LEVY_MONTHLY },
      { id: 'meibc-sick', label: 'MEIBC Sick Pay Fund', amount: sick },
    ],
  }
}

type EmployeeDeductionFields = {
  medical_aid_deduction?: number | null
  pension_deduction?: number | null
  union_deduction?: number | null
}

/**
 * The employee's own medical aid / pension / union deductions as payslip lines (same ids as the
 * payslip screen, kaisync-web/src/lib/payslip-extra-lines.ts). Added once; after that the saved lines count.
 * Before W5 typed payslips left these out, so the payslip net was higher than it should be.
 */
function withEmployeeDeductions(raw: Record<string, unknown>, emp?: EmployeeDeductionFields | null): Record<string, unknown> {
  if (!emp || raw.employeeDeductionsApplied === true) return raw
  const existing = parseExtraLines(raw.extraDeductions)
  const have = new Set(existing.map(line => line.id))
  const add = [
    { id: 'emp-medical-aid', label: 'Medical aid', amount: lineAmount(emp.medical_aid_deduction) },
    { id: 'emp-pension', label: 'Pension', amount: lineAmount(emp.pension_deduction) },
    { id: 'emp-union', label: 'Union', amount: lineAmount(emp.union_deduction) },
  ].filter(line => line.amount > 0 && !have.has(line.id))
  return { ...raw, employeeDeductionsApplied: true, extraDeductions: [...existing, ...add] }
}

function totalsFromLines(raw: Record<string, unknown>, companyId?: string, emp?: EmployeeDeductionFields | null) {
  const source = withEmployeeDeductions(withWinterstechMeibc(companyId, raw), emp)
  const regular = lineAmount(source.regular)
  const overtime = lineAmount(source.overtime)
  const bonus = lineAmount(source.bonus)
  const incentive = lineAmount(source.incentive)
  const refund = lineAmount(source.refund)
  const uif = lineAmount(source.uif)
  const paye = lineAmount(source.paye)
  const loanDeduction = lineAmount(source.loanDeduction)
  const loanBalance = lineAmount(source.loanBalance)
  const unpaidLeave = lineAmount(source.unpaidLeave)
  const extraEarnings = parseExtraLines(source.extraEarnings)
  const extraDeductions = parseExtraLines(source.extraDeductions)
  const unpaidAbsenceDates = Array.isArray(source.unpaidAbsenceDates)
    ? source.unpaidAbsenceDates.filter((day): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day))
    : []
  const gross = Math.round((regular + overtime + bonus + incentive + refund + sumExtra(extraEarnings)) * 100) / 100
  const deductions = Math.round((uif + paye + loanDeduction + unpaidLeave + sumExtra(extraDeductions)) * 100) / 100
  const net = Math.round(Math.max(0, gross - deductions) * 100) / 100
  const saved = {
    regular, overtime, bonus, incentive, refund, uif, paye, loanDeduction, loanBalance, unpaidLeave, unpaidAbsenceDates,
    extraEarnings, extraDeductions, meibcApplied: source.meibcApplied === true,
    employeeDeductionsApplied: source.employeeDeductionsApplied === true,
  }
  const earnings = [
    { label: 'Regular Earnings', amount: regular },
    { label: 'Overtime', amount: overtime },
    { label: 'Bonus', amount: bonus },
    { label: 'Incentive Pay', amount: incentive },
    { label: 'Refund', amount: refund },
    ...extraEarnings.map(line => ({ label: line.label, amount: line.amount })),
  ].filter(line => line.amount > 0)
  const deductionLines = [
    { label: 'UIF', amount: uif },
    { label: 'PAYE', amount: paye },
    { label: 'Loan Deduction', amount: loanDeduction },
    { label: 'Unpaid Leave', amount: unpaidLeave },
    ...extraDeductions.map(line => ({ label: line.label, amount: line.amount })),
  ].filter(line => line.amount > 0)
  return { saved, gross, deductions, net, regular, overtime, bonus, paye, loanDeduction, earnings, deductionLines, uif, unpaidLeave }
}

/** A saved PAYE figure that is still 18% of gross is the old flat rate, not the SARS tables. */
function payeFromCurrentTables(
  typed: ReturnType<typeof totalsFromLines>,
  engineOvertime: number,
  dateOfBirth: string | null,
  emp?: EmployeeDeductionFields & { medical_aid_dependants?: number | null } | null
) {
  const overtime = typed.overtime > 0 ? typed.overtime : Math.round(Math.max(0, engineOvertime) * 100) / 100
  const extraEarnings = typed.saved.extraEarnings ?? []
  const extraDeductions = typed.saved.extraDeductions ?? []
  const gross = Math.round((typed.regular + overtime + typed.bonus + typed.saved.incentive + typed.saved.refund + sumExtra(extraEarnings)) * 100) / 100
  const flatOnSavedGross = Math.round(typed.gross * 18) / 100
  const sarsPaye = calculateMonthlyPaye(gross, dateOfBirth, null, {
    retirementFundMonthly: emp?.pension_deduction ?? 0,
    medicalAidMonthly: emp?.medical_aid_deduction ?? 0,
    medicalAidDependants: emp?.medical_aid_dependants ?? 0,
  })
  const paye = Math.abs(typed.paye - flatOnSavedGross) < 0.05 ? sarsPaye : typed.paye
  const deductions = Math.round((typed.uif + paye + typed.loanDeduction + typed.unpaidLeave + sumExtra(extraDeductions)) * 100) / 100
  const net = Math.round(Math.max(0, gross - deductions) * 100) / 100
  const saved = { ...typed.saved, overtime, paye }
  const earnings = [
    { label: 'Regular Earnings', amount: typed.regular },
    { label: 'Overtime', amount: overtime },
    { label: 'Bonus', amount: typed.bonus },
    { label: 'Incentive Pay', amount: typed.saved.incentive },
    { label: 'Refund', amount: typed.saved.refund },
    ...extraEarnings.map(line => ({ label: line.label, amount: line.amount })),
  ].filter(line => line.amount > 0)
  const deductionLines = [
    { label: 'UIF', amount: typed.uif },
    { label: 'PAYE', amount: paye },
    { label: 'Loan Deduction', amount: typed.loanDeduction },
    { label: 'Unpaid Leave', amount: typed.unpaidLeave },
    ...extraDeductions.map(line => ({ label: line.label, amount: line.amount })),
  ].filter(line => line.amount > 0)
  return { saved, gross, deductions, net, regular: typed.regular, overtime, bonus: typed.bonus, paye, loanDeduction: typed.loanDeduction, earnings, deductionLines }
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

function latestSalaryOnOrBefore(history: SalaryHistoryEntry[], asOf: string): SalaryHistoryEntry | undefined {
  return history
    .filter(row => row.effective_date <= asOf)
    .sort((a, b) => {
      if (a.effective_date !== b.effective_date) return a.effective_date < b.effective_date ? 1 : -1
      const aCreated = a.created_at ?? ''
      const bCreated = b.created_at ?? ''
      if (aCreated === bCreated) return 0
      return aCreated < bCreated ? 1 : -1
    })[0]
}

/** Keeps this month on the salary stored on the person when an older history row would override it. */
async function recordSalaryChange(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string,
  monthlySalary: number,
  hourlyRate: number,
  dailyRate: number,
  periodEnd: string,
  history: SalaryHistoryEntry[]
): Promise<string | null> {
  const applicable = latestSalaryOnOrBefore(history, periodEnd)
  if (!applicable) return null
  const same =
    Math.abs(applicable.monthly_salary - monthlySalary) < 0.005 &&
    Math.abs(applicable.hourly_rate - hourlyRate) < 0.005 &&
    Math.abs(applicable.daily_rate - dailyRate) < 0.005
  if (same) return null
  const createdAt = new Date().toISOString()
  const { error } = await admin.from('employee_salary_history').insert({
    employee_id: employeeId,
    company_id: companyId,
    effective_date: periodEnd,
    monthly_salary: monthlySalary,
    hourly_rate: hourlyRate,
    daily_rate: dailyRate,
    note: 'Updated from payslip',
    created_at: createdAt,
  })
  if (error) return error.message
  history.push({
    effective_date: periodEnd,
    monthly_salary: monthlySalary,
    hourly_rate: hourlyRate,
    daily_rate: dailyRate,
    created_at: createdAt,
  })
  return null
}

async function loadSalaryHistory(
  admin: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<SalaryHistoryEntry[]> {
  const { data } = await admin
    .from('employee_salary_history')
    .select('effective_date, monthly_salary, hourly_rate, daily_rate, created_at')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .order('effective_date', { ascending: false })

  return (data ?? []).map(row => ({
    effective_date: row.effective_date as string,
    monthly_salary: Number(row.monthly_salary ?? 0),
    hourly_rate: Number(row.hourly_rate ?? 0),
    daily_rate: Number(row.daily_rate ?? 0),
    created_at: (row.created_at as string | null) ?? null,
  }))
}

async function loadShiftTemplates(
  admin: SupabaseClient,
  companyId: string
): Promise<{ byId: Map<string, ShiftTemplateLike>; defaultTemplate: ShiftTemplateLike | null }> {
  const { data } = await admin
    .from('employee_shift_templates')
    .select('id, start_time, end_time, break_minutes, is_default, weekend_start_time, weekend_end_time, ot_start_time, weekend_ot_start_time, early_ot_start_time, weekend_early_ot_start_time, sunday_start_time, sunday_end_time, sunday_ot_start_time, sunday_early_ot_start_time')
    .eq('company_id', companyId)

  const byId = new Map<string, ShiftTemplateLike>()
  let defaultTemplate: ShiftTemplateLike | null = null
  for (const row of data ?? []) {
    const tmpl: ShiftTemplateLike = {
      id: row.id as string,
      start_time: row.start_time as string | null,
      end_time: row.end_time as string | null,
      break_minutes: Number(row.break_minutes ?? 0),
      weekend_start_time: row.weekend_start_time as string | null,
      weekend_end_time: row.weekend_end_time as string | null,
      ot_start_time: row.ot_start_time as string | null,
      weekend_ot_start_time: row.weekend_ot_start_time as string | null,
      early_ot_start_time: row.early_ot_start_time as string | null,
      weekend_early_ot_start_time: row.weekend_early_ot_start_time as string | null,
      sunday_start_time: row.sunday_start_time as string | null,
      sunday_end_time: row.sunday_end_time as string | null,
      sunday_ot_start_time: row.sunday_ot_start_time as string | null,
      sunday_early_ot_start_time: row.sunday_early_ot_start_time as string | null,
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

const GENERATE_CHUNK_DEFAULT = 150
const GENERATE_CHUNK_MAX = 300
/** Employee ids per `.in()` filter (keeps the request URL short). */
const IDS_PER_QUERY = 150

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Every row for these people, 1,000 at a time (the API returns at most 1,000 rows per request). */
async function fetchForIds<T>(ids: string[], build: (part: string[]) => (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
    const page = build(ids.slice(i, i + IDS_PER_QUERY))
    for (let from = 0; ; from += 1000) {
      const { data, error } = await page(from, from + 999)
      if (error) throw new Error(error.message)
      const rows = data ?? []
      out.push(...rows)
      if (rows.length < 1000) break
    }
  }
  return out
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

async function runLimited(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++]
      await task()
    }
  })
  await Promise.all(workers)
}

/** Same totals as loadYtdPrior, from rows already loaded. */
function ytdFromRows(rows: { gross_pay: number | null; net_pay: number | null; deductions_breakdown: unknown }[]) {
  let gross = 0
  let net = 0
  let paye = 0
  let uif = 0
  for (const row of rows) {
    gross += Number(row.gross_pay ?? 0)
    net += Number(row.net_pay ?? 0)
    const lines = (Array.isArray(row.deductions_breakdown) ? row.deductions_breakdown : []) as { label?: string; amount?: number }[]
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
  const { company_id: companyId, period_start: requestedStart } = body
  if (!requestedStart) return json({ ok: false, error: 'Missing period_start.' }, 400)
  const { start: periodStart, end: periodEnd } = calendarMonthBounds(requestedStart)

  const { data: lockRow, error: lockErr } = await admin
    .from('payroll_period_locks')
    .select('company_id')
    .eq('company_id', companyId)
    .gte('period_start', periodStart)
    .lte('period_start', periodEnd)
    .limit(1)
    .maybeSingle()
  if (lockErr) return json({ ok: false, error: lockErr.message }, 500)
  if (lockRow) return json({ ok: false, error: 'This payroll period is locked and cannot be regenerated.' }, 409)

  const settingsRes = await loadSettings(userClient, companyId)
  if (!settingsRes.ok) return json({ ok: false, error: settingsRes.message }, 400)
  const settings = settingsRes.settings

  // W5: one chunk of people per call (ordered by id). The page calls again with next_offset until
  // done, showing progress. Before, one call did the whole company with ~6 queries per person
  // (326 people took 37 s; 10,000 would run past the server time limit).
  const offset = Math.max(0, Math.floor(Number(body.offset ?? 0)) || 0)
  const limit = Math.min(GENERATE_CHUNK_MAX, Math.max(1, Math.floor(Number(body.limit ?? GENERATE_CHUNK_DEFAULT)) || GENERATE_CHUNK_DEFAULT))

  const [{ data: emps, error: empErr, count: totalPeople }, templates] = await Promise.all([
    admin.from('employees').select(EMP_SELECT, { count: 'exact' })
      .eq('company_id', companyId).eq('is_active', true)
      .order('id').range(offset, offset + limit - 1),
    loadShiftTemplates(admin, companyId),
  ])
  if (empErr) return json({ ok: false, error: empErr.message }, 500)
  const chunk = (emps ?? []) as EmployeeRow[]
  const ids = chunk.map(e => e.id)
  const total = totalPeople ?? offset + chunk.length
  const nextOffset = offset + chunk.length < total && chunk.length > 0 ? offset + chunk.length : null

  type ExistingPay = {
    id: string
    employee_id: string
    status: string
    pay_full_base_salary: boolean | null
    waive_penalties: boolean | null
    manual_paye_override: number | null
    manual_adjustment: number | null
    adjustment_note: string | null
    bonus_amount: number | null
    bonus_note: string | null
    payslip_lines: Record<string, unknown> | null
    audit_log: unknown
  }
  type PriorSlip = { employee_id: string; period_start: string; payslip_lines: Record<string, unknown> | null; pay_full_base_salary: boolean | null; waive_penalties: boolean | null }
  type LeaveRow = { employee_id: string; leave_type: string | null; start_date: string; end_date: string; total_days: number | null; half_day_start: boolean | null; half_day_end: boolean | null }
  type SalaryRow = { employee_id: string; effective_date: string; monthly_salary: number | null; hourly_rate: number | null; daily_rate: number | null; created_at: string | null }
  type YtdRow = { employee_id: string; gross_pay: number | null; net_pay: number | null; deductions_breakdown: unknown }
  type AbsenceRow = { employee_id: string; date: string }

  const year = periodStart.slice(0, 4)
  const priorFrom = `${Number(year) - 2}${periodStart.slice(4)}`
  let existing: ExistingPay[], punchRows: PunchLike[], leaveRows: LeaveRow[], salaryRows: SalaryRow[]
  let ytdRows: YtdRow[], absenceRows: AbsenceRow[], priorRows: PriorSlip[]
  try {
    ;[existing, punchRows, leaveRows, salaryRows, ytdRows, absenceRows, priorRows] = await Promise.all([
      fetchForIds<ExistingPay>(ids, part => (from, to) => admin.from('payment_approvals')
        .select('id, employee_id, status, pay_full_base_salary, waive_penalties, manual_paye_override, manual_adjustment, adjustment_note, bonus_amount, bonus_note, payslip_lines, audit_log')
        .eq('company_id', companyId).in('employee_id', part)
        .gte('period_start', periodStart).lte('period_start', periodEnd).neq('status', 'rejected')
        .order('id').range(from, to)),
      fetchForIds<PunchLike>(ids, part => (from, to) => admin.from('time_punches')
        .select('employee_id, type, date_time')
        .eq('company_id', companyId).in('employee_id', part)
        .gte('date_time', `${periodStart}T00:00:00`).lte('date_time', `${periodEnd}T23:59:59`)
        .order('id').range(from, to)),
      fetchForIds<LeaveRow>(ids, part => (from, to) => admin.from('leave_requests')
        .select('employee_id, leave_type, start_date, end_date, total_days, half_day_start, half_day_end')
        .eq('company_id', companyId).in('employee_id', part).eq('status', 'approved')
        .lte('start_date', periodEnd).gte('end_date', periodStart)
        .order('id').range(from, to)),
      fetchForIds<SalaryRow>(ids, part => (from, to) => admin.from('employee_salary_history')
        .select('employee_id, effective_date, monthly_salary, hourly_rate, daily_rate, created_at')
        .eq('company_id', companyId).in('employee_id', part)
        .order('id').range(from, to)),
      fetchForIds<YtdRow>(ids, part => (from, to) => admin.from('payment_approvals')
        .select('employee_id, gross_pay, net_pay, deductions_breakdown')
        .eq('company_id', companyId).in('employee_id', part)
        .gte('period_start', `${year}-01-01`).lt('period_start', periodStart)
        .in('status', ['approved', 'paid', 'pending'])
        .order('id').range(from, to)),
      fetchForIds<AbsenceRow>(ids, part => (from, to) => admin.from('daily_absences')
        .select('employee_id, date')
        .eq('company_id', companyId).in('employee_id', part)
        .gte('date', periodStart).lte('date', periodEnd)
        .order('id').range(from, to)),
      // Lines carried from the person's latest earlier payslip (looked back two years).
      fetchForIds<PriorSlip>(ids, part => (from, to) => admin.from('payment_approvals')
        .select('employee_id, period_start, payslip_lines, pay_full_base_salary, waive_penalties')
        .eq('company_id', companyId).in('employee_id', part)
        .gte('period_start', priorFrom).lt('period_start', periodStart)
        .order('id').range(from, to)),
    ])
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }

  const existingByEmployee = new Map<string, ExistingPay>()
  for (const row of existing) {
    const prev = existingByEmployee.get(row.employee_id)
    if (!prev || (prev.status !== 'pending' && row.status === 'pending')) existingByEmployee.set(row.employee_id, row)
  }
  const punchesBy = groupBy(punchRows, r => r.employee_id)
  const leaveBy = groupBy(leaveRows, r => r.employee_id)
  const salaryBy = groupBy(salaryRows, r => r.employee_id)
  const ytdBy = groupBy(ytdRows, r => r.employee_id)
  const absenceBy = groupBy(absenceRows, r => r.employee_id)
  const priorBy = new Map<string, PriorSlip>()
  for (const row of priorRows) {
    const prev = priorBy.get(row.employee_id)
    if (!prev || row.period_start > prev.period_start) priorBy.set(row.employee_id, row)
  }

  let generated = 0
  let updated = 0
  let skipped = 0
  const errors: string[] = []
  const updates: (() => Promise<void>)[] = []
  const inserts: { name: string; row: Record<string, unknown> }[] = []

  for (const raw of chunk) {
    if (!isEligibleForPeriod(raw, periodStart, periodEnd)) { skipped++; continue }
    const existingPay = existingByEmployee.get(raw.id)
    if (existingPay && existingPay.status !== 'pending') { skipped++; continue }

    const leaveRecords: LeaveSnapshot[] = (leaveBy.get(raw.id) ?? []).map(row => ({
      leaveType: row.leave_type ?? 'Annual Leave',
      startDate: row.start_date,
      endDate: row.end_date,
      halfDayStart: Boolean(row.half_day_start),
      halfDayEnd: Boolean(row.half_day_end),
      totalDays: Number(row.total_days ?? 0),
      isApproved: true,
    }))
    const salaryHistory: SalaryHistoryEntry[] = (salaryBy.get(raw.id) ?? [])
      .map(row => ({
        effective_date: row.effective_date,
        monthly_salary: Number(row.monthly_salary ?? 0),
        hourly_rate: Number(row.hourly_rate ?? 0),
        daily_rate: Number(row.daily_rate ?? 0),
        created_at: row.created_at ?? null,
      }))
      .sort((a, b) => (a.effective_date < b.effective_date ? 1 : a.effective_date > b.effective_date ? -1 : 0))
    const ytdPrior = ytdFromRows(ytdBy.get(raw.id) ?? [])
    const absences: AbsenceSnapshot[] = (absenceBy.get(raw.id) ?? []).map(row => ({ date: row.date }))

    const shiftTemplate =
      (raw.shift_template_id ? templates.byId.get(raw.shift_template_id) : null) ??
      templates.defaultTemplate

    const overrides: PayslipOverrides | undefined = existingPay
      ? {
          payFullBaseSalary: existingPay.pay_full_base_salary ?? false,
          waivePenalties: existingPay.waive_penalties ?? false,
          manualPayeOverride: existingPay.manual_paye_override,
          manualAdjustment: existingPay.manual_adjustment,
          adjustmentNote: existingPay.adjustment_note,
          bonusAmount: existingPay.bonus_amount,
          bonusNote: existingPay.bonus_note,
        }
      : undefined

    const slip = calculatePayslip({
      employee: raw,
      settings,
      punches: punchesBy.get(raw.id) ?? [],
      periodStart,
      periodEnd,
      overrides,
      leaveRecords,
      absences,
      shiftTemplate,
      salaryHistory,
      ytdPrior,
    })
    if (!slip) { skipped++; continue }

    const figures = {
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
    }
    const who = `${raw.name} ${raw.surname}`

    if (existingPay) {
      const priorAudit = Array.isArray(existingPay.audit_log) ? existingPay.audit_log : []
      const typed = existingPay.payslip_lines && typeof existingPay.payslip_lines === 'object'
        ? payeFromCurrentTables(totalsFromLines(existingPay.payslip_lines, companyId, raw), slip.overtime_pay, raw.date_of_birth ?? null, raw)
        : null
      const patch = {
        ...figures,
        ...(typed
          ? {
              regular_pay: typed.regular,
              overtime_pay: typed.overtime,
              base_salary: typed.regular,
              gross_pay: typed.gross,
              deductions: typed.deductions,
              net_pay: typed.net,
              bonus_amount: typed.bonus,
              manual_adjustment: typed.loanDeduction,
              manual_paye_override: typed.paye,
              earnings_breakdown: typed.earnings,
              deductions_breakdown: typed.deductionLines,
              payslip_lines: typed.saved,
            }
          : {}),
        audit_log: [
          ...priorAudit,
          { action: 'refreshed', detail: `Month ${periodStart} to ${periodEnd} by user ${actorUserId}`, at: new Date().toISOString() },
        ],
      }
      updates.push(async () => {
        const { error } = await admin.from('payment_approvals').update(patch).eq('id', existingPay.id).eq('company_id', companyId)
        if (error) errors.push(`${who}: ${error.message}`)
        else updated++
      })
      continue
    }

    const priorSlip = priorBy.get(raw.id)
    const carried = priorSlip?.payslip_lines && typeof priorSlip.payslip_lines === 'object'
      ? totalsFromLines(priorSlip.payslip_lines, companyId, raw)
      : null
    inserts.push({
      name: who,
      row: {
        ...figures,
        ...(carried
          ? {
              regular_pay: carried.regular,
              overtime_pay: carried.overtime,
              base_salary: carried.regular,
              gross_pay: carried.gross,
              deductions: carried.deductions,
              net_pay: carried.net,
              bonus_amount: carried.bonus,
              manual_adjustment: carried.loanDeduction,
              manual_paye_override: carried.paye,
              earnings_breakdown: carried.earnings,
              deductions_breakdown: carried.deductionLines,
              payslip_lines: { ...carried.saved, unpaidAbsenceDates: [] },
              pay_full_base_salary: priorSlip?.pay_full_base_salary ?? false,
              waive_penalties: priorSlip?.waive_penalties ?? false,
            }
          : {}),
        company_id: companyId,
        employee_id: slip.employee_id,
        audit_log: [
          ...slip.audit_log,
          { action: 'generated', detail: `By user ${actorUserId} via payroll-generate EF`, at: new Date().toISOString() },
        ],
        status: 'pending',
        shared_with_employee: false,
      },
    })
  }

  // New payslips: one insert for the chunk; if that fails, one by one so a single bad row
  // does not stop everyone else.
  if (inserts.length > 0) {
    const { error } = await admin.from('payment_approvals').insert(inserts.map(i => i.row))
    if (!error) generated += inserts.length
    else {
      await runLimited(inserts.map(item => async () => {
        const { error: oneErr } = await admin.from('payment_approvals').insert(item.row)
        if (oneErr) errors.push(`${item.name}: ${oneErr.message}`)
        else generated++
      }), 8)
    }
  }
  await runLimited(updates, 8)

  return json({ ok: true, generated, updated, skipped, errors, total, processed: offset + chunk.length, next_offset: nextOffset })
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

  const { data: lockRow, error: lockErr } = await admin
    .from('payroll_period_locks')
    .select('company_id')
    .eq('company_id', companyId)
    .eq('period_start', payment.period_start)
    .eq('period_end', payment.period_end)
    .maybeSingle()
  if (lockErr) return json({ ok: false, error: lockErr.message }, 500)
  if (lockRow) {
    return json({ ok: false, error: 'This payroll period is locked and cannot be recalculated.' }, 409)
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
    adjustmentNote:
      overrides.adjustmentNote !== undefined ? overrides.adjustmentNote : payment.adjustment_note,
    bonusAmount: overrides.bonusAmount !== undefined ? overrides.bonusAmount : payment.bonus_amount,
    bonusNote: overrides.bonusNote !== undefined ? overrides.bonusNote : payment.bonus_note,
  }

  const empRow = emp as EngineEmployee
  const salaryError = await recordSalaryChange(
    admin,
    companyId,
    payment.employee_id,
    Number(empRow.monthly_salary ?? 0),
    Number(empRow.hourly_rate ?? 0),
    Number(empRow.daily_rate ?? 0),
    payment.period_end,
    salaryHistory
  )
  if (salaryError) return json({ ok: false, error: salaryError }, 500)
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
          detail: `By user ${actorUserId} via payroll-generate EF (server). absence pay ${mergedOverrides.waivePenalties ? 'on' : 'off'}`,
          at: new Date().toISOString(),
        },
      ],
    })
    .eq('id', paymentId)
  if (updErr) return json({ ok: false, error: updErr.message }, 500)

  return json({ ok: true })
}

async function handleSaveLines(
  admin: SupabaseClient,
  body: RequestBody,
  actorUserId: string
) {
  const { company_id: companyId, payment_id: paymentId } = body
  if (!paymentId) return json({ ok: false, error: 'Missing payment_id.' }, 400)
  if (!body.lines || typeof body.lines !== 'object') return json({ ok: false, error: 'Missing payslip amounts.' }, 400)

  const { data: payment, error: payErr } = await admin
    .from('payment_approvals')
    .select('id, employee_id, company_id, status, period_start, period_end, audit_log')
    .eq('id', paymentId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (payErr) return json({ ok: false, error: payErr.message }, 500)
  if (!payment) return json({ ok: false, error: 'Payslip not found.' }, 404)
  if (payment.status !== 'pending') return json({ ok: false, error: 'Only a pending payslip can be edited.' }, 400)

  const { data: lockRow, error: lockErr } = await admin
    .from('payroll_period_locks')
    .select('company_id')
    .eq('company_id', companyId)
    .eq('period_start', payment.period_start)
    .eq('period_end', payment.period_end)
    .maybeSingle()
  if (lockErr) return json({ ok: false, error: lockErr.message }, 500)
  if (lockRow) return json({ ok: false, error: 'This payroll period is locked.' }, 409)

  const { data: emp, error: empErr } = await admin
    .from('employees')
    .select('work_days_weekly, daily_hours, daily_rate, hourly_rate, medical_aid_deduction, pension_deduction, union_deduction')
    .eq('id', payment.employee_id)
    .eq('company_id', companyId)
    .maybeSingle()
  if (empErr) return json({ ok: false, error: empErr.message }, 500)
  const totals = totalsFromLines(body.lines, companyId, emp as EmployeeDeductionFields | null)

  const daily = Number(emp?.daily_rate) || 0
  const hourly = Number(emp?.hourly_rate) || 0
  const employeeUpdate = {
    monthly_salary: totals.regular,
    uif_fixed_amount: lineAmount(body.lines.uif),
  }
  const { error: salaryErr } = await admin
    .from('employees')
    .update(employeeUpdate)
    .eq('id', payment.employee_id)
    .eq('company_id', companyId)
  if (salaryErr) return json({ ok: false, error: salaryErr.message }, 500)

  const history = await loadSalaryHistory(admin, companyId, payment.employee_id)
  const historyErr = await recordSalaryChange(
    admin,
    companyId,
    payment.employee_id,
    totals.regular,
    hourly,
    daily,
    payment.period_end,
    history
  )
  if (historyErr) return json({ ok: false, error: historyErr }, 500)

  const priorAudit = Array.isArray(payment.audit_log) ? payment.audit_log : []
  const { error: updErr } = await admin
    .from('payment_approvals')
    .update({
      regular_pay: totals.regular,
      overtime_pay: totals.overtime,
      base_salary: totals.regular,
      gross_pay: totals.gross,
      deductions: totals.deductions,
      net_pay: totals.net,
      bonus_amount: totals.bonus,
      bonus_note: totals.bonus > 0 ? 'Bonus' : null,
      manual_adjustment: totals.loanDeduction,
      adjustment_note: totals.loanDeduction > 0 ? 'Loan Deduction' : null,
      manual_paye_override: totals.paye,
      earnings_breakdown: totals.earnings,
      deductions_breakdown: totals.deductionLines,
      payslip_lines: totals.saved,
      pay_full_base_salary: body.overrides?.payFullBaseSalary ?? false,
      waive_penalties: body.overrides?.waivePenalties ?? false,
      audit_log: [
        ...priorAudit,
        {
          action: 'amounts updated',
          detail: `Payslip amounts edited by user ${actorUserId}. absence pay ${body.overrides?.waivePenalties ? 'on' : 'off'}`,
          at: new Date().toISOString(),
        },
      ],
    })
    .eq('id', paymentId)
    .eq('company_id', companyId)
  if (updErr) return json({ ok: false, error: updErr.message }, 500)

  return json({
    ok: true,
    gross_pay: totals.gross,
    deductions: totals.deductions,
    net_pay: totals.net,
  })
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
    if (body.action !== 'generate' && body.action !== 'recalculate' && body.action !== 'save_lines') {
      return json({ error: 'action must be "generate", "recalculate", or "save_lines"' }, 400)
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
    if (body.action === 'save_lines') {
      return await handleSaveLines(admin, body, user.id)
    }
    return await handleRecalculate(admin, userClient, body, user.id)
  } catch (err) {
    console.error('payroll-generate error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
