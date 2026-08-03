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

/** Hard delete via audited RPC (owner/hr). Removes punches for that employee first. */
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
