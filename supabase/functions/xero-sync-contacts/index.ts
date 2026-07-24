import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const TOKEN_URL     = 'https://identity.xero.com/connect/token'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function getValidXeroToken(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ access_token: string; tenant_id: string } | null> {
  const { data: conn } = await admin
    .from('xero_connections')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!conn) return null

  if (new Date(conn.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return { access_token: conn.access_token as string, tenant_id: conn.tenant_id as string }
  }

  const clientId     = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  if (!res.ok) return null

  const tokens    = await res.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await admin.from('xero_connections').update({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token ?? conn.refresh_token,
    expires_at:    expiresAt,
    updated_at:    new Date().toISOString(),
  }).eq('company_id', companyId)

  return { access_token: tokens.access_token as string, tenant_id: conn.tenant_id as string }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json() as {
      company_id:   string
      record_id?:   string   // if present, push only this record
      record_type?: 'client' | 'contractor' // required when record_id is set
    }
    if (!body.company_id) return json({ error: 'Missing company_id' }, 400)
    if (body.record_id && !body.record_type) return json({ error: 'record_type required when record_id is set' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Single-record push ─────────────────────────────────────────────────────
    if (body.record_id && body.record_type) {
      const token = await getValidXeroToken(admin, body.company_id)
      if (!token) return json({ error: 'Xero not connected' }, 400)

      if (body.record_type === 'client') {
        const { data: c } = await admin
          .from('clients')
          .select('id, name, email, phone, address')
          .eq('id', body.record_id)
          .eq('company_id', body.company_id)
          .maybeSingle()
        if (!c) return json({ error: 'Client not found' }, 404)

        const { data: link } = await admin
          .from('xero_contact_links')
          .select('xero_contact_id')
          .eq('company_id', body.company_id)
          .eq('record_type', 'client')
          .eq('record_id', body.record_id)
          .maybeSingle()

        const payload = {
          ...(link ? { ContactID: link.xero_contact_id } : {}),
          Name:         c.name ?? 'Unknown Client',
          EmailAddress: c.email ?? undefined,
          IsCustomer:   true,
          Phones:    c.phone   ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }]    : [],
          Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
        }

        const resp = await fetch(`${XERO_API_BASE}/Contacts`, {
          method: 'POST',
          headers: {
            Authorization:    `Bearer ${token.access_token}`,
            'xero-tenant-id': token.tenant_id,
            'Content-Type':   'application/json',
          },
          body: JSON.stringify({ Contacts: [payload] }),
        })
        if (!resp.ok) return json({ error: `Xero error ${resp.status}` }, 500)
        const result = await resp.json() as { Contacts: Array<{ ContactID: string; Name: string }> }
        const xc = result.Contacts?.[0]
        if (xc?.ContactID) {
          await admin.from('xero_contact_links').upsert({
            company_id: body.company_id, record_type: 'client', record_id: body.record_id,
            xero_contact_id: xc.ContactID, xero_contact_name: xc.Name,
            last_synced_at: new Date().toISOString(),
          }, { onConflict: 'company_id,record_type,record_id' })
        }
        return json({ ok: true, xero_contact_id: xc?.ContactID })
      }

      // contractor / supplier
      const { data: c } = await admin
        .from('contractors')
        .select('id, name, email, phone, address, vat_number')
        .eq('id', body.record_id)
        .eq('company_id', body.company_id)
        .maybeSingle()
      if (!c) return json({ error: 'Contractor not found' }, 404)

      const { data: link } = await admin
        .from('xero_contact_links')
        .select('xero_contact_id')
        .eq('company_id', body.company_id)
        .eq('record_type', 'contractor')
        .eq('record_id', body.record_id)
        .maybeSingle()

      const payload = {
        ...(link ? { ContactID: link.xero_contact_id } : {}),
        Name:         c.name ?? 'Unknown Contractor',
        EmailAddress: c.email ?? undefined,
        IsSupplier:   true,
        TaxNumber:    c.vat_number ?? undefined,
        Phones:    c.phone   ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }]    : [],
        Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
      }

      const resp = await fetch(`${XERO_API_BASE}/Contacts`, {
        method: 'POST',
        headers: {
          Authorization:    `Bearer ${token.access_token}`,
          'xero-tenant-id': token.tenant_id,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ Contacts: [payload] }),
      })
      if (!resp.ok) return json({ error: `Xero error ${resp.status}` }, 500)
      const result = await resp.json() as { Contacts: Array<{ ContactID: string; Name: string }> }
      const xc = result.Contacts?.[0]
      if (xc?.ContactID) {
        await admin.from('xero_contact_links').upsert({
          company_id: body.company_id, record_type: 'contractor', record_id: body.record_id,
          xero_contact_id: xc.ContactID, xero_contact_name: xc.Name,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'company_id,record_type,record_id' })
      }
      return json({ ok: true, xero_contact_id: xc?.ContactID })
    }
    // ── end single-record push — fall through to bulk push below ──────────────

    const token = await getValidXeroToken(admin, body.company_id)
    if (!token) return json({ error: 'Xero not connected for this company' }, 400)

    // Bulk push — employees + contractors
    const [empRes, ctRes] = await Promise.all([
      admin.from('employees')
        .select('id, name, surname, email')
        .eq('company_id', body.company_id)
        .eq('is_active', true),
      admin.from('contractors')
        .select('id, name, email')
        .eq('company_id', body.company_id)
        .eq('is_active', true),
    ])

    type RecordInfo = { record_type: string; record_id: string; name: string }
    const contacts: Array<{ Name: string; EmailAddress?: string }> = []
    const recordMap: RecordInfo[] = []

    for (const e of (empRes.data ?? [])) {
      const name = `${e.name} ${e.surname}`
      contacts.push({ Name: name, ...(e.email ? { EmailAddress: e.email } : {}) })
      recordMap.push({ record_type: 'employee', record_id: e.id, name })
    }
    for (const c of (ctRes.data ?? [])) {
      contacts.push({ Name: c.name, ...(c.email ? { EmailAddress: c.email } : {}) })
      recordMap.push({ record_type: 'contractor', record_id: c.id, name: c.name })
    }

    if (contacts.length === 0) return json({ synced: 0 })

    let synced = 0
    const BATCH = 100
    for (let i = 0; i < contacts.length; i += BATCH) {
      const batch = contacts.slice(i, i + BATCH)
      const res = await fetch(`${XERO_API_BASE}/Contacts`, {
        method: 'POST',
        headers: {
          Authorization:    `Bearer ${token.access_token}`,
          'xero-tenant-id': token.tenant_id,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ Contacts: batch }),
      })
      if (!res.ok) continue

      const result = await res.json()
      const xeroContacts: Array<{ ContactID: string; Name: string }> = result.Contacts ?? []

      for (const xc of xeroContacts) {
        const rec = recordMap.find(r => r.name === xc.Name)
        if (!rec) continue
        await admin.from('xero_contact_links').upsert({
          company_id:        body.company_id,
          record_type:       rec.record_type,
          record_id:         rec.record_id,
          xero_contact_id:   xc.ContactID,
          xero_contact_name: rec.name,
          last_synced_at:    new Date().toISOString(),
        }, { onConflict: 'company_id,record_type,record_id' })
        synced++
      }
    }

    return json({ synced })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
