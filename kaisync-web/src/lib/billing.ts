import type { SupabaseClient } from '@supabase/supabase-js'

export type BillingMeter = {
  count: number
  included: number
  overage: number
  unit_price: number
  overage_charge: number
  meter?: string
}

export type BillingLine = {
  description: string
  amount: number
  kind?: 'charge' | 'price_list'
}

export type BillingCycle = 'monthly' | 'annual'
export type PlanCode = 'starter' | 'kaiflow_standard'

export type BillingSummary = {
  company_id: string
  plan_name: string
  plan_code?: string
  /** False while a trial company hasn't picked a plan yet (shown plan is the one that fits). */
  plan_chosen?: boolean
  /** Starter's hard limit (15); null/absent when there is none. */
  max_employees?: number | null
  billing_cycle?: BillingCycle
  pending_plan_code?: string | null
  pending_cycle?: BillingCycle | null
  annual_period_start?: string | null
  annual_period_end?: string | null
  next_billing_date?: string | null
  trial_ends_at?: string | null
  /** The bill for the whole cycle: monthly = one month; annual = 12 months, less the discount, plus VAT. */
  cycle_subtotal?: number
  discount?: number
  discount_label?: string | null
  vat?: number
  cycle_total?: number
  status: string
  renewal_date: string | null
  currency: string
  base_price: number
  monthly_charge: number
  standard_monthly_charge?: number
  price_override?: number | null
  billable?: boolean
  employees: BillingMeter
  contractors: BillingMeter
  client_portals: BillingMeter
  properties: BillingMeter
  farms: BillingMeter
  lines: BillingLine[]
}

export function formatZar(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export async function loadCompanyBillingSummary(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ ok: true; summary: BillingSummary } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('company_get_billing_summary', {
    p_company_id: companyId,
  })
  if (error) return { ok: false, message: error.message }
  if (!data || typeof data !== 'object') return { ok: false, message: 'No billing data returned' }
  return { ok: true, summary: data as BillingSummary }
}

/** What a plan would cost for these counts (billing_quote). */
export type PlanQuote = {
  plan_code: string
  plan_name: string
  cycle: BillingCycle
  lines: BillingLine[]
  monthly_subtotal: number
  subtotal: number
  discount: number
  discount_label: string | null
  vat: number
  total: number
  over_limit: boolean
}

export async function quotePlan(
  supabase: SupabaseClient,
  opts: { planCode: PlanCode; cycle: BillingCycle; employees: number; contractors: number; clientPortals: number; properties: number; farms: number },
): Promise<PlanQuote | null> {
  const { data, error } = await supabase.rpc('billing_quote', {
    p_plan_code: opts.planCode, p_cycle: opts.cycle, p_employees: opts.employees, p_contractors: opts.contractors,
    p_client_portals: opts.clientPortals, p_properties: opts.properties, p_farms: opts.farms,
  })
  if (error || !data) return null
  return data as PlanQuote
}

export type ChangePlanResult =
  | { ok: true; when: 'trial_end' | 'now' | 'renewal'; amount?: number; from?: string | null }
  | { ok: false; message: string }

/** Choose (during the trial) or change the plan/cycle. Bigger plan: now, the difference billed; smaller or cycle: next renewal. */
export async function changePlan(
  supabase: SupabaseClient, companyId: string, planCode: PlanCode, cycle: BillingCycle,
): Promise<ChangePlanResult> {
  const { data, error } = await supabase.rpc('billing_change_plan', { p_company_id: companyId, p_plan_code: planCode, p_cycle: cycle })
  if (error) {
    const hint = (error as { hint?: string }).hint
    if (/PLAN_EMPLOYEE_LIMIT|Starter limit/.test(error.message)) return { ok: false, message: hint || 'You have more active employees than Starter allows (15). Choose Business.' }
    if (/NOT_ALLOWED/.test(error.message)) return { ok: false, message: 'Only the owner, HR and admins can change the plan.' }
    return { ok: false, message: error.message }
  }
  const r = data as { when: 'trial_end' | 'now' | 'renewal'; amount?: number; from?: string | null }
  return { ok: true, when: r.when, amount: r.amount, from: r.from ?? null }
}

export const PLAN_LABEL: Record<string, string> = { starter: 'Starter', kaiflow_standard: 'Business' }
