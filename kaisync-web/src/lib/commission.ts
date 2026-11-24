/**
 * Piece 10b: sales commission. Settings, reps and payouts go through commission_* functions (office, HR and above);
 * reps read their own through employee_list_commission. Earned follows what the client has paid on the quote's invoices.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CommissionBasis = 'profit' | 'sale'
export type EarnedOn = 'payment' | 'paid_in_full'
export type CommissionSettings = { basis: CommissionBasis; percent: number | null; earned_on: EarnedOn }
export type CommissionRep = { employee_id: string; name: string | null; percent: number | null; active: boolean }
export type CommissionRow = {
  id: string; quote_id: string; quote_number: string | null; quote_title: string | null; client_name: string | null
  employee_id?: string; rep_name?: string | null; basis: CommissionBasis; percent: number; base_amount: number
  commission_amount: number; paid_share: number; earned: number; paid_amount: number; to_pay: number
  status: 'open' | 'cancelled'; accepted_at: string | null
}

export const BASIS_LABEL: Record<CommissionBasis, string> = { profit: 'profit', sale: 'sale value' }

const MESSAGES: Record<string, string> = {
  NOT_ALLOWED: 'You don’t have permission to do this.',
  OWN_COMMISSION: 'Someone else has to pay out your own commission.',
  BAD_PERCENT: 'The % must be between 0 and 100.',
  BAD_SETTING: 'Choose how commission is worked out and when it’s earned.',
  EMPLOYEE_NOT_FOUND: 'That person isn’t in this company.',
  UNAUTHORIZED: 'Your session has expired. Sign in again.',
  COMMISSION_REP_LOCKED: 'Commission has been paid out on this quote, so the sales rep can’t change.',
}
export function commissionError(message: string | null | undefined): string {
  const m = String(message ?? '')
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(k)) return v
  return m || 'Something went wrong. Please try again.'
}

/** "5" / "7,5" → 5 / 7.5; empty → null; anything else → NaN. */
export function parsePercent(v: string): number | null {
  const t = v.trim().replace(',', '.').replace('%', '')
  return t === '' ? null : Number(t)
}

/** One line on how a commission is made up, e.g. "10% of profit R 4 000,00". */
export const howWorkedOut = (r: Pick<CommissionRow, 'percent' | 'basis' | 'base_amount'>, fmt: (n: number) => string) =>
  `${Number(r.percent)}% of ${BASIS_LABEL[r.basis]} ${fmt(Number(r.base_amount))}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (s: SupabaseClient, fn: string, args: Record<string, unknown>) => (s.rpc as any)(fn, args) as Promise<{ data: unknown; error: { message: string } | null }>

const num = (v: unknown) => Number(v) || 0
const normRow = (r: CommissionRow): CommissionRow => ({
  ...r, percent: num(r.percent), base_amount: num(r.base_amount), commission_amount: num(r.commission_amount),
  paid_share: num(r.paid_share), earned: num(r.earned), paid_amount: num(r.paid_amount), to_pay: num(r.to_pay),
})

export async function loadCommission(s: SupabaseClient, companyId: string) {
  const { data, error } = await rpc(s, 'commission_overview', { p_company_id: companyId })
  if (error) return { ok: false as const, message: commissionError(error.message) }
  const d = data as { settings: CommissionSettings; reps: CommissionRep[]; rows: CommissionRow[] }
  const st = d.settings ?? { basis: 'profit', percent: null, earned_on: 'payment' }
  return {
    ok: true as const,
    settings: { ...st, percent: st.percent == null ? null : Number(st.percent) },
    reps: (d.reps ?? []).map(r => ({ ...r, percent: r.percent == null ? null : Number(r.percent) })),
    rows: (d.rows ?? []).map(normRow),
  }
}

export async function saveCommissionSettings(s: SupabaseClient, companyId: string, st: CommissionSettings) {
  const { error } = await rpc(s, 'commission_save_settings', { p_company_id: companyId, p_basis: st.basis, p_percent: st.percent, p_earned_on: st.earned_on })
  return error ? { ok: false as const, message: commissionError(error.message) } : { ok: true as const }
}

export async function setRep(s: SupabaseClient, companyId: string, employeeId: string, percent: number | null, active = true) {
  const { error } = await rpc(s, 'commission_set_rep', { p_company_id: companyId, p_employee_id: employeeId, p_percent: percent, p_active: active })
  return error ? { ok: false as const, message: commissionError(error.message) } : { ok: true as const }
}

export async function repOptions(s: SupabaseClient, companyId: string): Promise<{ id: string; name: string | null }[]> {
  const { data, error } = await rpc(s, 'commission_rep_options', { p_company_id: companyId })
  return error ? [] : ((data ?? []) as { id: string; name: string | null }[])
}

export async function markCommissionPaid(s: SupabaseClient, ids: string[], paidOn: string, method: string, reference: string) {
  const { data, error } = await rpc(s, 'commission_mark_paid', { p_ids: ids, p_paid_on: paidOn, p_method: method, p_reference: reference })
  return error ? { ok: false as const, message: commissionError(error.message) } : { ok: true as const, count: Number(data) || 0 }
}

type Who = { companyId: string; employeeId: string; sessionToken: string | null }

export async function myCommission(s: SupabaseClient, w: Who) {
  const { data, error } = await rpc(s, 'employee_list_commission', { p_company_id: w.companyId, p_employee_id: w.employeeId, p_session_token: w.sessionToken })
  if (error) return { ok: false as const, message: commissionError(error.message) }
  const d = data as { settings: { basis: CommissionBasis; earned_on: EarnedOn }; rows: CommissionRow[]; payments: { amount: number; paid_on: string; reference: string | null }[] }
  return { ok: true as const, settings: d.settings, rows: (d.rows ?? []).map(normRow), payments: (d.payments ?? []).map(p => ({ ...p, amount: num(p.amount) })) }
}

export async function isCommissionRep(s: SupabaseClient, w: Who): Promise<boolean> {
  const { data, error } = await rpc(s, 'employee_is_commission_rep', { p_company_id: w.companyId, p_employee_id: w.employeeId, p_session_token: w.sessionToken })
  return !error && data === true
}

/** Totals for a list: earned so far, already paid, still to pay. */
export function totals(rows: CommissionRow[]) {
  return rows.reduce((t, r) => ({ earned: t.earned + r.earned, paid: t.paid + r.paid_amount, toPay: t.toPay + r.to_pay, total: t.total + (r.status === 'open' ? r.commission_amount : 0) }),
    { earned: 0, paid: 0, toPay: 0, total: 0 })
}
