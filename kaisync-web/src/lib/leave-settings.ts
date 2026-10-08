/**
 * Live store: company_settings.leave_settings (jsonb)
 * via get_company_settings / upsert_company_settings.
 * There is no leave_types table.
 *
 * Legacy keys: annual_leave_days, sick_leave_days, …
 * Canonical leave_requests.leave_type values are Title Case (LEAVE_TYPES).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnnualDays, LEAVE_TYPES } from '@/lib/leave-policy'

export type LeaveSettingsMap = Record<string, unknown>

/** Map Title Case leave type → possible leave_settings jsonb keys . */
const SETTINGS_KEYS_BY_TYPE: Record<string, string[]> = {
  'Annual Leave': ['annual_leave_days', 'annual_leave', 'Annual Leave'],
  'Sick Leave': ['sick_leave_days', 'sick_leave', 'Sick Leave'],
  'Family Responsibility': [
    'family_responsibility_days',
    'family_responsibility',
    'Family Responsibility',
  ],
  'Maternity Leave': ['maternity_leave_days', 'maternity_leave', 'Maternity Leave'],
  'Paternity Leave': ['paternity_leave_days', 'paternity_leave', 'Paternity Leave'],
  'Study Leave': ['study_leave_days', 'study_leave', 'Study Leave'],
  'Unpaid Leave': ['unpaid_leave_days', 'unpaid_leave', 'Unpaid Leave'],
}

function asPositiveInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return null
}

function canonicalLeaveType(leaveType: string): string {
  return (
    LEAVE_TYPES.find(t => t.key.toLowerCase() === leaveType.toLowerCase())?.key
    ?? leaveType
  )
}

/** Inclusive upper bound for a company entitlement (Unpaid Leave default is 365). */
export const LEAVE_DAYS_MAX = 366

export type LeaveEntitlementField = {
  leaveType: string
  label: string
  settingsKey: string
  defaultDays: number
}

/** One row per leave type, using the canonical leave_settings key. */
export function leaveEntitlementFields(): LeaveEntitlementField[] {
  return LEAVE_TYPES.map(t => ({
    leaveType: t.key,
    label: t.label,
    settingsKey: SETTINGS_KEYS_BY_TYPE[t.key][0],
    defaultDays: t.annualDays,
  }))
}

/** Whole days, 0 through LEAVE_DAYS_MAX. Blank and fractions are rejected. */
export function parseLeaveDayInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n > LEAVE_DAYS_MAX) return null
  return n
}

/**
 * Write canonical day keys onto a copy of leave_settings.
 * Unknown keys already stored on the company are kept.
 */
export function mergeLeaveDaySettings(
  existing: LeaveSettingsMap | null | undefined,
  daysByType: Record<string, number>,
): LeaveSettingsMap {
  const next: LeaveSettingsMap = { ...(existing ?? {}) }
  for (const field of leaveEntitlementFields()) {
    const n = daysByType[field.leaveType]
    if (!Number.isInteger(n) || n < 0 || n > LEAVE_DAYS_MAX) {
      throw new Error(`${field.label} must be a whole number from 0 to ${LEAVE_DAYS_MAX}.`)
    }
    next[field.settingsKey] = n
  }
  return next
}

/** Annual entitlement for a leave type, preferring company leave_settings. */
export function getCompanyAnnualDays(
  leaveType: string,
  settings?: LeaveSettingsMap | null
): number {
  const canonical = canonicalLeaveType(leaveType)
  const keys = SETTINGS_KEYS_BY_TYPE[canonical]
  if (settings && keys) {
    for (const key of keys) {
      const n = asPositiveInt(settings[key])
      if (n != null) return n
    }
  }
  return getAnnualDays(canonical)
}

export type LeaveTypeOption = {
  key: string
  label: string
  annualDays: number
  color: string
  icon: string
}

/** LEAVE_TYPES with annual days overridden by company settings. */
export function resolveLeaveTypeOptions(
  settings?: LeaveSettingsMap | null
): LeaveTypeOption[] {
  return LEAVE_TYPES.map(t => ({
    key: t.key,
    label: t.label,
    annualDays: getCompanyAnnualDays(t.key, settings),
    color: t.color,
    icon: t.icon,
  }))
}

export async function loadLeaveSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ ok: true; data: LeaveSettingsMap } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('get_company_settings', {
    p_company_id: companyId,
  })
  if (error) return { ok: false, message: error.message }

  const row = (data ?? {}) as { leave_settings?: LeaveSettingsMap }
  const settings =
    row.leave_settings && typeof row.leave_settings === 'object'
      ? row.leave_settings
      : {}
  return { ok: true, data: settings }
}

type CompanySettingsRow = {
  timezone?: string | null
  currency?: string | null
  vat_rate?: number | string | null
  branding?: unknown
  logo_url?: string | null
  primary_color?: string | null
  secondary_color?: string | null
  payroll_preferences?: unknown
  leave_settings?: LeaveSettingsMap | null
}

function asSettingsNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/**
 * Persist leave entitlements. Echoes the rest of company_settings because
 * upsert_company_settings replaces jsonb columns present in the INSERT row.
 */
export async function saveLeaveDaySettings(
  supabase: SupabaseClient,
  companyId: string,
  daysByType: Record<string, number>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('get_company_settings', {
    p_company_id: companyId,
  })
  if (error) return { ok: false, message: error.message }

  const row = (data ?? {}) as CompanySettingsRow
  const existing =
    row.leave_settings && typeof row.leave_settings === 'object'
      ? row.leave_settings
      : {}

  let leave_settings: LeaveSettingsMap
  try {
    leave_settings = mergeLeaveDaySettings(existing, daysByType)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Invalid leave days.' }
  }

  const branding =
    row.branding && typeof row.branding === 'object' && !Array.isArray(row.branding)
      ? row.branding
      : {}
  const payroll_preferences =
    row.payroll_preferences && typeof row.payroll_preferences === 'object' && !Array.isArray(row.payroll_preferences)
      ? row.payroll_preferences
      : {}

  const { error: saveError } = await supabase.rpc('upsert_company_settings', {
    p_company_id: companyId,
    p_payload: {
      timezone: row.timezone ?? 'Africa/Johannesburg',
      currency: row.currency ?? 'ZAR',
      vat_rate: asSettingsNumber(row.vat_rate, 15),
      branding,
      logo_url: row.logo_url ?? null,
      primary_color: row.primary_color ?? null,
      secondary_color: row.secondary_color ?? null,
      payroll_preferences,
      leave_settings,
    },
  })
  if (saveError) return { ok: false, message: saveError.message }
  return { ok: true }
}
