/**
 * Fire-and-forget compliance pack activity logging into app_events.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogCompliancePackEventInput = {
  companyId: string
  authUserId?: string | null
  screen: string
  action: string
  meta: Record<string, unknown>
}

export async function logCompliancePackEvent(
  supabase: SupabaseClient,
  input: LogCompliancePackEventInput,
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
    if (meta.pack_id != null) meta.pack_id = String(meta.pack_id)

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
