/**
 * Thin permission helper for web Supply & Assets (W5).
 * Uses my_permissions RPC; falls back by access_level when RPC empty/unavailable.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeAccessLevel } from '@/lib/employee-taxonomy'

export const PERM = {
  inventoryView: 'inventory.view',
  inventoryEdit: 'inventory.edit',
  suppliersView: 'suppliers.view',
  suppliersEdit: 'suppliers.edit',
  assetsView: 'assets.view',
  assetsEdit: 'assets.edit',
} as const

export type PermissionKey = (typeof PERM)[keyof typeof PERM]

type AccessLevel = string | null | undefined

const FALLBACK: Record<string, Partial<Record<PermissionKey, boolean>>> = {
  owner: {
    [PERM.inventoryView]: true, [PERM.inventoryEdit]: true,
    [PERM.suppliersView]: true, [PERM.suppliersEdit]: true,
    [PERM.assetsView]: true, [PERM.assetsEdit]: true,
  },
  hr: {
    [PERM.inventoryView]: true, [PERM.inventoryEdit]: true,
    [PERM.suppliersView]: true, [PERM.suppliersEdit]: true,
    [PERM.assetsView]: true, [PERM.assetsEdit]: true,
  },
  hr_admin: {
    [PERM.inventoryView]: true, [PERM.inventoryEdit]: true,
    [PERM.suppliersView]: true, [PERM.suppliersEdit]: true,
    [PERM.assetsView]: true, [PERM.assetsEdit]: true,
  },
  manager: {
    [PERM.inventoryView]: true, [PERM.inventoryEdit]: true,
    [PERM.suppliersView]: true, [PERM.suppliersEdit]: false,
    [PERM.assetsView]: true, [PERM.assetsEdit]: true,
  },
  employee: {
    [PERM.inventoryView]: true, [PERM.inventoryEdit]: false,
    [PERM.suppliersView]: false, [PERM.suppliersEdit]: false,
    [PERM.assetsView]: false, [PERM.assetsEdit]: false,
  },
}

export type PermissionSet = Set<string>

export async function loadPermissions(
  supabase: SupabaseClient,
  companyId: string,
  accessLevel?: AccessLevel,
): Promise<PermissionSet> {
  const set = new Set<string>()
  try {
    const { data } = await supabase.rpc('my_permissions', { p_company_id: companyId })
    const rows = (data ?? []) as { permission_key?: string; allowed?: boolean; key?: string }[]
    for (const row of rows) {
      const key = row.permission_key ?? row.key
      if (key && row.allowed !== false) set.add(key)
    }
  } catch {
    // fall through to access_level defaults
  }

  if (set.size === 0) {
    const level = normalizeAccessLevel(accessLevel)
    const map = FALLBACK[level] ?? FALLBACK.employee
    for (const [k, v] of Object.entries(map)) {
      if (v) set.add(k)
    }
  }
  return set
}

export function can(perms: PermissionSet | null | undefined, key: PermissionKey): boolean {
  if (!perms) return false
  return perms.has(key)
}
