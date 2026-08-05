/**
 * Shared Suppliers API — storage is contractors with partner_kind supplier|both.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createContractor } from '@/lib/contractors'
import {
  buildSupplierCreatePayload,
  normalizeSupplierPartnerKind,
  type SupplierCreateInput,
} from '@/lib/supplier-create-payload'
import { logSupplierEvent } from '@/lib/supplier-events'
import {
  isContractorKind,
  nextContractorCode,
  PARTNER_KIND,
} from '@/lib/partner-kinds'

export type SupplierResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type CreateSupplierOptions = SupplierCreateInput & {
  existingCodes?: (string | null | undefined)[]
  companyCode?: string | null
}

async function allocateContractorCode(
  supabase: SupabaseClient,
  companyId: string,
  opts?: { existingCodes?: (string | null | undefined)[]; companyCode?: string | null },
): Promise<string> {
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

/**
 * Create a procurement partner.
 * - supplier: suppliers.edit RLS
 * - both: requires contractors.create (delegates to createContractor + CT code)
 */
export async function createSupplier(
  supabase: SupabaseClient,
  input: CreateSupplierOptions,
): Promise<SupplierResult<{ id: string }>> {
  try {
    const partnerKind = normalizeSupplierPartnerKind(input.partnerKind)

    if (partnerKind === PARTNER_KIND.both) {
      const created = await createContractor(supabase, {
        ...input,
        partnerKind: PARTNER_KIND.both,
      })
      if (!created.ok) {
        return {
          ok: false,
          message:
            created.message.includes('row-level security')
              ? 'Creating a dual contractor & supplier requires contractors.create permission.'
              : created.message,
        }
      }
      await logSupplierEvent(supabase, {
        companyId: input.companyId,
        screen: 'HrSupplierDetails',
        action: 'supplier_created',
        meta: { contractor_id: created.data.id, partner_kind: PARTNER_KIND.both, name: input.name.trim() },
      })
      return created
    }

    const payload = buildSupplierCreatePayload({ ...input, partnerKind: PARTNER_KIND.supplier })
    const { data, error } = await supabase
      .from('contractors')
      .insert(payload)
      .select('id')
      .single()

    if (error) return { ok: false, message: error.message }
    const id = (data as { id: string }).id
    await logSupplierEvent(supabase, {
      companyId: input.companyId,
      screen: 'HrSupplierDetails',
      action: 'supplier_created',
      meta: { contractor_id: id, partner_kind: PARTNER_KIND.supplier, name: input.name.trim() },
    })
    return { ok: true, data: { id } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function updateSupplier(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    supplierId: string
    payload: Record<string, unknown>
    previousPartnerKind?: string | null
    previousContractorCode?: string | null
  },
): Promise<SupplierResult<void>> {
  const nextKind = typeof opts.payload.partner_kind === 'string'
    ? opts.payload.partner_kind
    : opts.previousPartnerKind

  const becomingContractorCapable =
    isContractorKind(nextKind) &&
    !isContractorKind(opts.previousPartnerKind ?? null)

  const updatePayload = { ...opts.payload }
  if (becomingContractorCapable && !opts.previousContractorCode) {
    updatePayload.contractor_code = await allocateContractorCode(supabase, opts.companyId)
  }

  const { error } = await supabase
    .from('contractors')
    .update(updatePayload)
    .eq('id', opts.supplierId)
    .eq('company_id', opts.companyId)

  if (error) return { ok: false, message: error.message }

  await logSupplierEvent(supabase, {
    companyId: opts.companyId,
    screen: 'HrSupplierDetails',
    action: becomingContractorCapable ? 'supplier_became_dual' : 'supplier_updated',
    meta: {
      contractor_id: opts.supplierId,
      partner_kind: nextKind,
      contractor_code: updatePayload.contractor_code ?? opts.previousContractorCode ?? null,
    },
  })

  return { ok: true, data: undefined }
}
