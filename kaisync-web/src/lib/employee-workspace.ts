import type { SupabaseClient } from '@supabase/supabase-js'
import { getCodeSession } from '@/lib/auth/code-session'
import {
  resolveEmployeeModuleFlags,
  ALL_MODULES_ENABLED,
  type EmployeeModuleFlags,
  type EnabledModules,
} from './company-modules'
import type { DispatchSettings } from './branch-geofence'

export type CompanyWorkspace = {
  id: string
  name: string
  enabled_modules: EnabledModules
  dispatch_settings: DispatchSettings
}

export type EmployeeWorkspace = {
  id: string
  company_id: string
  name: string
  surname: string
  branch: string | null
  registration_status: string
  is_active: boolean
  access_level: string
}

export async function loadCompanyWorkspace(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyWorkspace | null> {
  const { data } = await supabase
    .from('companies')
    .select('id, name, enabled_modules, dispatch_settings')
    .eq('id', companyId)
    .maybeSingle()

  if (data) {
    return {
      id: data.id,
      name: data.name ?? '',
      enabled_modules: (data.enabled_modules as EnabledModules) ?? {},
      dispatch_settings: (data.dispatch_settings as DispatchSettings) ?? {},
    }
  }

  // Code-auth may not have RLS read on companies — use session company + permissive modules
  const cs = getCodeSession()
  if (cs?.company_id === companyId) {
    return {
      id: cs.company_id,
      name: cs.company.name,
      enabled_modules: {},
      dispatch_settings: {},
    }
  }

  return null
}

export async function loadEmployeeWorkspace(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<EmployeeWorkspace | null> {
  const { data } = await supabase
    .from('employees')
    .select('id, company_id, name, surname, branch, registration_status, is_active, access_level')
    .eq('id', employeeId)
    .maybeSingle()

  if (data) {
    return {
      id: data.id,
      company_id: data.company_id,
      name: data.name ?? '',
      surname: data.surname ?? '',
      branch: data.branch ?? null,
      registration_status: data.registration_status ?? 'active',
      is_active: data.is_active !== false,
      access_level: data.access_level ?? 'employee',
    }
  }

  // Code-auth fallback from kf_cs (employee_* RPCs already validated the session)
  const cs = getCodeSession()
  if (cs?.employee_id === employeeId) {
    return {
      id: cs.employee_id,
      company_id: cs.company_id,
      name: cs.employee.name,
      surname: cs.employee.surname,
      branch: cs.employee.branch ?? null,
      registration_status: cs.employee.registration_status ?? 'active',
      is_active: cs.employee.is_active !== false,
      access_level: cs.employee.access_level,
    }
  }

  return null
}

/**
 * Tenant module flags. SaaS plan layer is permissive when subscription
 * cannot be loaded (matches FeatureAccessService offline/legacy behaviour).
 */
export function moduleFlagsForCompany(company: CompanyWorkspace | null): EmployeeModuleFlags {
  if (!company) return ALL_MODULES_ENABLED
  return resolveEmployeeModuleFlags(company.enabled_modules)
}

export function isPendingMembership(emp: EmployeeWorkspace | null): boolean {
  if (!emp) return false
  return emp.registration_status === 'pending' || !emp.is_active
}
