/**
 * Build a contractors INSERT payload for pure suppliers (partner_kind = supplier).
 * Dual partners (both) must use createContractor — RLS requires contractors.create.
 */

import {
  normalizeAccountType,
  normalizePaymentMethod,
  normalizePaymentTerms,
} from '@/lib/contractor-create-payload'
import { PARTNER_KIND, type PartnerKind } from '@/lib/partner-kinds'

export type SupplierCreateInput = {
  companyId: string
  name: string
  partnerKind?: PartnerKind | string | null
  contactPerson?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  taxNumber?: string | null
  registrationNumber?: string | null
  isVatRegistered?: boolean
  vatNumber?: string | null
  notes?: string | null
  bankName?: string | null
  bankAccount?: string | null
  accountHolderName?: string | null
  bankBranchCode?: string | null
  accountType?: string | null
  paymentTerms?: string | null
  preferredPaymentMethod?: string | null
  isActive?: boolean
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

/** Accept supplier | both only. */
export function normalizeSupplierPartnerKind(raw: string | null | undefined): PartnerKind {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === PARTNER_KIND.both || v === 'contractor & supplier' || v === 'both') {
    return PARTNER_KIND.both
  }
  return PARTNER_KIND.supplier
}

/** Payload for pure supplier insert (suppliers.edit RLS). */
export function buildSupplierCreatePayload(input: SupplierCreateInput): Record<string, unknown> {
  const name = input.name.trim()
  if (!name) throw new Error('Supplier name is required.')

  const partnerKind = normalizeSupplierPartnerKind(input.partnerKind)
  if (partnerKind !== PARTNER_KIND.supplier) {
    throw new Error('Use the dual-partner create path for Contractor & supplier.')
  }

  const isVat = Boolean(input.isVatRegistered)

  return {
    company_id: input.companyId,
    name,
    partner_kind: PARTNER_KIND.supplier,
    contractor_code: null,
    contact_person: emptyToNull(input.contactPerson),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    address: emptyToNull(input.address),
    tax_number: emptyToNull(input.taxNumber),
    registration_number: emptyToNull(input.registrationNumber),
    is_vat_registered: isVat,
    vat_number: isVat ? emptyToNull(input.vatNumber) : null,
    notes: emptyToNull(input.notes),
    bank_name: emptyToNull(input.bankName),
    bank_account: emptyToNull(input.bankAccount),
    account_holder_name: emptyToNull(input.accountHolderName),
    bank_branch_code: emptyToNull(input.bankBranchCode),
    account_type: normalizeAccountType(input.accountType),
    payment_terms: normalizePaymentTerms(input.paymentTerms),
    preferred_payment_method: normalizePaymentMethod(input.preferredPaymentMethod),
    is_active: input.isActive !== false,
    rating: 0,
    banking_verified: false,
    payment_hold: false,
    compliance_hold: false,
    portal_enabled: false,
  }
}
