import type { Session, SupabaseClient } from '@supabase/supabase-js'

/**
 * Establish a Supabase session from invite / magic-link redirect params.
 *
 * Handles:
 * - PKCE `?code=` (exchangeCodeForSession)
 * - Implicit `#access_token=` / `#refresh_token=` (setSession)
 * - Brief wait for createBrowserClient's built-in URL detection
 */
export async function establishSessionFromUrl(
  supabase: SupabaseClient,
  options?: { timeoutMs?: number },
): Promise<Session | null> {
  const timeoutMs = options?.timeoutMs ?? 8000

  // 1) Already have a session
  const existing = (await supabase.auth.getSession()).data.session
  if (existing) return existing

  // 2) PKCE code in query string
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error && data.session) {
        // Clean sensitive params from the address bar
        url.searchParams.delete('code')
        url.searchParams.delete('type')
        window.history.replaceState({}, '', url.pathname + url.search + url.hash)
        return data.session
      }
    }

    // 3) Implicit tokens in hash (legacy / some email templates)
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash)
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      if (access_token && refresh_token) {
        const { data, error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        })
        if (!error && data.session) {
          window.history.replaceState({}, '', url.pathname + url.search)
          return data.session
        }
      }
      // Some templates only put access_token; getUser still needs a refresh token.
      // Fall through to auth-state wait in case the client parsed it.
    }
  }

  // 4) Wait for client-side URL detection / auth events
  return await new Promise<Session | null>(resolve => {
    let settled = false
    const finish = (session: Session | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sub.subscription.unsubscribe()
      resolve(session)
    }

    const timer = setTimeout(async () => {
      const late = (await supabase.auth.getSession()).data.session
      finish(late)
    }, timeoutMs)

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
        finish(session)
      }
    })

    // One more immediate poll in case events already fired
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(data.session)
    })
  })
}
