import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Clients and suppliers ↔ Xero contacts.
 * - Always asks Xero for JSON (without Accept: application/json Xero answers in XML, which broke "Push to Xero").
 * - Never creates a duplicate: before creating a contact it looks for one in Xero with the same name or
 *   email (archived ones too) and links to it instead.
 * - Xero's own validation message is shown when something is refused.
 * - Only an active employee of the company can call it.
 */

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const TOKEN_URL     = 'https://identity.xero.com/connect/token'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

type Admin = SupabaseClient<any, any, any>
type XeroContact = {
  ContactID: string; Name: string; EmailAddress?: string; ContactStatus?: string
  IsCustomer?: boolean; IsSupplier?: boolean
  Phones?: Array<{ PhoneType: string; PhoneNumber: string }>
  Addresses?: Array<{ AddressType: string; AddressLine1?: string }>
  TaxNumber?: string
  ValidationErrors?: Array<{ Message: string }>
  HasValidationErrors?: boolean
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

async function getValidXeroToken(admin: Admin, companyId: string): Promise<{ access_token: string; tenant_id: string } | null> {
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
  if (!res.ok) return null
  const tokens = await res.json()
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await admin.from('xero_connections').update({
    access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? conn.refresh_token,
    token_expires_at: newExpiry, expires_at: newExpiry, updated_at: new Date().toISOString(),
  }).eq('company_id', companyId)
  return { access_token: tokens.access_token as string, tenant_id: conn.tenant_id as string }
}

/** Calls Xero and always gets JSON back. Returns { ok, status, data, error } with Xero's own message on failure. */
async function xero(token: { access_token: string; tenant_id: string }, path: string, init: RequestInit = {}) {
  const resp = await fetch(`${XERO_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'xero-tenant-id': token.tenant_id,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const text = await resp.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (resp.ok && data) return { ok: true, status: resp.status, data, error: null as string | null }
  const msgs: string[] = []
  for (const el of data?.Elements ?? []) for (const v of el.ValidationErrors ?? []) if (v?.Message) msgs.push(v.Message)
  const error = msgs.length ? msgs.join('; ')
    : data?.Detail ?? data?.Message ?? data?.Title
    ?? (resp.status === 401 || resp.status === 403 ? 'Xero refused access. Reconnect Xero in Settings → Integrations.'
      : resp.status === 429 ? 'Xero is busy (too many requests). Try again in a minute.'
      : `Xero error ${resp.status}`)
  return { ok: false, status: resp.status, data, error }
}

/** All Xero contacts, archived included (paginated). */
async function fetchAllXeroContacts(token: { access_token: string; tenant_id: string }): Promise<XeroContact[]> {
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

/** An existing Xero contact with the same name, or failing that the same email (active preferred over archived). */
async function findXeroMatch(token: { access_token: string; tenant_id: string }, name: string, email: string | null): Promise<XeroContact | null> {
  const terms = [name, email].filter(Boolean) as string[]
  const found: XeroContact[] = []
  for (const t of terms) {
    const r = await xero(token, `/Contacts?includeArchived=true&searchTerm=${encodeURIComponent(t.trim())}`)
    if (r.ok) found.push(...(r.data.Contacts ?? []))
  }
  const rank = (c: XeroContact) => (c.ContactStatus === 'ARCHIVED' ? 1 : 0)
  const byName = found.filter(c => norm(c.Name) === norm(name)).sort((a, b) => rank(a) - rank(b))
  if (byName[0]) return byName[0]
  const byEmail = email ? found.filter(c => norm(c.EmailAddress) === norm(email)).sort((a, b) => rank(a) - rank(b)) : []
  return byEmail[0] ?? null
}

type Kind = 'client' | 'contractor'
type Rec = { id: string; name: string | null; email: string | null; phone: string | null; address: string | null; vat_number?: string | null }

function contactPayload(kind: Kind, c: Rec, contactId?: string) {
  return {
    ...(contactId ? { ContactID: contactId } : {}),
    Name: (c.name ?? '').trim() || (kind === 'client' ? 'Unknown client' : 'Unknown supplier'),
    ...(c.email ? { EmailAddress: c.email.trim() } : {}),
    ...(kind === 'contractor' && c.vat_number ? { TaxNumber: c.vat_number } : {}),
    ...(c.phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] } : {}),
    ...(c.address ? { Addresses: [{ AddressType: 'STREET', AddressLine1: c.address }] } : {}),
  }
}

async function saveLink(admin: Admin, companyId: string, kind: Kind, recordId: string, xc: { ContactID: string; Name: string }) {
  await admin.from('xero_contact_links').upsert({
    company_id: companyId, record_type: kind, record_id: recordId,
    xero_contact_id: xc.ContactID, xero_contact_name: xc.Name, last_synced_at: new Date().toISOString(),
  }, { onConflict: 'company_id,record_type,record_id' })
}

/** Push one client/supplier: update its linked contact, or link to a matching one, or create it. */
async function pushOne(admin: Admin, token: { access_token: string; tenant_id: string }, companyId: string, kind: Kind, c: Rec,
  linkedId: string | null, matchFrom?: (c: Rec) => XeroContact | null) {
  let contactId = linkedId
  let matchedExisting = false
  if (!contactId) {
    const m = matchFrom ? matchFrom(c) : await findXeroMatch(token, c.name ?? '', c.email)
    if (m) { contactId = m.ContactID; matchedExisting = true }
  }
  const r = await xero(token, '/Contacts', { method: 'POST', body: JSON.stringify({ Contacts: [contactPayload(kind, c, contactId ?? undefined)] }) })
  let xc: XeroContact | undefined = r.ok ? r.data.Contacts?.[0] : undefined
  if (!r.ok && linkedId && r.status === 404) {
    // The linked contact was deleted in Xero: drop the link and try once more by name/email.
    await admin.from('xero_contact_links').delete().eq('company_id', companyId).eq('record_type', kind).eq('record_id', c.id)
    return pushOne(admin, token, companyId, kind, c, null, matchFrom)
  }
  if (!r.ok || !xc?.ContactID) return { ok: false as const, error: r.error ?? 'Xero did not return the contact' }
  await saveLink(admin, companyId, kind, c.id, xc)
  return { ok: true as const, xero_contact_id: xc.ContactID, matched_existing: matchedExisting }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => ({})) as {
      company_id?: string; direction?: 'push' | 'pull' | 'accounts'; record_id?: string; record_type?: Kind
    }
    if (!body.company_id) return json({ error: 'Missing company_id' }, 400)
    if (body.record_id && !body.record_type) return json({ error: 'record_type required when record_id is set' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Caller must be an active employee of this company.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userSb = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userSb.auth.getUser()
    if (!user) return json({ error: 'Please sign in again.' }, 401)
    const { data: emp } = await admin.from('employees').select('id').eq('user_id', user.id).eq('company_id', body.company_id).eq('is_active', true).maybeSingle()
    if (!emp) return json({ error: 'You are not part of this company.' }, 403)

    const token = await getValidXeroToken(admin, body.company_id)
    if (!token) return json({ error: 'Xero is not connected (or the connection expired). Connect Xero in Settings → Integrations.' }, 400)

    // ACCOUNTS: the company's Xero accounts, for the Settings dropdowns (sales, purchases, bank).
    if (body.direction === 'accounts') {
      const r = await xero(token, '/Accounts?where=' + encodeURIComponent('Status=="ACTIVE"'))
      if (!r.ok) return json({ error: r.error }, 422)
      const accounts = (r.data.Accounts ?? []).map((a: any) => ({
        id: a.AccountID, code: a.Code ?? null, name: a.Name, type: a.Type, class: a.Class,
        enable_payments: !!a.EnablePaymentsToAccount,
      }))
      return json({ ok: true, accounts })
    }

    // ── PULL: link Xero contacts to existing clients/suppliers; create only those that don't exist ──
    if (body.direction === 'pull') {
      const xeroContacts = (await fetchAllXeroContacts(token)).filter(x => x.ContactStatus !== 'ARCHIVED')
      const [clientsRes, contractorsRes, linksRes] = await Promise.all([
        admin.from('clients').select('id, name, email').eq('company_id', body.company_id),
        admin.from('contractors').select('id, name, email').eq('company_id', body.company_id),
        admin.from('xero_contact_links').select('record_type, record_id, xero_contact_id').eq('company_id', body.company_id),
      ])
      const links = linksRes.data ?? []
      const linkedXero = new Set(links.map(l => `${l.record_type}:${l.xero_contact_id}`))
      const linkedRec = new Set(links.map(l => `${l.record_type}:${l.record_id}`))
      let matched = 0, created = 0, skipped = 0

      for (const xc of xeroContacts) {
        const kinds: Kind[] = []
        if (xc.IsCustomer) kinds.push('client')
        if (xc.IsSupplier) kinds.push('contractor')
        if (!kinds.length) { skipped++; continue }
        for (const kind of kinds) {
          if (linkedXero.has(`${kind}:${xc.ContactID}`)) { skipped++; continue }
          const pool = (kind === 'client' ? clientsRes.data : contractorsRes.data) ?? []
          const match = pool.find(c => !linkedRec.has(`${kind}:${c.id}`) && (norm(c.name) === norm(xc.Name) || (!!xc.EmailAddress && norm(c.email) === norm(xc.EmailAddress))))
          let recordId = match?.id as string | undefined
          if (!recordId) {
            const phone = xc.Phones?.find(p => p.PhoneType === 'DEFAULT')?.PhoneNumber || null
            const address = xc.Addresses?.find(a => a.AddressType === 'STREET')?.AddressLine1 || null
            const ins = kind === 'client'
              ? await admin.from('clients').insert({ company_id: body.company_id, name: xc.Name, email: xc.EmailAddress || null, phone, address, type: 'company' }).select('id').maybeSingle()
              : await admin.from('contractors').insert({ company_id: body.company_id, name: xc.Name, email: xc.EmailAddress || null, phone, address, vat_number: xc.TaxNumber || null, is_active: true }).select('id').maybeSingle()
            recordId = ins.data?.id
            if (!recordId) continue
            pool.push({ id: recordId, name: xc.Name, email: xc.EmailAddress ?? null })
            created++
          } else matched++
          await saveLink(admin, body.company_id, kind, recordId, xc)
          linkedXero.add(`${kind}:${xc.ContactID}`); linkedRec.add(`${kind}:${recordId}`)
        }
      }
      return json({ ok: true, direction: 'pull', matched, created, skipped, total: xeroContacts.length })
    }

    // ── SINGLE PUSH (the "Push to Xero" / "Update in Xero" button) ──
    if (body.record_id && body.record_type) {
      const kind = body.record_type
      const { data: c } = kind === 'client'
        ? await admin.from('clients').select('id, name, email, phone, address').eq('id', body.record_id).eq('company_id', body.company_id).maybeSingle()
        : await admin.from('contractors').select('id, name, email, phone, address, vat_number').eq('id', body.record_id).eq('company_id', body.company_id).maybeSingle()
      if (!c) return json({ error: kind === 'client' ? 'Client not found' : 'Supplier not found' }, 404)
      const { data: link } = await admin.from('xero_contact_links').select('xero_contact_id')
        .eq('company_id', body.company_id).eq('record_type', kind).eq('record_id', body.record_id).maybeSingle()
      const r = await pushOne(admin, token, body.company_id, kind, c as Rec, link?.xero_contact_id ?? null)
      return r.ok ? json(r) : json({ error: r.error }, 422)
    }

    // ── BULK PUSH (Settings → Sync now): every client and active supplier; no duplicates ──
    const [clientsRes, contractorsRes, linksRes] = await Promise.all([
      admin.from('clients').select('id, name, email, phone, address').eq('company_id', body.company_id),
      admin.from('contractors').select('id, name, email, phone, address, vat_number').eq('company_id', body.company_id).eq('is_active', true),
      admin.from('xero_contact_links').select('record_type, record_id, xero_contact_id').eq('company_id', body.company_id),
    ])
    const linkMap = new Map((linksRes.data ?? []).map(l => [`${l.record_type}:${l.record_id}`, l.xero_contact_id as string]))
    const xeroAll = await fetchAllXeroContacts(token)
    const takenIds = new Set(linkMap.values())
    const matchFrom = (c: Rec) => {
      const free = xeroAll.filter(x => !takenIds.has(x.ContactID))
      const m = free.find(x => norm(x.Name) === norm(c.name)) ?? (c.email ? free.find(x => norm(x.EmailAddress) === norm(c.email)) : undefined)
      if (m) takenIds.add(m.ContactID)
      return m ?? null
    }

    let clientsPushed = 0, contractorsPushed = 0, linkedExisting = 0
    const failed: Array<{ type: Kind; name: string | null; error: string }> = []
    const items = [
      ...((clientsRes.data ?? []) as Rec[]).map(c => ({ kind: 'client' as Kind, c })),
      ...((contractorsRes.data ?? []) as Rec[]).map(c => ({ kind: 'contractor' as Kind, c })),
    ].map(it => {
      const linked = linkMap.get(`${it.kind}:${it.c.id}`) ?? null
      const m = linked ? null : matchFrom(it.c)
      return { ...it, contactId: linked ?? m?.ContactID ?? null, matched: !!m }
    })
    // Xero takes up to 50 contacts per call; summarizeErrors=false gives a result for each one.
    for (let i = 0; i < items.length; i += 50) {
      const chunk = items.slice(i, i + 50)
      const r = await xero(token, '/Contacts?summarizeErrors=false', {
        method: 'POST', body: JSON.stringify({ Contacts: chunk.map(it => contactPayload(it.kind, it.c, it.contactId ?? undefined)) }),
      })
      const back: XeroContact[] = r.data?.Contacts ?? []
      if (!r.ok && !back.length) { for (const it of chunk) failed.push({ type: it.kind, name: it.c.name, error: r.error ?? 'Xero error' }); continue }
      for (let j = 0; j < chunk.length; j++) {
        const it = chunk[j], xc = back[j]
        const errs = (xc?.ValidationErrors ?? []).map(v => v.Message).filter(Boolean)
        if (!xc?.ContactID || errs.length) { failed.push({ type: it.kind, name: it.c.name, error: errs.join('; ') || 'Xero did not return the contact' }); continue }
        await saveLink(admin, body.company_id, it.kind, it.c.id, xc)
        if (it.kind === 'client') clientsPushed++; else contractorsPushed++
        if (it.matched) linkedExisting++
      }
    }
    return json({ ok: true, direction: 'push', clients_pushed: clientsPushed, contractors_pushed: contractorsPushed,
      linked_existing: linkedExisting, synced: clientsPushed + contractorsPushed, failed: failed.slice(0, 50), failed_count: failed.length })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
