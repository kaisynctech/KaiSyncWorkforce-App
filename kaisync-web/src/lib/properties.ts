/**
 * Properties helpers — occupancy sync when residents move in/out of units.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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
