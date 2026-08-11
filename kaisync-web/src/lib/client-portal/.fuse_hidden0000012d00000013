/**
 * Client portal session — mirrors MAUI ClientPortalSessionStore.
 * Code-auth only (no Supabase JWT). Codes passed to every RPC.
 */

export const CLIENT_PORTAL_SESSION_KEY = 'kf_cps'
const SKIP_AUTO_RESTORE_KEY = 'kf_cps_skip_restore'
const MSG_READ_PREFIX = 'kf_cps_msg_read_'

export type ClientPortalSession = {
  client_id: string
  company_id: string
  client_name: string
  company_code: string
  client_code: string
  email?: string | null
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined'
}

export function saveClientPortalSession(session: ClientPortalSession): void {
  if (!canUseStorage()) return
  localStorage.setItem(CLIENT_PORTAL_SESSION_KEY, JSON.stringify({
    ...session,
    company_code: session.company_code.trim().toUpperCase(),
    client_code: session.client_code.trim().toUpperCase(),
  }))
  localStorage.removeItem(SKIP_AUTO_RESTORE_KEY)
}

export function getClientPortalSession(): ClientPortalSession | null {
  if (!canUseStorage()) return null
  try {
    const raw = localStorage.getItem(CLIENT_PORTAL_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ClientPortalSession
    if (!s.client_id || !s.company_id || !s.company_code || !s.client_code) return null
    return s
  } catch {
    return null
  }
}

export function hasClientPortalSession(): boolean {
  return getClientPortalSession() != null
}

export function clearClientPortalSession(): void {
  if (!canUseStorage()) return
  localStorage.removeItem(CLIENT_PORTAL_SESSION_KEY)
}

/** Sign-out: clear session and suppress one auto-restore (MAUI ClearForSignOut). */
export function signOutClientPortal(): void {
  if (!canUseStorage()) return
  clearClientPortalSession()
  localStorage.setItem(SKIP_AUTO_RESTORE_KEY, '1')
}

/** Returns true once if sign-out requested skip; then clears the flag. */
export function consumeSkipAutoRestore(): boolean {
  if (!canUseStorage()) return false
  if (localStorage.getItem(SKIP_AUTO_RESTORE_KEY) !== '1') return false
  localStorage.removeItem(SKIP_AUTO_RESTORE_KEY)
  return true
}

export function getDealMessagesReadAt(dealId: string): string | null {
  if (!canUseStorage()) return null
  return localStorage.getItem(MSG_READ_PREFIX + dealId)
}

export function markDealMessagesRead(dealId: string, atIso?: string): void {
  if (!canUseStorage()) return
  localStorage.setItem(MSG_READ_PREFIX + dealId, atIso ?? new Date().toISOString())
}
