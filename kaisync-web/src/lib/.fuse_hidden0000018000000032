/**
 * Platform operator gate — mirrors MAUI IsPlatformAdminAsync / platform_is_admin().
 */

import type { SupabaseClient } from '@supabase/supabase-js'

let cache: { value: boolean; loadedAt: number } | null = null

export async function isPlatformAdmin(supabase: SupabaseClient): Promise<boolean> {
  if (cache && Date.now() - cache.loadedAt < 60_000) return cache.value
  try {
    const { data, error } = await supabase.rpc('platform_is_admin')
    if (error) {
      cache = { value: false, loadedAt: Date.now() }
      return false
    }
    const ok = data === true
    cache = { value: ok, loadedAt: Date.now() }
    return ok
  } catch {
    cache = { value: false, loadedAt: Date.now() }
    return false
  }
}

export function clearPlatformAdminCache() {
  cache = null
}
