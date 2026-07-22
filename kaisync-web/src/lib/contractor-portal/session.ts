/**
 * Contractor portal session — mirrors MAUI ContractorPortalSessionStore.
 * Holds both codes (ops RPCs) and UUIDs (profile/banking/compliance/quotes).
 */

export const CONTRACTOR_PORTAL_SESSION_KEY = 'kf_ctps'
const SKIP_AUTO_RESTORE_KEY = 'kf_ctps_skip_restore'

export type ContractorPortalSession = {
  contractor_id: string
  company_id: string
  contractor_name: string
  company_code: string
  contractor_code: string
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined'
}

export function saveContractorPortalSession(session: ContractorPortalSession): void {
  if (!canUseStorage()) return
  localStorage.setItem(CONTRACTOR_PORTAL_SESSION_KEY, JSON.stringify({
    ...session,
    company_code: session.company_code.trim().toUpperCase(),
    contractor_code: session.contractor_code.trim().toUpperCase(),
  }))
  localStorage.removeItem(SKIP_AUTO_RESTORE_KEY)
}

export function getContractorPortalSession(): ContractorPortalSession | null {
  if (!canUseStorage()) return null
  try {
    const raw = localStorage.getItem(CONTRACTOR_PORTAL_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ContractorPortalSession
    if (!s.contractor_id || !s.company_id || !s.company_code || !s.contractor_code) return null
    return s
  } catch {
    return null
  }
}

export function clearContractorPortalSession(): void {
  if (!canUseStorage()) return
  localStorage.removeItem(CONTRACTOR_PORTAL_SESSION_KEY)
}

export function signOutContractorPortal(): void {
  if (!canUseStorage()) return
  clearContractorPortalSession()
  localStorage.setItem(SKIP_AUTO_RESTORE_KEY, '1')
}

export function consumeContractorSkipAutoRestore(): boolean {
  if (!canUseStorage()) return false
  if (localStorage.getItem(SKIP_AUTO_RESTORE_KEY) !== '1') return false
  localStorage.removeItem(SKIP_AUTO_RESTORE_KEY)
  return true
}
