/**
 * Platform operator gate — implements / platform_is_admin().
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Keyed by the signed-in user, so a different user in the same tab never reuses the answer.
let cache: { value: boolean; loadedAt: number; userId: string | null } | null = null

export async function isPlatformAdmin(supabase: SupabaseClient): Promise<boolean> {
  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getSession()
    userId = data.session?.user?.id ?? null
  } catch {
    userId = null
  }
  if (cache && cache.userId === userId && Date.now() - cache.loadedAt < 60_000) return cache.value
  try {
    const { data, error } = await supabase.rpc('platform_is_admin')
    if (error) {
      cache = { value: false, loadedAt: Date.now(), userId }
      return false
    }
    const ok = data === true
    cache = { value: ok, loadedAt: Date.now(), userId }
    return ok
  } catch {
    cache = { value: false, loadedAt: Date.now(), userId }
    return false
  }
}

export function clearPlatformAdminCache() {
  cache = null
}
