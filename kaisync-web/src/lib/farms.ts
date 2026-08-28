/**
 * Farms livestock helpers — apply headcount deltas when recording events.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LivestockEventType } from '@/types/farms'

export type RecordLivestockEventInput = {
  companyId: string
  farmId: string
  groupId: string
  employeeId: string | null
  eventType: LivestockEventType
  quantity: number
  eventDate?: string
  notes?: string | null
  toLandUnitId?: string | null
  fromLandUnitId?: string | null
  animalId?: string | null
}

export type RecordLivestockEventResult =
  | { ok: true; newHeadcount: number }
  | { ok: false; message: string }

function headcountDelta(eventType: LivestockEventType, quantity: number): number {
  switch (eventType) {
    case 'intake':
      return quantity
    case 'death':
    case 'cull':
    case 'sale':
      return -quantity
    case 'count_adjust':
      return quantity // caller passes signed intent via quantity + notes; we treat as absolute add
    case 'move':
      return 0
    default:
      return 0
  }
}

export async function recordLivestockEvent(
  supabase: SupabaseClient,
  input: RecordLivestockEventInput,
): Promise<RecordLivestockEventResult> {
  const qty = Math.max(1, Math.floor(input.quantity))
  const { data: group, error: gErr } = await supabase
    .from('farm_livestock_groups')
    .select('id, headcount, land_unit_id, status')
    .eq('id', input.groupId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  if (gErr || !group) {
    return { ok: false, message: gErr?.message ?? 'Livestock group not found' }
  }

  const current = Number(group.headcount ?? 0)
  let delta = headcountDelta(input.eventType, qty)

  // count_adjust: quantity is the new absolute headcount when notes start with "set:"
  // Default count_adjust treats quantity as the delta to apply (can be passed as positive only from UI).
  if (input.eventType === 'count_adjust') {
    delta = qty - current
  }

  const next = current + delta
  if (next < 0) {
    return { ok: false, message: `Cannot reduce headcount below 0 (current ${current}).` }
  }

  const eventDate = input.eventDate ?? new Date().toISOString().slice(0, 10)
  const { error: eErr } = await supabase.from('farm_livestock_events').insert({
    company_id: input.companyId,
    farm_id: input.farmId,
    group_id: input.groupId,
    animal_id: input.animalId ?? null,
    event_type: input.eventType,
    event_date: eventDate,
    quantity: qty,
    from_land_unit_id: input.fromLandUnitId ?? group.land_unit_id ?? null,
    to_land_unit_id: input.toLandUnitId ?? null,
    notes: input.notes?.trim() || null,
    recorded_by: input.employeeId,
  })

  if (eErr) {
    return { ok: false, message: eErr.message }
  }

  const patch: Record<string, unknown> = {
    headcount: next,
    updated_at: new Date().toISOString(),
  }
  if (input.eventType === 'move' && input.toLandUnitId) {
    patch.land_unit_id = input.toLandUnitId
  }

  const { error: uErr } = await supabase
    .from('farm_livestock_groups')
    .update(patch)
    .eq('id', input.groupId)
    .eq('company_id', input.companyId)

  if (uErr) {
    return { ok: false, message: uErr.message }
  }

  if (input.animalId && (input.eventType === 'death' || input.eventType === 'cull' || input.eventType === 'sale')) {
    const status = input.eventType === 'sale' ? 'sold' : input.eventType === 'cull' ? 'culled' : 'dead'
    await supabase
      .from('farm_animals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', input.animalId)
      .eq('company_id', input.companyId)
  }

  return { ok: true, newHeadcount: next }
}
