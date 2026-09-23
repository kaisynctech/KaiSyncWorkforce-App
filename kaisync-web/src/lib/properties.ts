/**
 * Properties helpers — occupancy sync when residents move in/out of units.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PropertyKind, UnitType } from '@/types/database'

export const UNIT_TYPES: { value: UnitType; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'studio', label: 'Studio' },
  { value: 'room', label: 'Room' },
  { value: 'bed', label: 'Bed' },
  { value: 'cottage', label: 'Cottage' },
  { value: 'back_room', label: 'Back room' },
  { value: 'house', label: 'House' },
  { value: 'shop', label: 'Shop' },
  { value: 'office', label: 'Office' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'parking', label: 'Parking' },
  { value: 'single', label: 'Single' },
  { value: 'twin', label: 'Twin' },
  { value: 'double', label: 'Double' },
  { value: 'family', label: 'Family' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'suite', label: 'Suite' },
  { value: 'other', label: 'Other' },
]

/** Unit types commonly used for student residences */
export const STUDENT_UNIT_TYPES: UnitType[] = ['room', 'bed', 'studio', 'flat', 'other']

/** Unit types commonly used for B&B / guest houses */
export const GUEST_HOUSE_UNIT_TYPES: UnitType[] = [
  'single', 'twin', 'double', 'family', 'luxury', 'suite', 'room', 'other',
]

export type UnitNamingScheme = 'prefix_number' | 'number_only' | 'zero_pad' | 'door'

export type BulkUnitSpec = {
  count: number
  unitType: UnitType | null
  /** Label before the number, e.g. "Room", "Door", "Family" — empty for number-only */
  namePrefix: string
  naming: UnitNamingScheme
  startAt: number
}

const MAX_BULK_UNITS = 2000
const INSERT_CHUNK = 250

export function clampBulkCount(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), MAX_BULK_UNITS)
}

/** Build unit_number labels for a bulk create request. */
export function buildBulkUnitNumbers(spec: BulkUnitSpec): string[] {
  const count = clampBulkCount(spec.count)
  if (count === 0) return []
  const start = Number.isFinite(spec.startAt) && spec.startAt >= 0 ? Math.floor(spec.startAt) : 1
  const prefix = spec.namePrefix.trim()
  const pad = Math.max(String(start + count - 1).length, spec.naming === 'zero_pad' ? 3 : 1)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const num = start + i
    if (spec.naming === 'number_only') {
      out.push(String(num))
    } else if (spec.naming === 'zero_pad') {
      const body = String(num).padStart(pad, '0')
      out.push(prefix ? `${prefix} ${body}` : body)
    } else if (spec.naming === 'door') {
      out.push(`Door ${num}`)
    } else {
      // prefix_number
      out.push(prefix ? `${prefix} ${num}` : String(num))
    }
  }
  return out
}

export function previewBulkUnitNames(spec: BulkUnitSpec, sample = 3): string {
  const names = buildBulkUnitNumbers(spec)
  if (names.length === 0) return 'No rooms yet'
  if (names.length <= sample + 1) return names.join(', ')
  const head = names.slice(0, sample).join(', ')
  return `${head} … ${names[names.length - 1]} (${names.length} total)`
}

export type BulkUnitInsertRow = {
  company_id: string
  site_id: string
  unit_number: string
  unit_type: string | null
  is_occupied: boolean
}

/** Expand one or more bulk specs into insert rows (dedupes unit_number case-insensitively). */
export function expandBulkUnitRows(
  companyId: string,
  siteId: string,
  specs: BulkUnitSpec[],
): { rows: BulkUnitInsertRow[]; skippedDuplicates: number } {
  const seen = new Set<string>()
  const rows: BulkUnitInsertRow[] = []
  let skippedDuplicates = 0
  for (const spec of specs) {
    const numbers = buildBulkUnitNumbers(spec)
    for (const unit_number of numbers) {
      const key = unit_number.trim().toLowerCase()
      if (!key || seen.has(key)) {
        skippedDuplicates += 1
        continue
      }
      seen.add(key)
      rows.push({
        company_id: companyId,
        site_id: siteId,
        unit_number: unit_number.trim(),
        unit_type: spec.unitType,
        is_occupied: false,
      })
    }
  }
  return { rows: rows.slice(0, MAX_BULK_UNITS), skippedDuplicates }
}

/** Insert units in chunks. Returns count inserted or error message. */
export async function insertUnitsBulk(
  supabase: SupabaseClient,
  rows: BulkUnitInsertRow[],
): Promise<{ ok: true; inserted: number } | { ok: false; message: string; inserted: number }> {
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const { error } = await supabase.from('units').insert(chunk)
    if (error) {
      return { ok: false, message: error.message, inserted }
    }
    inserted += chunk.length
  }
  return { ok: true, inserted }
}

export const PROPERTY_KINDS: { value: PropertyKind; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'student_accommodation', label: 'Student accommodation' },
  { value: 'guest_house', label: 'B&B / Guest house' },
  { value: 'other', label: 'Other' },
]

export function unitTypeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return UNIT_TYPES.find(t => t.value === value)?.label ?? value.replace(/_/g, ' ')
}

export function propertyKindLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return PROPERTY_KINDS.find(k => k.value === value)?.label ?? value.replace(/_/g, ' ')
}

/** Recompute unit.is_occupied from current residents (no move_out_date). */
export async function syncUnitOccupancy(
  supabase: SupabaseClient,
  companyId: string,
  unitId: string | null | undefined,
): Promise<void> {
  if (!unitId) return

  const { count, error } = await supabase
    .from('residents')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('unit_id', unitId)
    .is('move_out_date', null)

  if (error) {
    console.error('syncUnitOccupancy count failed', error.message)
    return
  }

  const occupied = (count ?? 0) > 0
  const { error: uErr } = await supabase
    .from('units')
    .update({ is_occupied: occupied })
    .eq('id', unitId)
    .eq('company_id', companyId)

  if (uErr) {
    console.error('syncUnitOccupancy update failed', uErr.message)
  }
}
