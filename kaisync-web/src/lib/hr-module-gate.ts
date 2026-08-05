/**
 * HR dashboard module gate — mirrors Sidebar HrNavFlags so deep links
 * cannot bypass disabled company modules.
 * Optional permissionKey ANDs company_role_permissions (via my_permissions).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveHrNavFlags,
  type EnabledModules,
  type HrNavFlags,
} from '@/lib/company-modules'
import { resolveFinanceNavFlag } from '@/lib/finance-gate'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import { can, loadPermissions, type PermissionKey } from '@/lib/permissions'

export type HrModuleFlag = keyof HrNavFlags

export async function resolveHrModuleAccess(
  supabase: SupabaseClient,
  companyId: string,
  flag: HrModuleFlag,
  options?: { permissionKey?: PermissionKey; accessLevel?: string | null },
): Promise<{ allowed: boolean; flags: HrNavFlags }> {
  const workspace = await loadCompanyWorkspace(supabase, companyId)
  const enabled = (workspace?.enabled_modules ?? {}) as EnabledModules
  const { finance } = await resolveFinanceNavFlag(supabase, companyId, enabled)
  const flags = resolveHrNavFlags(enabled, finance)
  let allowed = Boolean(flags[flag])
  if (allowed && options?.permissionKey) {
    const perms = await loadPermissions(supabase, companyId, options.accessLevel)
    allowed = can(perms, options.permissionKey)
  }
  return { allowed, flags }
}

export function hrModuleDeniedMessage(flag: HrModuleFlag): string {
  const labels: Partial<Record<HrModuleFlag, string>> = {
    employees: 'Employees',
    workTeams: 'Work Teams',
    leave: 'Leave',
    attendance: 'Attendance',
    teamPunch: 'Team Punch',
    timeTemplates: 'Time Templates',
    scheduling: 'Scheduling',
    payroll: 'Payroll',
    contractors: 'Contractors',
    projects: 'Projects',
    clients: 'Clients',
    suppliers: 'Suppliers',
    assets: 'Assets',
    inventory: 'Inventory',
    jobs: 'Jobs',
    incidents: 'Incidents',
    compliancePacks: 'Compliance Packs',
  }
  const name = labels[flag] ?? 'This module'
  return `${name} is disabled for your company. Enable it in Settings → Modules.`
}

export function hrPermissionDeniedMessage(flag: HrModuleFlag): string {
  const labels: Partial<Record<HrModuleFlag, string>> = {
    contractors: 'Contractors',
    projects: 'Projects',
    clients: 'Clients',
    suppliers: 'Suppliers',
    assets: 'Assets',
    inventory: 'Inventory',
    jobs: 'Jobs',
    incidents: 'Incidents',
    compliancePacks: 'Compliance Packs',
  }
  const name = labels[flag] ?? 'This module'
  return `You do not have permission to view ${name}. Ask an owner to grant access in role permissions.`
}
