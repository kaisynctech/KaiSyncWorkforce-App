/**
 * Shared Assets API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildAssetCreatePayload,
  type AssetCreateInput,
} from '@/lib/asset-create-payload'
import { logAssetEvent } from '@/lib/asset-events'
import { appendAssetServiceNote } from '@/lib/supply-assets'

export type AssetResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export async function createAsset(
  supabase: SupabaseClient,
  input: AssetCreateInput,
): Promise<AssetResult<{ id: string }>> {
  try {
    const payload = buildAssetCreatePayload(input)
    const { data, error } = await supabase
      .from('assets')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { ok: false, message: error.message }
    const id = (data as { id: string }).id
    await logAssetEvent(supabase, {
      companyId: input.companyId,
      screen: 'HrAssets',
      action: 'asset_created',
      meta: { asset_id: id, label: input.label.trim(), asset_type: payload.asset_type },
    })
    return { ok: true, data: { id } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function updateAsset(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    assetId: string
    input: Omit<AssetCreateInput, 'companyId'> & { companyId?: string }
    serviceNote?: string | null
    actorName?: string | null
    previousNotes?: string | null
  },
): Promise<AssetResult<void>> {
  try {
    let notes = opts.input.notes?.trim() || opts.previousNotes || null
    if (opts.serviceNote?.trim()) {
      notes = appendAssetServiceNote(notes, opts.serviceNote, opts.actorName)
    }

    const payload = buildAssetCreatePayload({
      companyId: opts.companyId,
      ...opts.input,
      notes,
    })
    // Do not rewrite company_id on update
    delete payload.company_id

    const { error } = await supabase
      .from('assets')
      .update(payload)
      .eq('id', opts.assetId)
      .eq('company_id', opts.companyId)

    if (error) return { ok: false, message: error.message }

    await logAssetEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrAssets',
      action: opts.serviceNote?.trim() ? 'asset_service_note' : 'asset_updated',
      meta: { asset_id: opts.assetId, status: payload.status },
    })
    return { ok: true, data: undefined }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function retireAsset(
  supabase: SupabaseClient,
  opts: { companyId: string; assetId: string },
): Promise<AssetResult<void>> {
  const { error } = await supabase
    .from('assets')
    .update({ status: 'retired' })
    .eq('id', opts.assetId)
    .eq('company_id', opts.companyId)

  if (error) return { ok: false, message: error.message }

  await logAssetEvent(supabase, {
    companyId: opts.companyId,
    screen: 'HrAssets',
    action: 'asset_retired',
    meta: { asset_id: opts.assetId },
  })
  return { ok: true, data: undefined }
}
