/**
 * Fire-and-forget supplier activity logging into app_events.
 * Uses contractor_id meta so ContractorActivityTab can surface the feed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogSupplierEventInput = {
  companyId: string
  authUserId?: string | null
  screen: string
  action: string
  meta: Record<string, unknown>
}

export async function logSupplierEvent(
  supabase: SupabaseClient,
  input: LogSupplierEventInput,
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
    if (meta.contractor_id != null) meta.contractor_id = String(meta.contractor_id)
    if (meta.supplier_id != null) {
      meta.contractor_id = String(meta.supplier_id)
      delete meta.supplier_id
    }

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
