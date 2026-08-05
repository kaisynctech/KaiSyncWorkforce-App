/**
 * Shared Compliance Packs API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logCompliancePackEvent } from '@/lib/compliance-pack-events'

export type PackResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type PackItemInput = {
  document_type: string
  requirement: 'required' | 'recommended'
}

export async function upsertCompliancePack(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    packId?: string | null
    name: string
    description?: string | null
    items: PackItemInput[]
  },
): Promise<PackResult<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('hr_upsert_compliance_pack', {
      p_company_id: opts.companyId,
      p_pack_id: opts.packId ?? null,
      p_name: opts.name.trim(),
      p_description: opts.description?.trim() || null,
      p_items: opts.items,
    })
    if (error) return { ok: false, message: error.message }
    const id = typeof data === 'string' ? data : String(data)

    await logCompliancePackEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrCompliancePacks',
      action: opts.packId ? 'compliance_pack_updated' : 'compliance_pack_created',
      meta: { pack_id: id, name: opts.name.trim(), item_count: opts.items.length },
    })

    return { ok: true, data: id }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function setDefaultCompliancePack(
  supabase: SupabaseClient,
  opts: { companyId: string; packId: string },
): Promise<PackResult<void>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('hr_set_default_compliance_pack', {
      p_company_id: opts.companyId,
      p_pack_id: opts.packId,
    })
    if (error) return { ok: false, message: error.message }

    await logCompliancePackEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrCompliancePacks',
      action: 'compliance_pack_default_set',
      meta: { pack_id: opts.packId },
    })

    return { ok: true, data: undefined }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function archiveCompliancePack(
  supabase: SupabaseClient,
  opts: { companyId: string; packId: string; archived?: boolean },
): Promise<PackResult<void>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('hr_archive_compliance_pack', {
      p_company_id: opts.companyId,
      p_pack_id: opts.packId,
      p_archived: opts.archived ?? true,
    })
    if (error) return { ok: false, message: error.message }

    await logCompliancePackEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrCompliancePacks',
      action: opts.archived === false ? 'compliance_pack_restored' : 'compliance_pack_archived',
      meta: { pack_id: opts.packId },
    })

    return { ok: true, data: undefined }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
