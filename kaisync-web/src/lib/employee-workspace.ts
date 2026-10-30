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
  /** False opts this person out of branch clock-in enforcement. */
  enforce_branch_geofence: boolean
  registration_status: string
  is_active: boolean
  access_level: string
}

type CachedCompanyWs = { at: number; data: CompanyWorkspace | null }
const COMPANY_WS_CACHE_MS = 30_000
const companyWsCache = new Map<string, CachedCompanyWs>()
/** Concurrent callers share one request per id instead of each missing the cache. */
const companyWsInFlight = new Map<string, Promise<CompanyWorkspace | null>>()
const employeeWsInFlight = new Map<string, Promise<EmployeeWorkspace | null>>()
type CachedEmployeeWs = { at: number; data: EmployeeWorkspace }
const EMPLOYEE_WS_CACHE_MS = 30_000
const employeeWsCache = new Map<string, CachedEmployeeWs>()
/** Bumped on clear so a request that started before sign-out cannot repopulate the cache. */
let companyWsGeneration = 0

/**
 * Code-login workers have no Supabase Auth session and query as `anon`, which has
 * no SELECT policy on companies/employees — those reads always return no rows.
 */
async function isCodeSessionOnly(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  return !data.session
}

function codeSessionCompanyWorkspace(companyId: string): CompanyWorkspace | null {
  // Code-auth has no RLS read on companies — use session company + permissive modules
  const cs = getCodeSession()
  if (cs?.company_id !== companyId) return null
  return {
    id: cs.company_id,
    name: cs.company.name,
    enabled_modules: {},
    dispatch_settings: {},
  }
}

function codeSessionEmployeeWorkspace(employeeId: string): EmployeeWorkspace | null {
  // Code-auth fallback from kf_cs (employee_* RPCs already validated the session)
  const cs = getCodeSession()
  if (cs?.employee_id !== employeeId) return null
  return {
    id: cs.employee_id,
    company_id: cs.company_id,
    name: cs.employee.name,
    surname: cs.employee.surname,
    branch_id: null,
    branch: cs.employee.branch ?? null,
    enforce_branch_geofence: true,
    registration_status: cs.employee.registration_status ?? 'active',
    is_active: cs.employee.is_active !== false,
    access_level: cs.employee.access_level,
  }
}

export function loadCompanyWorkspace(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyWorkspace | null> {
  const cached = companyWsCache.get(companyId)
  if (cached && Date.now() - cached.at < COMPANY_WS_CACHE_MS) {
    return Promise.resolve(cached.data)
  }
  const running = companyWsInFlight.get(companyId)
  if (running) return running

  const request = fetchCompanyWorkspace(supabase, companyId, companyWsGeneration).finally(() => {
    if (companyWsInFlight.get(companyId) === request) companyWsInFlight.delete(companyId)
  })
  companyWsInFlight.set(companyId, request)
  return request
}

async function fetchCompanyWorkspace(
  supabase: SupabaseClient,
  companyId: string,
  generation: number,
): Promise<CompanyWorkspace | null> {
  const remember = (workspace: CompanyWorkspace) => {
    if (generation === companyWsGeneration) {
      companyWsCache.set(companyId, { at: Date.now(), data: workspace })
    }
    return workspace
  }

  const sessionCompany = codeSessionCompanyWorkspace(companyId)
  if (sessionCompany && await isCodeSessionOnly(supabase)) {
    return remember(sessionCompany)
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

  if (data) return remember(companyWorkspaceFromRow(data))

  const fallback = codeSessionCompanyWorkspace(companyId)
  return fallback ? remember(fallback) : null
}

/** Invalidate company workspace cache (modules change / sign-out). */
export function clearCompanyWorkspaceCache(companyId?: string) {
  companyWsGeneration += 1
  if (companyId) {
    companyWsCache.delete(companyId)
    companyWsInFlight.delete(companyId)
  } else {
    companyWsCache.clear()
    companyWsInFlight.clear()
  }
}

/** Drop shared in-flight employee workspace requests (sign-out). */
export function clearEmployeeWorkspaceCache(employeeId?: string) {
  if (employeeId) {
    employeeWsInFlight.delete(employeeId)
    employeeWsCache.delete(employeeId)
  } else {
    employeeWsInFlight.clear()
    employeeWsCache.clear()
  }
}

/** The companies row the dashboard layout already read: use it instead of reading it again. */
export function primeCompanyWorkspace(row: {
  id: string
  name?: string | null
  enabled_modules?: unknown
  custom_settings?: unknown
}) {
  companyWsCache.set(row.id, { at: Date.now(), data: companyWorkspaceFromRow(row) })
}

/** The employees row the dashboard layout already read: use it instead of reading it again. */
export function primeEmployeeWorkspace(row: Record<string, unknown> & { id: string; company_id: string }) {
  employeeWsCache.set(row.id, { at: Date.now(), data: employeeWorkspaceFromRow(row) })
}

function companyWorkspaceFromRow(data: {
  id: string
  name?: string | null
  enabled_modules?: unknown
  custom_settings?: unknown
}): CompanyWorkspace {
  const custom = (data.custom_settings ?? {}) as Record<string, unknown>
  const nestedDispatch = custom.dispatch_settings
  const dispatch_settings: DispatchSettings =
    nestedDispatch && typeof nestedDispatch === 'object'
      ? (nestedDispatch as DispatchSettings)
      : {}
  return {
    id: data.id,
    name: data.name ?? '',
    enabled_modules: (data.enabled_modules as EnabledModules) ?? {},
    dispatch_settings,
  }
}

function employeeWorkspaceFromRow(data: Record<string, unknown> & { id: string; company_id: string }): EmployeeWorkspace {
  return {
    id: data.id,
    company_id: data.company_id,
    name: (data.name as string | null) ?? '',
    surname: (data.surname as string | null) ?? '',
    branch_id: (data.branch_id as string | null) ?? null,
    branch: (data.branch as string | null) ?? null,
    enforce_branch_geofence: data.enforce_branch_geofence !== false,
    registration_status: (data.registration_status as string | null) ?? 'active',
    is_active: data.is_active !== false,
    access_level: (data.access_level as string | null) ?? 'employee',
  }
}

export function loadEmployeeWorkspace(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<EmployeeWorkspace | null> {
  const cached = employeeWsCache.get(employeeId)
  if (cached && Date.now() - cached.at < EMPLOYEE_WS_CACHE_MS) {
    return Promise.resolve(cached.data)
  }
  const running = employeeWsInFlight.get(employeeId)
  if (running) return running

  const request = fetchEmployeeWorkspace(supabase, employeeId).finally(() => {
    if (employeeWsInFlight.get(employeeId) === request) employeeWsInFlight.delete(employeeId)
  })
  employeeWsInFlight.set(employeeId, request)
  return request
}

async function fetchEmployeeWorkspace(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<EmployeeWorkspace | null> {
  const sessionEmployee = codeSessionEmployeeWorkspace(employeeId)
  if (sessionEmployee && await isCodeSessionOnly(supabase)) return sessionEmployee

  const { data } = await supabase
    .from('employees')
    .select('id, company_id, name, surname, branch_id, branch, enforce_branch_geofence, registration_status, is_active, access_level')
    .eq('id', employeeId)
    .maybeSingle()

  if (data) return employeeWorkspaceFromRow(data)

  return codeSessionEmployeeWorkspace(employeeId)
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
