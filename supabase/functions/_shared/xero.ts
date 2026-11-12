// Shared Xero helpers for the edge functions (token refresh, JSON calls with Xero's real error, contacts).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const TOKEN_URL = 'https://identity.xero.com/connect/token'

export type Admin = SupabaseClient<any, any, any>
export type XeroToken = { access_token: string; tenant_id: string }
export type XeroContact = {
  ContactID: string; Name: string; EmailAddress?: string; ContactStatus?: string
  IsCustomer?: boolean; IsSupplier?: boolean
  Phones?: Array<{ PhoneType: string; PhoneNumber: string }>
  Addresses?: Array<{ AddressType: string; AddressLine1?: string }>
  TaxNumber?: string
  ValidationErrors?: Array<{ Message: string }>
}

export const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Scopes asked for at connect time. Granular scopes work for apps made before and after Xero's 2 March 2026 change. */
export const XERO_SCOPES = 'openid profile email offline_access accounting.contacts accounting.settings accounting.invoices accounting.payments accounting.manualjournals accounting.attachments'

/** Reads the scope claim from a Xero access token (a JWT). */
export function tokenScopes(accessToken: string): string {
  try {
    const p = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return Array.isArray(p.scope) ? p.scope.join(' ') : String(p.scope ?? '')
  } catch { return '' }
}

export async function getValidXeroToken(admin: Admin, companyId: string): Promise<XeroToken | null> {
  const { data: conn } = await admin.from('xero_connections').select('*').eq('company_id', companyId).maybeSingle()
  if (!conn || conn.is_active === false) return null
  const expiresAt = conn.token_expires_at ?? conn.expires_at
  if (expiresAt && new Date(expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return { access_token: conn.access_token as string, tenant_id: conn.tenant_id as string }
  }
  const clientId = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  if (!res.ok) {
    await admin.from('xero_connections').update({ last_error: 'Xero connection expired. Reconnect Xero in Settings → Integrations.', last_error_at: new Date().toISOString() }).eq('company_id', companyId)
    return null
  }
  const tokens = await res.json()
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await admin.from('xero_connections').update({
    access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? conn.refresh_token,
    token_expires_at: newExpiry, expires_at: newExpiry, scopes: tokenScopes(tokens.access_token) || conn.scopes,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId)
  return { access_token: tokens.access_token as string, tenant_id: conn.tenant_id as string }
}

export type XeroResult = { ok: boolean; status: number; data: any; error: string | null }

/** Calls Xero and always asks for JSON. On failure, error is Xero's own validation message. */
export async function xero(token: XeroToken, path: string, init: RequestInit = {}): Promise<XeroResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`${XERO_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.access_token}`, 'xero-tenant-id': token.tenant_id, Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...((init.headers ?? {}) as Record<string, string>),
      },
    })
    if (resp.status === 429 && attempt < 2) {
      const wait = Math.min(Number(resp.headers.get('Retry-After') ?? '5'), 20)
      await new Promise(r => setTimeout(r, wait * 1000)); continue
    }
    const text = await resp.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
    if (resp.ok && data) return { ok: true, status: resp.status, data, error: null }
    const msgs: string[] = []
    for (const el of data?.Elements ?? []) {
      for (const v of el.ValidationErrors ?? []) if (v?.Message) msgs.push(v.Message)
      for (const li of el.LineItems ?? []) for (const v of li.ValidationErrors ?? []) if (v?.Message) msgs.push(v.Message)
    }
    const error = msgs.length ? [...new Set(msgs)].join('; ')
      : data?.Detail ?? data?.Message ?? data?.Title
      ?? (resp.status === 401 || resp.status === 403 ? 'Xero refused access. Reconnect Xero in Settings → Integrations (it needs permission for invoices and payments).'
        : resp.status === 429 ? 'Xero is busy (too many requests). It will try again shortly.'
        : `Xero error ${resp.status}`)
    // Make Xero's currency refusal say what to do.
    const cur = /not subscribed to currency ([A-Z]{3})/i.exec(error ?? '')
    const friendly = cur ? `Xero doesn't have ${cur[1]} switched on. In Xero go to Accounting → Advanced → Currencies, add ${cur[1]}, then press Try again.` : error
    return { ok: false, status: resp.status, data, error: friendly }
  }
  return { ok: false, status: 429, data: null, error: 'Xero is busy (too many requests). It will try again shortly.' }
}

