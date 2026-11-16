/**
 * Claims and commission paid on the payslip (piece 10). The database links what's due to a pending payslip
 * (payslip_extras) and settles it when the payslip is approved; this file calls those functions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PayslipExtraItem } from '@/lib/payslip-extra-lines'

export type PayVia = 'separately' | 'payslip'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (s: SupabaseClient, fn: string, args: Record<string, unknown>) => (s.rpc as any)(fn, args) as Promise<{ data: unknown; error: { message: string } | null }>

const MESSAGES: Record<string, string> = {
  NOT_ALLOWED: 'You don’t have permission to do this.',
  PAYSLIP_NOT_PENDING: 'This payslip is already approved, so its lines can’t change.',
  BAD_SETTING: 'Choose separately or on the payslip.',
}
export function payViaError(message: string | null | undefined): string {
  const m = String(message ?? '')
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(k)) return v
  return m || 'Something went wrong. Please try again.'
}

/** Claims and commission on this payslip (links what's due first when the payslip is still pending). */
export async function payslipExtras(s: SupabaseClient, paymentApprovalId: string): Promise<{ ok: true; items: PayslipExtraItem[] } | { ok: false; message: string }> {
  const { data, error } = await rpc(s, 'payslip_extras', { p_payment_approval_id: paymentApprovalId })
  if (error) return { ok: false, message: payViaError(error.message) }
  return { ok: true, items: ((data ?? []) as PayslipExtraItem[]).map(i => ({ ...i, amount: Number(i.amount) || 0 })) }
}

/** Take a claim or commission off a pending payslip: it waits for the next one. */
export async function removePayslipExtra(s: SupabaseClient, paymentApprovalId: string, lineId: string) {
  const [kind, id] = lineId.split(':')
  const { error } = await rpc(s, 'payslip_remove_extra', { p_payment_approval_id: paymentApprovalId, p_kind: kind, p_id: id })
  return error ? { ok: false as const, message: payViaError(error.message) } : { ok: true as const }
}

export async function savePayVia(s: SupabaseClient, companyId: string, claims: PayVia | null, commission: PayVia | null) {
  const { error } = await rpc(s, 'pay_via_save', { p_company_id: companyId, p_claims: claims, p_commission: commission })
  return error ? { ok: false as const, message: payViaError(error.message) } : { ok: true as const }
}

export async function loadPayVia(s: SupabaseClient, companyId: string): Promise<{ claims: PayVia; commission: PayVia }> {
  const { data } = await s.from('companies').select('claims_pay_via, commission_pay_via').eq('id', companyId).maybeSingle()
  const d = (data ?? {}) as { claims_pay_via?: PayVia; commission_pay_via?: PayVia }
  return { claims: d.claims_pay_via ?? 'separately', commission: d.commission_pay_via ?? 'separately' }
}
