/**
 * Farms helpers — livestock headcount, planting harvest totals, production lot qty.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  FarmInputUnit,
  FarmInputUsageType,
  FarmQtyUnit,
  LivestockEventType,
  PlantingEventType,
  ProductionEventType,
} from '@/types/farms'

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
      return quantity
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

export type RecordPlantingEventInput = {
  companyId: string
  farmId: string
  plantingId: string
  employeeId: string | null
  eventType: PlantingEventType
  quantity: number
  unit?: FarmQtyUnit
  eventDate?: string
  notes?: string | null
}

export type RecordPlantingEventResult =
  | { ok: true; totalHarvested: number }
  | { ok: false; message: string }

export async function recordPlantingEvent(
  supabase: SupabaseClient,
  input: RecordPlantingEventInput,
): Promise<RecordPlantingEventResult> {
  const qty = Math.max(0.001, Number(input.quantity) || 0)
  const { data: planting, error: pErr } = await supabase
    .from('farm_plantings')
    .select('id, total_harvested, harvest_unit, status')
    .eq('id', input.plantingId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  if (pErr || !planting) {
    return { ok: false, message: pErr?.message ?? 'Planting not found' }
  }

  const unit = input.unit ?? (planting.harvest_unit as FarmQtyUnit) ?? 'kg'
  const eventDate = input.eventDate ?? new Date().toISOString().slice(0, 10)
  const { error: eErr } = await supabase.from('farm_planting_events').insert({
    company_id: input.companyId,
    farm_id: input.farmId,
    planting_id: input.plantingId,
    event_type: input.eventType,
    event_date: eventDate,
    quantity: qty,
    unit,
    notes: input.notes?.trim() || null,
    recorded_by: input.employeeId,
  })

  if (eErr) {
    return { ok: false, message: eErr.message }
  }

  let totalHarvested = Number(planting.total_harvested ?? 0)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (input.eventType === 'harvest') {
    totalHarvested += qty
    patch.total_harvested = totalHarvested
    patch.harvest_unit = unit
  } else if (input.eventType === 'loss' && totalHarvested > 0) {
    totalHarvested = Math.max(0, totalHarvested - qty)
    patch.total_harvested = totalHarvested
  } else if (input.eventType === 'plant' && planting.status === 'planned') {
    patch.status = 'active'
  }

  const { error: uErr } = await supabase
    .from('farm_plantings')
    .update(patch)
    .eq('id', input.plantingId)
    .eq('company_id', input.companyId)

  if (uErr) {
    return { ok: false, message: uErr.message }
  }

  return { ok: true, totalHarvested }
}

export type RecordProductionEventInput = {
  companyId: string
  farmId: string
  lotId: string
  employeeId: string | null
  eventType: ProductionEventType
  quantity: number
  eventDate?: string
  notes?: string | null
}

export type RecordProductionEventResult =
  | { ok: true; quantityTotal: number }
  | { ok: false; message: string }

export async function recordProductionEvent(
  supabase: SupabaseClient,
  input: RecordProductionEventInput,
): Promise<RecordProductionEventResult> {
  const qty = Math.max(0.001, Number(input.quantity) || 0)
  const { data: lot, error: lErr } = await supabase
    .from('farm_production_lots')
    .select('id, quantity_total, status')
    .eq('id', input.lotId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  if (lErr || !lot) {
    return { ok: false, message: lErr?.message ?? 'Production lot not found' }
  }

  const current = Number(lot.quantity_total ?? 0)
  let next = current
  if (input.eventType === 'collect') next = current + qty
  else if (input.eventType === 'loss' || input.eventType === 'sale') next = current - qty
  else if (input.eventType === 'adjust') next = qty

  if (next < 0) {
    return { ok: false, message: `Cannot reduce quantity below 0 (current ${current}).` }
  }

  const eventDate = input.eventDate ?? new Date().toISOString().slice(0, 10)
  const { error: eErr } = await supabase.from('farm_production_events').insert({
    company_id: input.companyId,
    farm_id: input.farmId,
    lot_id: input.lotId,
    event_type: input.eventType,
    event_date: eventDate,
    quantity: qty,
    notes: input.notes?.trim() || null,
    recorded_by: input.employeeId,
  })

  if (eErr) {
    return { ok: false, message: eErr.message }
  }

  const { error: uErr } = await supabase
    .from('farm_production_lots')
    .update({ quantity_total: next, updated_at: new Date().toISOString() })
    .eq('id', input.lotId)
    .eq('company_id', input.companyId)

  if (uErr) {
    return { ok: false, message: uErr.message }
  }

  return { ok: true, quantityTotal: next }
}

export type RecordInputUsageInput = {
  companyId: string
  farmId: string
  employeeId: string | null
  usageType: FarmInputUsageType
  quantity: number
  unit: FarmInputUnit
  usageDate?: string
  productLabel?: string | null
  inventoryItemId?: string | null
  deductFromStock?: boolean
  groupId?: string | null
  animalId?: string | null
  plantingId?: string | null
  landUnitId?: string | null
  withdrawalUntil?: string | null
  notes?: string | null
}

export type RecordInputUsageResult =
  | { ok: true }
  | { ok: false; message: string }

/** Log feed/med/input usage; optionally deduct inventory via hr_inventory_stock_movement (adjust). */
export async function recordInputUsage(
  supabase: SupabaseClient,
  input: RecordInputUsageInput,
): Promise<RecordInputUsageResult> {
  const qty = Math.max(0.001, Number(input.quantity) || 0)
  let deducted = false

  if (input.deductFromStock && input.inventoryItemId) {
    const { error: stockErr } = await supabase.rpc('hr_inventory_stock_movement', {
      p_company_id: input.companyId,
      p_item_id: input.inventoryItemId,
      p_type: 'adjust',
      p_quantity: -qty,
      p_actor_employee_id: input.employeeId,
      p_job_id: null,
      p_note: `Farm input: ${input.usageType}${input.productLabel ? ` · ${input.productLabel}` : ''}`,
      p_unit_cost: null,
    })
    if (stockErr) {
      return { ok: false, message: stockErr.message }
    }
    deducted = true
  }

  const { error } = await supabase.from('farm_input_usages').insert({
    company_id: input.companyId,
    farm_id: input.farmId,
    usage_type: input.usageType,
    usage_date: input.usageDate ?? new Date().toISOString().slice(0, 10),
    quantity: qty,
    unit: input.unit,
    product_label: input.productLabel?.trim() || null,
    inventory_item_id: input.inventoryItemId || null,
    deducted_from_stock: deducted,
    group_id: input.groupId || null,
    animal_id: input.animalId || null,
    planting_id: input.plantingId || null,
    land_unit_id: input.landUnitId || null,
    withdrawal_until: input.withdrawalUntil || null,
    notes: input.notes?.trim() || null,
    recorded_by: input.employeeId,
  })

  if (error) {
    return { ok: false, message: error.message }
  }
  return { ok: true }
}
