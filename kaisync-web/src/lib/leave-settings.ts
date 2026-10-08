/**
 * Live store: company_settings.leave_settings (jsonb)
 * via get_company_settings / upsert_company_settings.
 * There is no leave_types table.
 *
 * Legacy keys: annual_leave_days, sick_leave_days, …
 * Canonical leave_requests.leave_type values are Title Case (LEAVE_TYPES).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnnualDays, LEAVE_TYPES, type LeaveSummary } from '@/lib/leave-policy'

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

/** Stored on company_settings.leave_settings. There is no leave_types table. */
export const CUSTOM_LEAVE_TYPES_KEY = 'custom_leave_types'

export const CUSTOM_LEAVE_TYPE_LIMIT = 20

export type CustomLeaveType = {
  name: string
  days: number
}

function isBuiltInLeaveType(name: string): boolean {
  const needle = name.trim().toLowerCase()
  return LEAVE_TYPES.some(t => t.key.toLowerCase() === needle)
}

/** Display name for an additional company leave policy. */
export function normalizeLeavePolicyName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!/^[A-Za-z0-9][A-Za-z0-9 '&./-]{1,59}$/.test(name)) return null
  return name
}

export function leavePolicyNameError(raw: string, existingNames: string[]): string | null {
  const name = normalizeLeavePolicyName(raw)
  if (!name) {
    return 'Use 2–60 letters or numbers. Spaces, hyphens, and apostrophes are allowed.'
  }
  if (isBuiltInLeaveType(name)) return `${name} is already a standard leave type.`
  if (existingNames.some(n => n.toLowerCase() === name.toLowerCase())) {
    return `${name} is already on this company.`
  }
  return null
}

export function readCustomLeaveTypes(settings?: LeaveSettingsMap | null): CustomLeaveType[] {
  const raw = settings?.[CUSTOM_LEAVE_TYPES_KEY]
  if (!Array.isArray(raw)) return []
  const out: CustomLeaveType[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? normalizeLeavePolicyName(record.name) : null
    const days = asPositiveInt(record.days)
    if (!name || days == null || days > LEAVE_DAYS_MAX) continue
    if (isBuiltInLeaveType(name)) continue
    if (out.some(t => t.name.toLowerCase() === name.toLowerCase())) continue
    out.push({ name, days })
  }
  return out.slice(0, CUSTOM_LEAVE_TYPE_LIMIT)
}

export function parseCustomLeaveTypes(
  rows: { name: string; days: string }[],
): { ok: true; types: CustomLeaveType[] } | { ok: false; message: string } {
  if (rows.length > CUSTOM_LEAVE_TYPE_LIMIT) {
    return { ok: false, message: `A company can have at most ${CUSTOM_LEAVE_TYPE_LIMIT} additional leave policies.` }
  }
  const types: CustomLeaveType[] = []
  for (const row of rows) {
    const message = leavePolicyNameError(row.name, types.map(t => t.name))
    if (message) return { ok: false, message }
    const name = normalizeLeavePolicyName(row.name)
    const days = parseLeaveDayInput(row.days)
    if (!name || days == null) {
      return { ok: false, message: 'Each additional leave policy needs a name and whole days from 0 to 366.' }
    }
    types.push({ name, days })
  }
  return { ok: true, types }
}

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
  customTypes?: CustomLeaveType[] | null,
): LeaveSettingsMap {
  const next: LeaveSettingsMap = { ...(existing ?? {}) }
  for (const field of leaveEntitlementFields()) {
    const n = daysByType[field.leaveType]
    if (!Number.isInteger(n) || n < 0 || n > LEAVE_DAYS_MAX) {
      throw new Error(`${field.label} must be a whole number from 0 to ${LEAVE_DAYS_MAX}.`)
    }
    next[field.settingsKey] = n
  }
  if (customTypes) {
    const parsed = parseCustomLeaveTypes(
      customTypes.map(t => ({ name: t.name, days: String(t.days) })),
    )
    if (!parsed.ok) throw new Error(parsed.message)
    next[CUSTOM_LEAVE_TYPES_KEY] = parsed.types
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
  if (settings) {
    const custom = readCustomLeaveTypes(settings).find(
      t => t.name.toLowerCase() === canonical.toLowerCase(),
    )
    if (custom) return custom.days
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

/** Standard types plus company additional policies, with saved day counts. */
export function resolveLeaveTypeOptions(
  settings?: LeaveSettingsMap | null
): LeaveTypeOption[] {
  const builtIn = LEAVE_TYPES.map(t => ({
    key: t.key,
    label: t.label,
    annualDays: getCompanyAnnualDays(t.key, settings),
    color: t.color,
    icon: t.icon,
  }))
  const custom = readCustomLeaveTypes(settings).map(t => ({
    key: t.name,
    label: t.name,
    annualDays: t.days,
    color: '#0F766E',
    icon: 'event_available',
  }))
  return [...builtIn, ...custom]
}

type LeaveBalanceRequest = {
  leave_type: string
  start_date: string
  total_days: number
  status: string
}

/** Year-to-date balances for every company leave type, including additional policies. */
export function summarizeCompanyLeave(
  requests: LeaveBalanceRequest[],
  settings?: LeaveSettingsMap | null,
): LeaveSummary[] {
  const thisYear = new Date().getFullYear()
  const yearly = requests.filter(r => new Date(r.start_date).getFullYear() === thisYear)
  const options = resolveLeaveTypeOptions(settings)
  const seen = new Set(options.map(o => o.key.toLowerCase()))
  for (const request of yearly) {
    const key = request.leave_type?.trim()
    if (!key || seen.has(key.toLowerCase())) continue
    seen.add(key.toLowerCase())
    options.push({
      key,
      label: key,
      annualDays: getCompanyAnnualDays(key, settings),
      color: '#64748B',
      icon: 'event_busy',
    })
  }
  return options.map(option => {
    const forType = yearly.filter(r => r.leave_type.toLowerCase() === option.key.toLowerCase())
    const approved = forType
      .filter(r => r.status === 'approved')
      .reduce((sum, r) => sum + r.total_days, 0)
    const pending = forType
      .filter(r => r.status === 'pending')
      .reduce((sum, r) => sum + r.total_days, 0)
    return {
      leave_type: option.key,
      annual_days: option.annualDays,
      days_approved: approved,
      days_pending: pending,
      days_remaining: Math.max(0, option.annualDays - approved),
    }
  }).filter(s => s.days_approved > 0 || s.days_pending > 0 || s.annual_days > 0)
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
  customTypes?: CustomLeaveType[] | null,
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
    leave_settings = mergeLeaveDaySettings(existing, daysByType, customTypes)
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
