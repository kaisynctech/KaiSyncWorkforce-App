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
  /** Canonical FK → branches.id */
  branch_id: string | null
  /** Legacy text mirror of branch name */
  branch: string | null
  registration_status: string
  is_active: boolean
  access_level: string
}

type CachedCompanyWs = { at: number; data: CompanyWorkspace | null }
const COMPANY_WS_CACHE_MS = 30_000
const companyWsCache = new Map<string, CachedCompanyWs>()

export async function loadCompanyWorkspace(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyWorkspace | null> {
  const cached = companyWsCache.get(companyId)
  if (cached && Date.now() - cached.at < COMPANY_WS_CACHE_MS) {
    return cached.data
  }

  // Live schema: companies has enabled_modules + custom_settings (no dispatch_settings column).
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, enabled_modules, custom_settings')
    .eq('id', companyId)
    .maybeSingle()

  if (error) {
    console.error('[loadCompanyWorkspace]', error.message)
  }

  if (data) {
    const custom = (data.custom_settings ?? {}) as Record<string, unknown>
    const nestedDispatch = custom.dispatch_settings
    const dispatch_settings: DispatchSettings =
      nestedDispatch && typeof nestedDispatch === 'object'
        ? (nestedDispatch as DispatchSettings)
        : {}
    const workspace: CompanyWorkspace = {
      id: data.id,
      name: data.name ?? '',
      enabled_modules: (data.enabled_modules as EnabledModules) ?? {},
      dispatch_settings,
    }
    companyWsCache.set(companyId, { at: Date.now(), data: workspace })
    return workspace
  }

  // Code-auth may not have RLS read on companies — use session company + permissive modules
  const cs = getCodeSession()
  if (cs?.company_id === companyId) {
    const workspace: CompanyWorkspace = {
      id: cs.company_id,
      name: cs.company.name,
      enabled_modules: {},
      dispatch_settings: {},
    }
    companyWsCache.set(companyId, { at: Date.now(), data: workspace })
    return workspace
  }

  return null
}

/** Invalidate company workspace cache (modules change / sign-out). */
export function clearCompanyWorkspaceCache(companyId?: string) {
  if (companyId) companyWsCache.delete(companyId)
  else companyWsCache.clear()
}

export async function loadEmployeeWorkspace(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<EmployeeWorkspace | null> {
  const { data } = await supabase
    .from('employees')
    .select('id, company_id, name, surname, branch_id, branch, registration_status, is_active, access_level')
    .eq('id', employeeId)
    .maybeSingle()

  if (data) {
    return {
      id: data.id,
      company_id: data.company_id,
      name: data.name ?? '',
      surname: data.surname ?? '',
      branch_id: data.branch_id ?? null,
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
      branch_id: null,
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
