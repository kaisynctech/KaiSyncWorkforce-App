import type { SupabaseClient } from '@supabase/supabase-js'
import {
  clearCodeSession,
  getCodeSession,
  saveCodeSession,
  updateCodeSessionToken,
  type CodeLoginRpcResult,
  type CodeSession,
} from './code-session'

export type EmployeeMembership = {
  employee_id: string
  company_id: string
  registration_status: string
  is_active: boolean
  name: string
  surname: string
  position: string | null
  branch: string | null
  access_level: string
  company_name: string
  company_code: string
}

export function isMembershipPending(m: EmployeeMembership): boolean {
  return m.registration_status === 'pending'
}

export function isMembershipRejected(m: EmployeeMembership): boolean {
  return m.registration_status === 'rejected'
}

export function isMembershipApproved(m: EmployeeMembership): boolean {
  return m.registration_status === 'active' && m.is_active
}

function asMembership(row: Record<string, unknown>): EmployeeMembership {
  return {
    employee_id: String(row.employee_id ?? ''),
    company_id: String(row.company_id ?? ''),
    registration_status: String(row.registration_status ?? 'active'),
    is_active: row.is_active !== false,
    name: String(row.name ?? ''),
    surname: String(row.surname ?? ''),
    position: row.position != null ? String(row.position) : null,
    branch: row.branch != null ? String(row.branch) : null,
    access_level: String(row.access_level ?? 'employee'),
    company_name: String(row.company_name ?? ''),
    company_code: String(row.company_code ?? ''),
  }
}

export async function signInWithCode(
  supabase: SupabaseClient,
  companyCode: string,
  employeeCode: string,
): Promise<CodeSession> {
  const { data, error } = await supabase.rpc('employee_sign_in_with_code', {
    p_company_code: companyCode.trim().toUpperCase(),
    p_employee_code: employeeCode.trim(),
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('ACCOUNT_LOCKED')) {
      throw new Error('Your account has been locked. Contact your HR administrator to unlock it.')
    }
    throw new Error('Invalid company code or login code.')
  }
  if (!data) throw new Error('Invalid company code or login code.')

  const session = saveCodeSession(data as CodeLoginRpcResult, companyCode, employeeCode)
  if (!session) throw new Error('Login succeeded but no employee was returned from server.')
  return session
}

/** Mirrors RefreshCodeSessionAsync + ValidateCodeSessionAsync. */
export async function refreshCodeSession(
  supabase: SupabaseClient,
): Promise<CodeSession | null> {
  const existing = getCodeSession()
  if (!existing?.session_token) return null

  try {
    const { data, error } = await supabase.rpc('employee_refresh_code_session', {
      p_session_token: existing.session_token,
    })
    if (error || !data) {
      clearCodeSession()
      return null
    }

    const parsed = data as CodeLoginRpcResult
    const empId = parsed.employee?.id
    const companyId = parsed.employee?.company_id ?? parsed.company?.id
    const token = parsed.session_token
    if (!empId || !companyId || !token) {
      clearCodeSession()
      return null
    }

    const { data: valid, error: validErr } = await supabase.rpc('employee_validate_session', {
      p_company_id: companyId,
      p_employee_id: empId,
      p_session_token: token,
    })
    if (validErr || valid !== true) {
      clearCodeSession()
      return null
    }

    const refreshed = saveCodeSession(
      parsed,
      parsed.company?.code ?? existing.company_code,
      existing.employee_code,
    )
    if (!refreshed) {
      clearCodeSession()
      return null
    }
    return refreshed
  } catch {
    clearCodeSession()
    return null
  }
}

export async function revokeCodeSession(supabase: SupabaseClient): Promise<void> {
  const existing = getCodeSession()
  if (!existing?.session_token) return
  try {
    await supabase.rpc('employee_revoke_code_session', {
      p_session_token: existing.session_token,
    })
  } catch {
    // ignore — still clear local state
  }
}

export async function getMyMemberships(
  supabase: SupabaseClient,
): Promise<EmployeeMembership[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data, error } = await supabase.rpc('employee_get_my_memberships', {
      p_user_id: user.id,
    })
    if (!error && Array.isArray(data)) {
      return data.map((row) => asMembership(row as Record<string, unknown>))
    }
  }

  const cs = getCodeSession()
  if (cs?.company_code && cs.employee_code) {
    const { data, error } = await supabase.rpc('employee_get_my_memberships_by_code', {
      p_company_code: cs.company_code,
      p_employee_code: cs.employee_code,
    })
    if (!error && Array.isArray(data)) {
      return data.map((row) => asMembership(row as Record<string, unknown>))
    }
  }

  const refreshed = await refreshCodeSession(supabase)
  if (refreshed) {
    return [{
      employee_id: refreshed.employee_id,
      company_id: refreshed.company_id,
      registration_status: refreshed.employee.registration_status ?? 'active',
      is_active: refreshed.employee.is_active !== false,
      name: refreshed.employee.name,
      surname: refreshed.employee.surname,
      position: refreshed.employee.position ?? null,
      branch: null,
      access_level: refreshed.employee.access_level,
      company_name: refreshed.company.name,
      company_code: refreshed.company.code,
    }]
  }

  return []
}

export type JwtEmployeeRow = {
  id: string
  company_id: string
  name: string
  surname: string
  access_level: string
  login_password_ready: boolean
  registration_status: string
  is_active: boolean
}

/** First employee row for the JWT user (MAUI GetCurrentEmployeeAsync). */
export async function getCurrentJwtEmployee(
  supabase: SupabaseClient,
): Promise<JwtEmployeeRow | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('employees')
    .select('id, company_id, name, surname, access_level, login_password_ready, registration_status, is_active')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    company_id: data.company_id,
    name: data.name ?? '',
    surname: data.surname ?? '',
    access_level: data.access_level ?? 'employee',
    login_password_ready: Boolean(data.login_password_ready),
    registration_status: data.registration_status ?? 'active',
    is_active: data.is_active !== false,
  }
}

export async function getEmployeeForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<JwtEmployeeRow | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('employees')
    .select('id, company_id, name, surname, access_level, login_password_ready, registration_status, is_active')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    company_id: data.company_id,
    name: data.name ?? '',
    surname: data.surname ?? '',
    access_level: data.access_level ?? 'employee',
    login_password_ready: Boolean(data.login_password_ready),
    registration_status: data.registration_status ?? 'active',
    is_active: data.is_active !== false,
  }
}

/** Avoid unused import if tree-shaken oddly — keep update helper available. */
export { updateCodeSessionToken }
