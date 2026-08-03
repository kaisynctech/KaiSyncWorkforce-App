/**
 * Employee activate / deactivate / delete.
 *
 * Soft-delete-first policy (Workforce Phase 5):
 * - Prefer setEmployeeActive(isActive: false) for offboarding / archive.
 * - Hard deleteEmployee is owner/HR only, audited server-side, and removes
 *   that employee’s punches first — use only when the record must be purged.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Soft activate/deactivate via audited RPC (also syncs company_relationships). */
export async function setEmployeeActive(
  supabase: SupabaseClient,
  opts: { companyId: string; employeeId: string; isActive: boolean }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('set_employee_active', {
    p_company_id: opts.companyId,
    p_employee_id: opts.employeeId,
    p_is_active: opts.isActive,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/**
 * Hard delete via audited RPC (owner/hr). Prefer setEmployeeActive(false) first.
 * Removes punches for that employee before deleting the row.
 */
export async function deleteEmployee(
  supabase: SupabaseClient,
  opts: { companyId: string; employeeId: string }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('delete_employee', {
    p_company_id: opts.companyId,
    p_employee_id: opts.employeeId,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
