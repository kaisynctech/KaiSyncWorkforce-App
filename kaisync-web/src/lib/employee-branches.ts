import type { SupabaseClient } from '@supabase/supabase-js'

export type ExtraBranch = { branch_id: string }

/** Extra branches only. The home branch stays on employees.branch_id. */
export async function listExtraBranchIds(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('employee_branch_assignments')
    .select('branch_id')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, ids: (data ?? []).map(row => row.branch_id).filter(Boolean) }
}

/** Home branch plus extra branches. Used by clock-in, including code sign-in. */
export async function listAssignedBranchIds(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  sessionToken: string | null,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('employee_assigned_branch_ids', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_session_token: sessionToken,
  })
  if (error || !Array.isArray(data)) return []
  return data.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** Replace extra-branch rows. The home branch is not stored here. */
export async function saveExtraBranches(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  homeBranchId: string | null,
  extraBranchIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const keep = [...new Set(extraBranchIds.filter(id => id && id !== homeBranchId))]
  const { data, error } = await supabase
    .from('employee_branch_assignments')
    .select('id, branch_id')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
  if (error) return { ok: false, message: error.message }

  const existing = (data ?? []) as { id: string; branch_id: string }[]
  const removeIds = existing.filter(row => !keep.includes(row.branch_id)).map(row => row.id)
  const have = new Set(existing.map(row => row.branch_id))
  const insertRows = keep
    .filter(branchId => !have.has(branchId))
    .map(branchId => ({ company_id: companyId, employee_id: employeeId, branch_id: branchId }))

  if (removeIds.length > 0) {
    const removed = await supabase.from('employee_branch_assignments').delete().in('id', removeIds)
    if (removed.error) return { ok: false, message: removed.error.message }
  }
  if (insertRows.length > 0) {
    const inserted = await supabase.from('employee_branch_assignments').insert(insertRows)
    if (inserted.error) return { ok: false, message: inserted.error.message }
  }
  return { ok: true }
}
