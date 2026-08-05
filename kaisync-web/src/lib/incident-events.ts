/**
 * Fire-and-forget incident activity logging into app_events.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogIncidentEventInput = {
  companyId: string
  authUserId?: string | null
  screen: string
  action: string
  meta: Record<string, unknown>
}

export async function logIncidentEvent(
  supabase: SupabaseClient,
  input: LogIncidentEventInput,
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
    if (meta.incident_id != null) meta.incident_id = String(meta.incident_id)

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
