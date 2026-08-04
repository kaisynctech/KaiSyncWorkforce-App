/**
 * Shared Contractors API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildContractorCreatePayload,
  type ContractorCreateInput,
} from '@/lib/contractor-create-payload'
import {
  isContractorKind,
  nextContractorCode,
  type PartnerKind,
} from '@/lib/partner-kinds'

export type ContractorResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type CreateContractorOptions = ContractorCreateInput & {
  /** When set, skip DB lookup and allocate from this list (mutated with new code). */
  existingCodes?: (string | null | undefined)[]
  companyCode?: string | null
}

async function resolveContractorCode(
  supabase: SupabaseClient,
  companyId: string,
  partnerKind: PartnerKind | string | null | undefined,
  opts?: { existingCodes?: (string | null | undefined)[]; companyCode?: string | null },
): Promise<string | null> {
  if (!isContractorKind(partnerKind ?? 'contractor')) return null

  let codes = opts?.existingCodes
  let companyCode = opts?.companyCode ?? ''

  if (!codes) {
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', companyId).maybeSingle(),
      supabase.from('contractors').select('contractor_code').eq('company_id', companyId),
    ])
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
    codes = (existing ?? []).map(r => (r as { contractor_code: string | null }).contractor_code)
  } else if (opts?.companyCode == null) {
    const { data: company } = await supabase
      .from('companies')
      .select('code')
      .eq('id', companyId)
      .maybeSingle()
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
  }

  const code = nextContractorCode(companyCode, codes)
  if (opts?.existingCodes) opts.existingCodes.push(code)
  return code
}

export async function createContractor(
  supabase: SupabaseClient,
  input: CreateContractorOptions,
): Promise<ContractorResult<{ id: string }>> {
  try {
    const partnerKind = input.partnerKind ?? 'contractor'
    const contractorCode =
      input.contractorCode ??
      (await resolveContractorCode(supabase, input.companyId, partnerKind, {
        existingCodes: input.existingCodes,
        companyCode: input.companyCode,
      }))

    const payload = buildContractorCreatePayload({
      ...input,
      contractorCode,
    })

    const { data, error } = await supabase
      .from('contractors')
      .insert(payload)
      .select('id')
      .single()

    if (error) return { ok: false, message: error.message }
    return { ok: true, data: { id: (data as { id: string }).id } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
