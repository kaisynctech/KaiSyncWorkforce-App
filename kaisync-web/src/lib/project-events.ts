/**
 * Fire-and-forget project activity logging into app_events.
 * Failures must never block HR saves.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogProjectEventInput = {
  companyId: string
  authUserId?: string | null
  screen: string
  action: string
  meta: Record<string, unknown>
}

export async function logProjectEvent(
  supabase: SupabaseClient,
  input: LogProjectEventInput,
): Promise<void> {
  try {
    let authUserId = input.authUserId
    if (authUserId === undefined) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      authUserId = user?.id ?? null
    }

    const meta: Record<string, unknown> = { ...input.meta }
    if (meta.project_id != null) meta.project_id = String(meta.project_id)

    await supabase.from('app_events').insert({
      company_id: input.companyId,
      auth_user_id: authUserId,
      screen: input.screen,
      action: input.action,
      level: 'info',
      meta,
    })
  } catch {
    // Non-fatal
  }
}
