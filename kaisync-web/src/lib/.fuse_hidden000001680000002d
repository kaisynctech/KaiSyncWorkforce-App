/** Mirrors MAUI PartnerKinds + EntityCodeHelper for contractors. */

export const PARTNER_KIND = {
  contractor: 'contractor',
  supplier: 'supplier',
  both: 'both',
} as const

export type PartnerKind = (typeof PARTNER_KIND)[keyof typeof PARTNER_KIND]

export function isContractorKind(kind: string | null | undefined): boolean {
  const k = (kind ?? PARTNER_KIND.contractor).toLowerCase()
  return k === PARTNER_KIND.contractor || k === PARTNER_KIND.both
}

export function isSupplierKind(kind: string | null | undefined): boolean {
  const k = (kind ?? '').toLowerCase()
  return k === PARTNER_KIND.supplier || k === PARTNER_KIND.both
}

export function partnerKindFromQuery(type: string | null | undefined): PartnerKind {
  const t = (type ?? '').toLowerCase()
  if (t === 'supplier') return PARTNER_KIND.supplier
  if (t === 'both') return PARTNER_KIND.both
  return PARTNER_KIND.contractor
}

export function partnerKindLabel(kind: string | null | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case PARTNER_KIND.supplier: return 'Supplier'
    case PARTNER_KIND.both: return 'Contractor & supplier'
    default: return 'Contractor'
  }
}

function contractorPrefix(companyCode: string): string {
  const normalized = companyCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized ? `CT${normalized}` : 'CT'
}

/** Next portal code — mirrors EntityCodeHelper.NextCode(ContractorPrefix). */
export function nextContractorCode(companyCode: string, existingCodes: (string | null | undefined)[]): string {
  const prefix = contractorPrefix(companyCode)
  let max = 0
  for (const code of existingCodes) {
    if (!code) continue
    const trimmed = code.trim().toUpperCase()
    if (!trimmed.startsWith(prefix)) continue
    const suffix = trimmed.slice(prefix.length)
    const n = Number.parseInt(suffix, 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}
