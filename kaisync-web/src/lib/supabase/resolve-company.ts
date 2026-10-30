import type { SupabaseClient } from '@supabase/supabase-js'
import { getCodeSession, getEmpContext } from '@/lib/auth/code-session'

export type CurrentMember = {
  employeeId: string
  companyId: string
  sessionToken: string | null
}

type CachedMember = {
  at: number
  key: string
  member: CurrentMember
}

// The member (employee + company) only changes on sign-in/out, account switch or company
// switch, and each of those changes the cache key (or clears the cache). RLS stays the
// data boundary and proxy.ts still verifies the session on every page request.
const MEMBER_CACHE_MS = 10 * 60_000
let memberCache: CachedMember | null = null
/** Callers that start at the same moment (layout, gate, page) share one lookup. */
const inFlight = new Map<string, Promise<CurrentMember | null>>()

function memberCacheKey(userId: string | null, empId: string | null, companyId: string | null): string {
  return `${userId ?? 'anon'}|${empId ?? ''}|${companyId ?? ''}`
}

/** Drop cached member (call after company switch / sign-out). */
export function clearCurrentMemberCache() {
  memberCache = null
  inFlight.clear()
  void import('@/lib/permissions').then(m => m.clearPermissionsCache())
}

/**
 * Hands the member the dashboard layout has just loaded to every later caller, so the
 * bootstrap, gates and pages do not repeat the sign-in check and employee lookup.
 * The key is built exactly as resolveCurrentMember builds it (session user + company picker).
 */
export function primeCurrentMember(userId: string | null, member: CurrentMember) {
  const ctx = typeof window !== 'undefined' ? getEmpContext() : null
  const key = memberCacheKey(userId, ctx?.employee_id ?? null, ctx?.company_id ?? null)
  memberCache = { at: Date.now(), key, member }
}

/** User id of the session held in this browser (no network call). */
async function localSessionUserId(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Resolves the active employee + company for RPC calls.
 * Prefer company selected via company picker (kf_emp_ctx) for JWT users.
 * Fall back to code session (kf_cs) when no Supabase user.
 * Short in-memory cache avoids layout + page + sidebar all re-hitting auth.
 */
export async function resolveCurrentMember(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  // Fast path: answer from the cache using the locally held session, before any
  // network call (previously getUser() ran first, so every caller paid a round trip).
  const ctx = typeof window !== 'undefined' ? getEmpContext() : null
  const localKey = memberCacheKey(
    await localSessionUserId(supabase),
    ctx?.employee_id ?? null,
    ctx?.company_id ?? null,
  )
  if (
    memberCache &&
    memberCache.key === localKey &&
    Date.now() - memberCache.at < MEMBER_CACHE_MS
  ) {
    return memberCache.member
  }
  const running = inFlight.get(localKey)
  if (running) return running
  const lookup = resolveCurrentMemberVerified(supabase).finally(() => {
    if (inFlight.get(localKey) === lookup) inFlight.delete(localKey)
  })
  inFlight.set(localKey, lookup)
  return lookup
}

/** Server-verified lookup (getUser + employees), as before; fills the cache. */
async function resolveCurrentMemberVerified(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  // Prefer company selected via company picker (kf_emp_ctx) for JWT users.
  // Fall back to code session (kf_cs) when no Supabase user.
  // When ctx is set but the row lookup fails, still prefer ctx.company_id over
  // an arbitrary limit(1) employee (multi-company owners otherwise get the wrong tenant).
  let user: { id: string } | null = null
  try {
    const res = await supabase.auth.getUser()
    user = res.data.user
  } catch {
    user = null
  }
  const ctx = typeof window !== 'undefined' ? getEmpContext() : null
  const cacheKey = memberCacheKey(
    user?.id ?? null,
    ctx?.employee_id ?? null,
    ctx?.company_id ?? null,
  )
  if (
    memberCache &&
    memberCache.key === cacheKey &&
    Date.now() - memberCache.at < MEMBER_CACHE_MS
  ) {
    return memberCache.member
  }

  if (user) {
    if (ctx?.employee_id && ctx.company_id) {
      const { data } = await supabase
        .from('employees')
        .select('id, company_id')
        .eq('id', ctx.employee_id)
        .eq('company_id', ctx.company_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()
      if (data?.company_id) {
        const member = { employeeId: data.id, companyId: data.company_id, sessionToken: null }
        memberCache = { at: Date.now(), key: cacheKey, member }
        return member
      }

      // Soft fallback: any active employee row for this user in the selected company
      const { data: sameCompany } = await supabase
        .from('employees')
        .select('id, company_id')
        .eq('user_id', user.id)
        .eq('company_id', ctx.company_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (sameCompany?.company_id) {
        const member = { employeeId: sameCompany.id, companyId: sameCompany.company_id, sessionToken: null }
        memberCache = { at: Date.now(), key: cacheKey, member }
        return member
      }
    }

    const { data } = await supabase
      .from('employees')
      .select('id, company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (data?.company_id) {
      const member = { employeeId: data.id, companyId: data.company_id, sessionToken: null }
      memberCache = { at: Date.now(), key: cacheKey, member }
      return member
    }
  }

  if (typeof window !== 'undefined') {
    const cs = getCodeSession()
    if (cs?.employee_id && cs.company_id) {
      const member = {
        employeeId: cs.employee_id,
        companyId: cs.company_id,
        sessionToken: cs.session_token ?? null,
      }
      memberCache = { at: Date.now(), key: cacheKey, member }
      return member
    }
  }

  return null
}