export async function fetchAllXeroContacts(token: XeroToken): Promise<XeroContact[]> {
  const all: XeroContact[] = []
  for (let page = 1; page < 200; page++) {
    const r = await xero(token, `/Contacts?page=${page}&includeArchived=true`)
    if (!r.ok) throw new Error(r.error ?? 'Could not read contacts from Xero')
    const batch: XeroContact[] = r.data.Contacts ?? []
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

/** A Xero contact with the same name, or failing that the same email (active preferred over archived). */
export async function findXeroMatch(token: XeroToken, name: string, email: string | null): Promise<XeroContact | null> {
  const found: XeroContact[] = []
  for (const t of [name, email].filter(Boolean) as string[]) {
    const r = await xero(token, `/Contacts?includeArchived=true&searchTerm=${encodeURIComponent(t.trim())}`)
    if (r.ok) found.push(...(r.data.Contacts ?? []))
  }
  const rank = (c: XeroContact) => (c.ContactStatus === 'ARCHIVED' ? 1 : 0)
  const byName = found.filter(c => norm(c.Name) === norm(name)).sort((a, b) => rank(a) - rank(b))
  if (byName[0]) return byName[0]
  const byEmail = email ? found.filter(c => norm(c.EmailAddress) === norm(email)).sort((a, b) => rank(a) - rank(b)) : []
  return byEmail[0] ?? null
}

export type Kind = 'client' | 'contractor'
export type ContactRec = { id: string; name: string | null; email: string | null; phone: string | null; address: string | null; vat_number?: string | null }

export function contactPayload(kind: Kind, c: ContactRec, contactId?: string) {
  return {
    ...(contactId ? { ContactID: contactId } : {}),
    Name: (c.name ?? '').trim() || (kind === 'client' ? 'Unknown client' : 'Unknown supplier'),
    ...(c.email ? { EmailAddress: c.email.trim() } : {}),
    ...(kind === 'contractor' && c.vat_number ? { TaxNumber: c.vat_number } : {}),
    ...(c.phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] } : {}),
    ...(c.address ? { Addresses: [{ AddressType: 'STREET', AddressLine1: c.address }] } : {}),
  }
}

export async function saveContactLink(admin: Admin, companyId: string, kind: Kind, recordId: string, xc: { ContactID: string; Name: string }) {
  await admin.from('xero_contact_links').upsert({
    company_id: companyId, record_type: kind, record_id: recordId,
    xero_contact_id: xc.ContactID, xero_contact_name: xc.Name, last_synced_at: new Date().toISOString(),
  }, { onConflict: 'company_id,record_type,record_id' })
}

/** Push one client/supplier: update its linked contact, or link to a matching one, or create it. */
export async function pushContact(admin: Admin, token: XeroToken, companyId: string, kind: Kind, c: ContactRec,
  linkedId: string | null, matchFrom?: (c: ContactRec) => XeroContact | null,
): Promise<{ ok: true; xero_contact_id: string; matched_existing: boolean } | { ok: false; error: string }> {
  let contactId = linkedId
  let matchedExisting = false
  if (!contactId) {
    const m = matchFrom ? matchFrom(c) : await findXeroMatch(token, c.name ?? '', c.email)
    if (m) { contactId = m.ContactID; matchedExisting = true }
  }
  const r = await xero(token, '/Contacts', { method: 'POST', body: JSON.stringify({ Contacts: [contactPayload(kind, c, contactId ?? undefined)] }) })
  const xc: XeroContact | undefined = r.ok ? r.data.Contacts?.[0] : undefined
  if (!r.ok && linkedId && r.status === 404) {
    await admin.from('xero_contact_links').delete().eq('company_id', companyId).eq('record_type', kind).eq('record_id', c.id)
    return pushContact(admin, token, companyId, kind, c, null, matchFrom)
  }
  if (!r.ok || !xc?.ContactID) return { ok: false, error: r.error ?? 'Xero did not return the contact' }
  await saveContactLink(admin, companyId, kind, c.id, xc)
  return { ok: true, xero_contact_id: xc.ContactID, matched_existing: matchedExisting }
}

/** The Xero contact for a client/supplier, pushing it first if it isn't linked yet. */
export async function ensureContact(admin: Admin, token: XeroToken, companyId: string, kind: Kind, recordId: string): Promise<string> {
  const { data: link } = await admin.from('xero_contact_links').select('xero_contact_id')
    .eq('company_id', companyId).eq('record_type', kind).eq('record_id', recordId).maybeSingle()
  if (link?.xero_contact_id) return link.xero_contact_id as string
  const { data: c } = kind === 'client'
    ? await admin.from('clients').select('id, name, email, phone, address').eq('id', recordId).maybeSingle()
    : await admin.from('contractors').select('id, name, email, phone, address, vat_number').eq('id', recordId).maybeSingle()
  if (!c) throw new Error(kind === 'client' ? 'The client on this document no longer exists.' : 'The supplier on this document no longer exists.')
  const r = await pushContact(admin, token, companyId, kind, c as ContactRec, null)
  if (!r.ok) throw new Error(`Could not add ${(c as ContactRec).name ?? 'the contact'} to Xero: ${r.error}`)
  return r.xero_contact_id
}
