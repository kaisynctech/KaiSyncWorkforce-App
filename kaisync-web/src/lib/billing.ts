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
}

export type BillingSummary = {
  company_id: string
  plan_name: string
  status: string
  renewal_date: string | null
  currency: string
  base_price: number
  monthly_charge: number
  employees: BillingMeter
  contractors: BillingMeter
  properties: BillingMeter
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
