import type { SupabaseClient } from '@supabase/supabase-js'
import type { PayrollSettings } from '@/types/database'

/**
 * Live store: company_settings.payroll_preferences (jsonb)
 * via get_company_settings / upsert_company_settings.
 * There is no payroll_settings table.
 */

export const PAYROLL_SETTINGS_DEFAULTS: Omit<PayrollSettings, 'id' | 'company_id'> = {
  payroll_default_pay_basis: 'monthly',
  default_hourly_rate: 0,
  overtime_multiplier: 1.5,
  overtime_threshold_hours: 8,
  allow_overtime_for_salary: false,
  pay_full_salary_for_mid_month_joiners: false,
  pay_salary_on_public_holidays: true,
  pay_hourly_on_public_holidays: true,
  late_threshold_minutes: 15,
  ot_start_after_minutes: 30,
  deduct_absent_from_pay: true,
  salary_ignore_attendance_deductions: false,
  absent_penalty_mode: 'none',
  absent_penalty_threshold: 1,
  absent_penalty_deduct_days: 1,
  late_penalty_mode: 'none',
  late_penalty_threshold: 30,
  late_penalty_deduct_hours: 0.5,
  early_penalty_mode: 'none',
  early_penalty_threshold: 30,
  early_penalty_deduct_hours: 0.5,
  uif_enabled: true,
  uif_rate_percent: 1,
  uif_ceiling_monthly: 17712,
  paye_enabled: true,
  default_paye_rate_percent: 18,
  use_sars_tax_tables: false,
  payslip_release_day: 25,
  auto_release_payslips_on_release_day: false,
  public_holidays_text: '',
}

type Prefs = Record<string, unknown>

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

/** Merge stored jsonb with defaults into the web PayrollSettings shape. */
export function prefsToPayrollSettings(
  companyId: string,
  prefs: Prefs | null | undefined
): PayrollSettings {
  const p = prefs ?? {}
  const d = PAYROLL_SETTINGS_DEFAULTS
  return {
    id: companyId,
    company_id: companyId,
    payroll_default_pay_basis: asString(p.payroll_default_pay_basis, d.payroll_default_pay_basis),
    default_hourly_rate: asNumber(p.default_hourly_rate, d.default_hourly_rate),
    overtime_multiplier: asNumber(p.overtime_multiplier, d.overtime_multiplier),
    overtime_threshold_hours: asNumber(p.overtime_threshold_hours, d.overtime_threshold_hours),
    allow_overtime_for_salary: asBool(p.allow_overtime_for_salary, d.allow_overtime_for_salary),
    pay_full_salary_for_mid_month_joiners: asBool(
      p.pay_full_salary_for_mid_month_joiners,
      d.pay_full_salary_for_mid_month_joiners
    ),
    pay_salary_on_public_holidays: asBool(p.pay_salary_on_public_holidays, d.pay_salary_on_public_holidays),
    pay_hourly_on_public_holidays: asBool(p.pay_hourly_on_public_holidays, d.pay_hourly_on_public_holidays),
    late_threshold_minutes: asNumber(p.late_threshold_minutes, d.late_threshold_minutes),
    ot_start_after_minutes: asNumber(p.ot_start_after_minutes, d.ot_start_after_minutes),
    deduct_absent_from_pay: asBool(p.deduct_absent_from_pay, d.deduct_absent_from_pay),
    salary_ignore_attendance_deductions: asBool(
      p.salary_ignore_attendance_deductions,
      d.salary_ignore_attendance_deductions
    ),
    absent_penalty_mode: asString(p.absent_penalty_mode, d.absent_penalty_mode),
    absent_penalty_threshold: asNumber(p.absent_penalty_threshold, d.absent_penalty_threshold),
    absent_penalty_deduct_days: asNumber(p.absent_penalty_deduct_days, d.absent_penalty_deduct_days),
    late_penalty_mode: asString(p.late_penalty_mode, d.late_penalty_mode),
    late_penalty_threshold: asNumber(p.late_penalty_threshold, d.late_penalty_threshold),
    late_penalty_deduct_hours: asNumber(p.late_penalty_deduct_hours, d.late_penalty_deduct_hours),
    early_penalty_mode: asString(p.early_penalty_mode, d.early_penalty_mode),
    early_penalty_threshold: asNumber(p.early_penalty_threshold, d.early_penalty_threshold),
    early_penalty_deduct_hours: asNumber(p.early_penalty_deduct_hours, d.early_penalty_deduct_hours),
    uif_enabled: asBool(p.uif_enabled, d.uif_enabled),
    uif_rate_percent: asNumber(p.uif_rate_percent, d.uif_rate_percent),
    uif_ceiling_monthly: asNumber(p.uif_ceiling_monthly, d.uif_ceiling_monthly),
    paye_enabled: asBool(p.paye_enabled, d.paye_enabled),
    default_paye_rate_percent: asNumber(p.default_paye_rate_percent, d.default_paye_rate_percent),
    use_sars_tax_tables: asBool(p.use_sars_tax_tables, d.use_sars_tax_tables),
    payslip_release_day: asNumber(p.payslip_release_day, d.payslip_release_day),
    auto_release_payslips_on_release_day: asBool(
      p.auto_release_payslips_on_release_day,
      d.auto_release_payslips_on_release_day
    ),
    public_holidays_text: asString(p.public_holidays_text, d.public_holidays_text),
  }
}

