/**
 * HR dashboard module gate — mirrors Sidebar HrNavFlags so deep links
 * cannot bypass disabled company modules.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveHrNavFlags,
  type EnabledModules,
  type HrNavFlags,
} from '@/lib/company-modules'
import { resolveFinanceNavFlag } from '@/lib/finance-gate'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'

export type HrModuleFlag = keyof HrNavFlags

export async function resolveHrModuleAccess(
  supabase: SupabaseClient,
  companyId: string,
  flag: HrModuleFlag
): Promise<{ allowed: boolean; flags: HrNavFlags }> {
  const workspace = await loadCompanyWorkspace(supabase, companyId)
  const enabled = (workspace?.enabled_modules ?? {}) as EnabledModules
  const { finance } = await resolveFinanceNavFlag(supabase, companyId, enabled)
  const flags = resolveHrNavFlags(enabled, finance)
  return { allowed: Boolean(flags[flag]), flags }
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
  }
  const name = labels[flag] ?? 'This module'
  return `${name} is disabled for your company. Enable it in Settings → Modules.`
}
