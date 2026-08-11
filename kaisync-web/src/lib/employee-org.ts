/**
 * Canonical org fields for employees (web source of truth):
 *   branch_id, manager_id, department
 *
 * Legacy dual-column mirrors kept in sync for payroll readers:
 *   branch (text), manager_user_id (auth uid), cost_center
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type OrgWriteFields = {
  department: string | null
  cost_center: string | null
  branch_id: string | null
  branch: string | null
  manager_id: string | null
  manager_user_id: string | null
}

/** Resolve manager's auth user id for scope checks. */
export async function resolveManagerUserId(
  supabase: SupabaseClient,
  managerEmployeeId: string | null | undefined
): Promise<string | null> {
  if (!managerEmployeeId) return null
  const { data, error } = await supabase
    .from('employees')
    .select('user_id')
    .eq('id', managerEmployeeId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { user_id: string | null }).user_id ?? null
}

/** Resolve branch display name from branches.id for legacy `branch` text. */
export async function resolveBranchName(
  supabase: SupabaseClient,
  companyId: string,
  branchId: string | null | undefined
): Promise<string | null> {
  if (!branchId) return null
  const { data, error } = await supabase
    .from('branches')
    .select('name')
    .eq('id', branchId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error || !data) return null
  const name = (data as { name: string | null }).name?.trim()
  return name || null
}

/**
 * Build dual-write org columns from canonical inputs.
 * Prefer explicit branchName when provided; otherwise resolve from branchId.
 */
export async function buildOrgWriteFields(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    department?: string | null
    branchId?: string | null
    branchName?: string | null
    managerId?: string | null
  }
): Promise<OrgWriteFields> {
  const dept = input.department?.trim() || null
  const branchId = input.branchId?.trim() || null
  const managerId = input.managerId?.trim() || null

  let branchName = input.branchName?.trim() || null
  if (branchId && !branchName) {
    branchName = await resolveBranchName(supabase, companyId, branchId)
  }
  if (!branchId) branchName = null

  const managerUserId = await resolveManagerUserId(supabase, managerId)

  return {
    department: dept,
    cost_center: dept,
    branch_id: branchId,
    branch: branchName,
    manager_id: managerId,
    manager_user_id: managerUserId,
  }
}

/** Match branch by name (case-insensitive) within a company — used by import. */
export async function resolveBranchIdByName(
  supabase: SupabaseClient,
  companyId: string,
  branchName: string | null | undefined
): Promise<{ id: string; name: string } | null> {
  const target = branchName?.trim()
  if (!target) return null
  const { data, error } = await supabase
    .from('branches')
    .select('id, name')
    .eq('company_id', companyId)
    .order('name')
  if (error || !data) return null
  const hit = (data as { id: string; name: string }[]).find(
    b => (b.name ?? '').trim().toLowerCase() === target.toLowerCase()
  )
  return hit ?? null
}

/** Match manager by "Name Surname" (case-insensitive) within a company — used by import. */
export async function resolveManagerIdByName(
  supabase: SupabaseClient,
  companyId: string,
  managerName: string | null | undefined
): Promise<string | null> {
  const target = managerName?.trim().toLowerCase()
  if (!target) return null
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, surname')
    .eq('company_id', companyId)
    .eq('is_active', true)
  if (error || !data) return null
  const hit = (data as { id: string; name: string; surname: string }[]).find(e => {
    const full = `${e.name ?? ''} ${e.surname ?? ''}`.trim().toLowerCase()
    return full === target
  })
  return hit?.id ?? null
}
