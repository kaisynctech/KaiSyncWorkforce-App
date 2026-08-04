/**
 * Build a contractors INSERT payload aligned with the live schema and
 * contractors.create RLS (partner_kind must be contractor | both).
 */

import {
  isContractorKind,
  PARTNER_KIND,
  type PartnerKind,
} from '@/lib/partner-kinds'

export type ContractorCreateInput = {
  companyId: string
  name: string
  partnerKind?: PartnerKind | string | null
  contractorCode?: string | null
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

const ACCOUNT_TYPES = new Set(['cheque', 'savings', 'transmission'])
const PAYMENT_TERMS = new Set(['7_days', '14_days', '30_days', '60_days', 'on_completion'])
const PAYMENT_METHODS = new Set(['eft', 'cheque', 'cash', 'credit_card'])

export function parseYesNo(raw: string | null | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === 'y' || v === 'yes' || v === 'true' || v === '1' || v === 'vat'
}

/** Accept contractor | both only — never pure supplier on this path. */
export function normalizeImportPartnerKind(raw: string | null | undefined): PartnerKind {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === PARTNER_KIND.both || v === 'contractor & supplier' || v === 'both') {
    return PARTNER_KIND.both
  }
  return PARTNER_KIND.contractor
}

export function normalizeAccountType(raw: string | null | undefined): string {
  if (!raw) return 'cheque'
  const v = raw.trim().toLowerCase().replace(/[\s/-]+/g, '_')
  if (ACCOUNT_TYPES.has(v)) return v
  if (v.includes('saving')) return 'savings'
  if (v.includes('trans')) return 'transmission'
  if (v.includes('current') || v.includes('cheque') || v.includes('checking')) return 'cheque'
  return 'cheque'
}

export function normalizePaymentTerms(raw: string | null | undefined): string {
  if (!raw) return '30_days'
  const v = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (PAYMENT_TERMS.has(v)) return v
  if (v.includes('7')) return '7_days'
  if (v.includes('14')) return '14_days'
  if (v.includes('60')) return '60_days'
  if (v.includes('completion')) return 'on_completion'
  if (v.includes('30')) return '30_days'
  return '30_days'
}

export function normalizePaymentMethod(raw: string | null | undefined): string {
  if (!raw) return 'eft'
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (PAYMENT_METHODS.has(v)) return v
  if (v.includes('eft') || v.includes('transfer')) return 'eft'
  if (v.includes('cash')) return 'cash'
  if (v.includes('card') || v.includes('credit')) return 'credit_card'
  if (v.includes('cheque') || v.includes('check')) return 'cheque'
  return 'eft'
}

/** Payload keys are live DB column names only. */
export function buildContractorCreatePayload(input: ContractorCreateInput): Record<string, unknown> {
  const name = input.name.trim()
  if (!name) throw new Error('Company / partner name is required.')

  const partnerKind = normalizeImportPartnerKind(input.partnerKind)
  if (!isContractorKind(partnerKind)) {
    throw new Error('Import only supports partner kind contractor or both.')
  }

  const isVat = Boolean(input.isVatRegistered)

  return {
    company_id: input.companyId,
    name,
    partner_kind: partnerKind,
    contractor_code: emptyToNull(input.contractorCode),
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
