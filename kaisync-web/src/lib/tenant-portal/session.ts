/**
 * Tenant (resident) portal session — code-auth only (no JWT).
 */

export const TENANT_PORTAL_SESSION_KEY = 'kf_tps'
const SKIP_AUTO_RESTORE_KEY = 'kf_tps_skip_restore'

export type TenantPortalSession = {
  resident_id: string
  company_id: string
  resident_name: string
  company_code: string
  resident_code: string
  email?: string | null
  phone?: string | null
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined'
}

export function saveTenantPortalSession(session: TenantPortalSession): void {
  if (!canUseStorage()) return
  localStorage.setItem(TENANT_PORTAL_SESSION_KEY, JSON.stringify({
    ...session,
    company_code: session.company_code.trim().toUpperCase(),
    resident_code: session.resident_code.trim().toUpperCase(),
  }))
  localStorage.removeItem(SKIP_AUTO_RESTORE_KEY)
}

export function getTenantPortalSession(): TenantPortalSession | null {
  if (!canUseStorage()) return null
  try {
    const raw = localStorage.getItem(TENANT_PORTAL_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as TenantPortalSession
    if (!s.resident_id || !s.company_id || !s.company_code || !s.resident_code) return null
    return s
  } catch {
    return null
  }
}

export function clearTenantPortalSession(): void {
  if (!canUseStorage()) return
  localStorage.removeItem(TENANT_PORTAL_SESSION_KEY)
}

export function signOutTenantPortal(): void {
  if (!canUseStorage()) return
  clearTenantPortalSession()
  localStorage.setItem(SKIP_AUTO_RESTORE_KEY, '1')
}

export function consumeSkipAutoRestore(): boolean {
  if (!canUseStorage()) return false
  if (localStorage.getItem(SKIP_AUTO_RESTORE_KEY) !== '1') return false
  localStorage.removeItem(SKIP_AUTO_RESTORE_KEY)
  return true
}
