/**
 * Extra charges on a guest stay. They are copied onto the checkout invoice.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundFinancial } from '@/lib/finance-calc'

export type StayExtra = {
  id: string
  stay_id: string
  description: string
  amount: number
}

export function sumStayExtras(rows: { amount: number | null }[]): number {
  return roundFinancial(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0))
}

export async function listStayExtras(
  supabase: SupabaseClient,
  opts: { companyId: string; stayIds: string[] },
): Promise<{ ok: true; data: StayExtra[] } | { ok: false; message: string }> {
  if (opts.stayIds.length === 0) return { ok: true, data: [] }
  const { data, error } = await supabase
    .from('property_stay_charges')
    .select('id, stay_id, description, amount')
    .eq('company_id', opts.companyId)
    .in('stay_id', opts.stayIds)
    .order('created_at')
    .limit(500)
  if (error) return { ok: false, message: error.message }
  return {
    ok: true,
    data: (data ?? []).map(row => ({
      id: row.id as string,
      stay_id: row.stay_id as string,
      description: row.description as string,
      amount: Number(row.amount) || 0,
    })),
  }
}

export async function addStayExtra(
  supabase: SupabaseClient,
  input: {
    companyId: string
    stayId: string
    employeeId?: string | null
    description: string
    amount: number
  },
): Promise<{ ok: true; data: StayExtra } | { ok: false; message: string }> {
  const description = input.description.trim()
  if (!description) return { ok: false, message: 'Describe the extra charge.' }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, message: 'Extra charge amount must be greater than zero.' }
  }

  const { data: stay, error: stayErr } = await supabase
    .from('property_stays')
    .select('id, status')
    .eq('id', input.stayId)
    .eq('company_id', input.companyId)
    .maybeSingle()
  if (stayErr || !stay) return { ok: false, message: stayErr?.message ?? 'Stay not found' }
  if (stay.status !== 'reserved' && stay.status !== 'checked_in') {
    return { ok: false, message: 'Extras can only be added before the guest is checked out.' }
  }

  const { data, error } = await supabase
    .from('property_stay_charges')
    .insert({
      company_id: input.companyId,
      stay_id: input.stayId,
      description,
      amount: roundFinancial(input.amount),
      created_by: input.employeeId ?? null,
    })
    .select('id, stay_id, description, amount')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Failed to add extra charge' }
  return {
    ok: true,
    data: {
      id: data.id as string,
      stay_id: data.stay_id as string,
      description: data.description as string,
      amount: Number(data.amount) || 0,
    },
  }
}

export async function deleteStayExtra(
  supabase: SupabaseClient,
  opts: { companyId: string; chargeId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from('property_stay_charges')
    .delete()
    .eq('id', opts.chargeId)
    .eq('company_id', opts.companyId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
