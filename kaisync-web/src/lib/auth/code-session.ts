/**
 * Mirrors KaiFlow.Timesheets.Services.CodeSessionStore for the web.
 * Code-login does not create a Supabase JWT — session lives in localStorage.
 */

export const CODE_SESSION_KEY = 'kf_cs'
/** Selected membership for JWT (email) employees — set by company picker. */
export const EMP_CONTEXT_KEY = 'kf_emp_ctx'

export type CodeSessionEmployee = {
  id: string
  name: string
  surname: string
  access_level: string
  employee_code?: string | null
  position?: string | null
  branch?: string | null
  company_id: string
  login_password_ready?: boolean
  registration_status?: string
  is_active?: boolean
}

export type CodeSessionCompany = {
  id: string
  name: string
  code: string
}

export type CodeSession = {
  session_token: string
  employee_id: string
  company_id: string
  company_code: string
  employee_code: string
  employee: CodeSessionEmployee
  company: CodeSessionCompany
}

export type EmpContext = {
  employee_id: string
  company_id: string
  access_level: string
  name?: string
  surname?: string
  company_name?: string
  company_code?: string
  registration_status?: string
}

export type CodeLoginRpcResult = {
  session_token?: string
  needs_pin_setup?: boolean
  employee?: {
    id?: string
    company_id?: string
    name?: string
    surname?: string
    access_level?: string
    employee_code?: string
    position?: string
    branch?: string
    login_password_ready?: boolean
    registration_status?: string
    is_active?: boolean
    user_id?: string
  }
  company?: {
    id?: string
    name?: string
    code?: string
  }
  memberships?: unknown[]
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined'
}

export function saveCodeSession(
  result: CodeLoginRpcResult,
  companyCode: string,
  employeeCode: string,
): CodeSession | null {
  if (!canUseStorage()) return null
  const emp = result.employee
  const co = result.company
  const token = result.session_token
  if (!emp?.id || !co?.id || !token) return null

  const session: CodeSession = {
    session_token: token,
    employee_id: emp.id,
    company_id: emp.company_id ?? co.id,
    company_code: (co.code ?? companyCode).trim().toUpperCase(),
    employee_code: employeeCode.trim(),
    employee: {
      id: emp.id,
      name: emp.name ?? '',
      surname: emp.surname ?? '',
      access_level: emp.access_level ?? 'employee',
      employee_code: emp.employee_code,
      position: emp.position,
      branch: emp.branch ?? null,
      company_id: emp.company_id ?? co.id,
      login_password_ready: emp.login_password_ready,
      registration_status: emp.registration_status ?? 'active',
      is_active: emp.is_active !== false,
    },
    company: {
      id: co.id,
      name: co.name ?? '',
      code: (co.code ?? companyCode).trim().toUpperCase(),
    },
  }

  localStorage.setItem(CODE_SESSION_KEY, JSON.stringify(session))
  clearEmpContext()
  return session
}

export function getCodeSession(): CodeSession | null {
  if (!canUseStorage()) return null
  try {
    const raw = localStorage.getItem(CODE_SESSION_KEY)
    if (!raw) return null
    const cs = JSON.parse(raw) as CodeSession
    if (!cs.session_token || !cs.employee_id || !cs.company_id) return null
    return cs
  } catch {
    return null
  }
}

export function hasCodeSession(): boolean {
  return getCodeSession() != null
}

export function clearCodeSession(): void {
  if (!canUseStorage()) return
  localStorage.removeItem(CODE_SESSION_KEY)
}

export function updateCodeSessionToken(sessionToken: string, patch?: Partial<CodeSession>): void {
  const current = getCodeSession()
  if (!current) return
  const next: CodeSession = {
    ...current,
    ...patch,
    session_token: sessionToken,
    employee: patch?.employee ? { ...current.employee, ...patch.employee } : current.employee,
    company: patch?.company ? { ...current.company, ...patch.company } : current.company,
  }
  localStorage.setItem(CODE_SESSION_KEY, JSON.stringify(next))
}

export function saveEmpContext(ctx: EmpContext): void {
  if (!canUseStorage()) return
  localStorage.setItem(EMP_CONTEXT_KEY, JSON.stringify(ctx))
}

export function getEmpContext(): EmpContext | null {
  if (!canUseStorage()) return null
  try {
    const raw = localStorage.getItem(EMP_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw) as EmpContext
    if (!ctx.employee_id || !ctx.company_id) return null
    return ctx
  } catch {
    return null
  }
}

export function clearEmpContext(): void {
  if (!canUseStorage()) return
  localStorage.removeItem(EMP_CONTEXT_KEY)
}

export function clearAllAuthLocalState(): void {
  clearCodeSession()
  clearEmpContext()
}
