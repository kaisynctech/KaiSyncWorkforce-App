/**
 * Shared Clients API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildClientCreatePayload,
  nextClientCode,
  type ClientCreateInput,
} from '@/lib/client-create-payload'
import { logClientEvent } from '@/lib/client-events'

export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type CreateClientOptions = ClientCreateInput & {
  existingCodes?: (string | null | undefined)[]
  companyCode?: string | null
  /** When true, allocate a permanent C#### code if none provided. */
  assignCode?: boolean
}

async function resolveClientCode(
  supabase: SupabaseClient,
  companyId: string,
  opts?: {
    existingCodes?: (string | null | undefined)[]
    companyCode?: string | null
    explicit?: string | null
  },
): Promise<string | null> {
  if (opts?.explicit?.trim()) return opts.explicit.trim().toUpperCase()

  let codes = opts?.existingCodes
  let companyCode = opts?.companyCode ?? ''

  if (!codes) {
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', companyId).maybeSingle(),
      supabase.from('clients').select('client_code').eq('company_id', companyId),
    ])
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
    codes = (existing ?? []).map(r => (r as { client_code: string | null }).client_code)
  } else if (opts?.companyCode == null) {
    const { data: company } = await supabase
      .from('companies')
      .select('code')
      .eq('id', companyId)
      .maybeSingle()
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
  }

  const code = nextClientCode(companyCode, codes)
  if (opts?.existingCodes) opts.existingCodes.push(code)
  return code
}

export async function createClientRecord(
  supabase: SupabaseClient,
  input: CreateClientOptions,
): Promise<ClientResult<{ id: string }>> {
  try {
    const clientCode =
      input.clientCode?.trim()
        ? input.clientCode.trim().toUpperCase()
        : input.assignCode
          ? await resolveClientCode(supabase, input.companyId, {
              existingCodes: input.existingCodes,
              companyCode: input.companyCode,
            })
          : null

    const payload = buildClientCreatePayload({
      ...input,
      clientCode,
    })

    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('id')
      .single()

    if (error) return { ok: false, message: error.message }
    const id = (data as { id: string }).id
    await logClientEvent(supabase, {
      companyId: input.companyId,
      screen: 'HrClientDetails',
      action: 'client_created',
      meta: { client_id: id, name: input.name.trim() },
    })
    return { ok: true, data: { id } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