/** Persistable jsonb (no id). Also writes PayrollPolicy-compatible aliases for engines. */
export function payrollSettingsToPrefs(settings: Partial<PayrollSettings>): Prefs {
  const merged = prefsToPayrollSettings(settings.company_id ?? '', settings as Prefs)
  const {
    id: _id,
    company_id: _cid,
    ...rest
  } = merged

  return {
    ...rest,
    // KaiFlow.Payroll.PayrollPolicy.WriteTo aliases (best-effort parity)
    payroll_salary_ignore_attendance_deductions: rest.salary_ignore_attendance_deductions,
    payroll_allow_ot_for_salary: rest.allow_overtime_for_salary,
    payroll_pay_salary_public_holidays: rest.pay_salary_on_public_holidays,
    payroll_pay_hourly_public_holidays: rest.pay_hourly_on_public_holidays,
    payroll_pay_full_salary_mid_month_join: rest.pay_full_salary_for_mid_month_joiners,
    payroll_payslip_release_day: rest.payslip_release_day,
    payroll_auto_release_payslips: rest.auto_release_payslips_on_release_day,
    payroll_uif_enabled: rest.uif_enabled,
    payroll_uif_rate_percent: rest.uif_rate_percent,
    payroll_uif_ceiling_monthly: rest.uif_ceiling_monthly,
    payroll_paye_enabled: rest.paye_enabled,
    payroll_default_paye_rate_percent: rest.default_paye_rate_percent,
    payroll_use_sars_tax_tables: rest.use_sars_tax_tables,
    payroll_public_holidays: rest.public_holidays_text,
    payroll_absent_mode: rest.absent_penalty_mode,
    payroll_absent_threshold: rest.absent_penalty_threshold,
    payroll_absent_deduct_days: rest.absent_penalty_deduct_days,
    payroll_late_mode: rest.late_penalty_mode,
    payroll_late_threshold: rest.late_penalty_threshold,
    payroll_late_deduct_hours: rest.late_penalty_deduct_hours,
    payroll_early_mode: rest.early_penalty_mode,
    payroll_early_threshold: rest.early_penalty_threshold,
    payroll_early_deduct_hours: rest.early_penalty_deduct_hours,
  }
}

export async function loadPayrollSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ ok: true; settings: PayrollSettings } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('get_company_settings', {
    p_company_id: companyId,
  })
  if (error) return { ok: false, message: error.message }

  const row = (data ?? {}) as { payroll_preferences?: Prefs }
  const prefs =
    row.payroll_preferences && typeof row.payroll_preferences === 'object'
      ? row.payroll_preferences
      : {}
  return { ok: true, settings: prefsToPayrollSettings(companyId, prefs) }
}

export async function savePayrollSettings(
  supabase: SupabaseClient,
  companyId: string,
  settings: Partial<PayrollSettings>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('upsert_company_settings', {
    p_company_id: companyId,
    p_payload: {
      payroll_preferences: payrollSettingsToPrefs({ ...settings, company_id: companyId }),
    },
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
