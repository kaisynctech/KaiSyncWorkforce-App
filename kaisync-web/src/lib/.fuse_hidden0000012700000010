/** Mirrors MAUI EntityCodeHelper client codes: C{company}#### */

function clientPrefix(companyCode: string): string {
  const normalized = companyCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized ? `C${normalized}` : 'C'
}

/** Next permanent portal code — never rotates an existing code. */
export function nextClientCode(companyCode: string, existingCodes: (string | null | undefined)[]): string {
  const prefix = clientPrefix(companyCode)
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

export const CLIENT_TYPES = ['individual', 'company', 'government', 'ngo', 'property'] as const
export type ClientType = (typeof CLIENT_TYPES)[number]

export const CLIENT_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  company: 'Company',
  government: 'Government',
  ngo: 'NGO',
  property: 'Property',
}

export function normalizeClientType(raw: string | null | undefined): ClientType {
  const v = (raw ?? '').trim().toLowerCase()
  if ((CLIENT_TYPES as readonly string[]).includes(v)) return v as ClientType
  if (v.includes('gov')) return 'government'
  if (v.includes('ngo') || v.includes('non')) return 'ngo'
  if (v.includes('prop')) return 'property'
  if (v.includes('comp') || v.includes('biz') || v.includes('ltd') || v.includes('pty')) return 'company'
  return 'individual'
}

export type ClientCreateInput = {
  companyId: string
  name: string
  type?: string | null
  contactPerson?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  clientCode?: string | null
  portalEnabled?: boolean
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

/** Payload keys are live DB column names only. type is NOT NULL with default individual. */
export function buildClientCreatePayload(input: ClientCreateInput): Record<string, unknown> {
  const name = input.name.trim()
  if (!name) throw new Error('Client name is required.')

  return {
    company_id: input.companyId,
    name,
    type: normalizeClientType(input.type),
    contact_person: emptyToNull(input.contactPerson),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    address: emptyToNull(input.address),
    notes: emptyToNull(input.notes),
    client_code: emptyToNull(input.clientCode),
    portal_enabled: Boolean(input.portalEnabled),
    client_code_expires_at: null,
  }
}
