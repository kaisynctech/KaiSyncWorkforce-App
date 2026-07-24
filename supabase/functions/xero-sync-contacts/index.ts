import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const TOKEN_URL     = 'https://identity.xero.com/connect/token'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
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

  // Use whichever column name the engineer used: expires_at or token_expires_at
  const expiresAt = conn.token_expires_at ?? conn.expires_at
  if (new Date(expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return { access_token: conn.access_token as string, tenant_id: conn.tenant_id as string }
  }

  const clientId     = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  if (!res.ok) return null

  const tokens    = await res.json()
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await admin.from('xero_connections').update({
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token ?? conn.refresh_token,
    token_expires_at: newExpiry,
    expires_at:       newExpiry,  // keep both columns in sync regardless of which exists
  }).eq('company_id', companyId)

  return { access_token: tokens.access_token as string, tenant_id: conn.tenant_id as string }
}

/** Fetch all Xero contacts (paginated). Optionally filter by IsCustomer or IsSupplier. */
async function fetchAllXeroContacts(
  accessToken: string,
  tenantId:    string,
  filter?:     'customer' | 'supplier',
): Promise<Array<{
  ContactID:    string
  Name:         string
  EmailAddress: string
  IsCustomer:   boolean
  IsSupplier:   boolean
  Phones?:      Array<{ PhoneType: string; PhoneNumber: string }>
  Addresses?:   Array<{ AddressType: string; AddressLine1?: string }>
  TaxNumber?:   string
}>> {
  const all = []
  let page  = 1

  while (true) {
    const url = new URL(`${XERO_API_BASE}/Contacts`)
    url.searchParams.set('page', String(page))
    if (filter === 'customer') url.searchParams.set('where', 'IsCustomer=true')
    if (filter === 'supplier') url.searchParams.set('where', 'IsSupplier=true')

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization:    `Bearer ${accessToken}`,
        'xero-tenant-id': tenantId,
        Accept:           'application/json',
      },
    })
    if (!resp.ok) break

    const data  = await resp.json()
    const batch = data.Contacts ?? []
    all.push(...batch)

    // Xero returns fewer than 100 on the last page
    if (batch.length < 100) break
    page++
  }

  return all
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json() as {
      company_id:   string
      direction?:   'push' | 'pull'  // default 'push'
      record_id?:   string
      record_type?: 'client' | 'contractor'
    }

    if (!body.company_id) return json({ error: 'Missing company_id' }, 400)
    if (body.record_id && !body.record_type) {
      return json({ error: 'record_type required when record_id is set' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = await getValidXeroToken(admin, body.company_id)
    if (!token) return json({ error: 'Xero not connected for this company' }, 400)

    // ══════════════════════════════════════════════════════════════════════════
    // PULL — Import contacts FROM Xero INTO KaiFlow
    // ══════════════════════════════════════════════════════════════════════════
    if (body.direction === 'pull') {
      const xeroContacts = await fetchAllXeroContacts(token.access_token, token.tenant_id)

      const [clientsRes, contractorsRes, existingLinksRes] = await Promise.all([
        admin.from('clients').select('id, name, email').eq('company_id', body.company_id),
        admin.from('contractors').select('id, name, email').eq('company_id', body.company_id),
        admin.from('xero_contact_links').select('xero_contact_id').eq('company_id', body.company_id),
      ])

      const existingClients     = clientsRes.data     ?? []
      const existingContractors = contractorsRes.data ?? []
      const alreadyLinked       = new Set((existingLinksRes.data ?? []).map(l => l.xero_contact_id))

      let matched = 0
      let created = 0
      let skipped = 0

      for (const xc of xeroContacts) {
        if (alreadyLinked.has(xc.ContactID)) { skipped++; continue }

        const xcName  = (xc.Name ?? '').trim().toLowerCase()
        const xcEmail = (xc.EmailAddress ?? '').trim().toLowerCase()

        if (xc.IsCustomer) {
          const match = existingClients.find(c =>
            c.name?.trim().toLowerCase() === xcName ||
            (xcEmail && c.email?.trim().toLowerCase() === xcEmail)
          )

          if (match) {
            await admin.from('xero_contact_links').upsert({
              company_id:        body.company_id,
              record_type:       'client',
              record_id:         match.id,
              xero_contact_id:   xc.ContactID,
              xero_contact_name: xc.Name,
              last_synced_at:    new Date().toISOString(),
            }, { onConflict: 'company_id,record_type,record_id' })
            matched++
          } else {
            const phone   = xc.Phones?.find(p => p.PhoneType === 'DEFAULT')?.PhoneNumber
            const address = xc.Addresses?.find(a => a.AddressType === 'STREET')?.AddressLine1
            const { data: newClient } = await admin.from('clients').insert({
              company_id: body.company_id,
              name:       xc.Name,
              email:      xc.EmailAddress || null,
              phone:      phone || null,
              address:    address || null,
              type:       'company',
            }).select('id').maybeSingle()

            if (newClient) {
              await admin.from('xero_contact_links').insert({
                company_id:        body.company_id,
                record_type:       'client',
                record_id:         newClient.id,
                xero_contact_id:   xc.ContactID,
                xero_contact_name: xc.Name,
                last_synced_at:    new Date().toISOString(),
              })
              created++
            }
          }
        }

        if (xc.IsSupplier) {
          const match = existingContractors.find(c =>
            c.name?.trim().toLowerCase() === xcName ||
            (xcEmail && c.email?.trim().toLowerCase() === xcEmail)
          )

          if (match) {
            await admin.from('xero_contact_links').upsert({
              company_id:        body.company_id,
              record_type:       'contractor',
              record_id:         match.id,
              xero_contact_id:   xc.ContactID,
              xero_contact_name: xc.Name,
              last_synced_at:    new Date().toISOString(),
            }, { onConflict: 'company_id,record_type,record_id' })
            matched++
          } else {
            const phone   = xc.Phones?.find(p => p.PhoneType === 'DEFAULT')?.PhoneNumber
            const address = xc.Addresses?.find(a => a.AddressType === 'STREET')?.AddressLine1
            const { data: newContractor } = await admin.from('contractors').insert({
              company_id: body.company_id,
              name:       xc.Name,
              email:      xc.EmailAddress || null,
              phone:      phone || null,
              address:    address || null,
              vat_number: xc.TaxNumber || null,
              is_active:  true,
            }).select('id').maybeSingle()

            if (newContractor) {
              await admin.from('xero_contact_links').insert({
                company_id:        body.company_id,
                record_type:       'contractor',
                record_id:         newContractor.id,
                xero_contact_id:   xc.ContactID,
                xero_contact_name: xc.Name,
                last_synced_at:    new Date().toISOString(),
              })
              created++
            }
          }
        }

        if (!xc.IsCustomer && !xc.IsSupplier) skipped++
      }

      return json({ ok: true, direction: 'pull', matched, created, skipped, total: xeroContacts.length })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SINGLE-RECORD PUSH
    // ══════════════════════════════════════════════════════════════════════════
    if (body.record_id && body.record_type) {
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
          Phones:    c.phone   ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }]     : [],
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
        Phones:    c.phone   ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }]     : [],
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

    // ══════════════════════════════════════════════════════════════════════════
    // BULK PUSH — clients (Customers) + contractors (Suppliers)
    // BUG FIX: was pushing employees — now correctly pushes clients + contractors
    // ══════════════════════════════════════════════════════════════════════════
    const [clientsRes, contractorsRes] = await Promise.all([
      admin.from('clients').select('id, name, email, phone, address').eq('company_id', body.company_id),
      admin.from('contractors').select('id, name, email, phone, address, vat_number').eq('company_id', body.company_id).eq('is_active', true),
    ])

    const { data: existingLinks } = await admin
      .from('xero_contact_links')
      .select('record_id, xero_contact_id, record_type')
      .eq('company_id', body.company_id)

    const linkMap = new Map((existingLinks ?? []).map(l => [`${l.record_type}:${l.record_id}`, l.xero_contact_id]))

    const clientPayloads = (clientsRes.data ?? []).map(c => ({
      ...(linkMap.has(`client:${c.id}`) ? { ContactID: linkMap.get(`client:${c.id}`) } : {}),
      Name: c.name ?? 'Unknown', EmailAddress: c.email ?? undefined, IsCustomer: true,
      Phones:    c.phone   ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }]     : [],
      Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
      _kf_id: c.id, _kf_type: 'client',
    }))

    const contractorPayloads = (contractorsRes.data ?? []).map(c => ({
      ...(linkMap.has(`contractor:${c.id}`) ? { ContactID: linkMap.get(`contractor:${c.id}`) } : {}),
      Name: c.name ?? 'Unknown', EmailAddress: c.email ?? undefined, IsSupplier: true,
      TaxNumber: c.vat_number ?? undefined,
      Phones:    c.phone   ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }]     : [],
      Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
      _kf_id: c.id, _kf_type: 'contractor',
    }))

    const allPayloads = [...clientPayloads, ...contractorPayloads]
    let clientsPushed = 0
    let contractorsPushed = 0
    const BATCH = 100

    for (let i = 0; i < allPayloads.length; i += BATCH) {
      const chunk = allPayloads.slice(i, i + BATCH)
      const xeroPayload = chunk.map(({ _kf_id: _a, _kf_type: _b, ...rest }) => rest)

      const resp = await fetch(`${XERO_API_BASE}/Contacts`, {
        method: 'POST',
        headers: {
          Authorization:    `Bearer ${token.access_token}`,
          'xero-tenant-id': token.tenant_id,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ Contacts: xeroPayload }),
      })
      if (!resp.ok) continue

      const result = await resp.json() as { Contacts: Array<{ ContactID: string; Name: string }> }
      const xeroReturned = result.Contacts ?? []

      for (let j = 0; j < xeroReturned.length; j++) {
        const xc  = xeroReturned[j]
        const src = chunk[j]
        if (!xc?.ContactID || !src) continue

        await admin.from('xero_contact_links').upsert({
          company_id:        body.company_id,
          record_type:       src._kf_type,
          record_id:         src._kf_id,
          xero_contact_id:   xc.ContactID,
          xero_contact_name: xc.Name,
          last_synced_at:    new Date().toISOString(),
        }, { onConflict: 'company_id,record_type,record_id' })

        if (src._kf_type === 'client') clientsPushed++
        else contractorsPushed++
      }
    }

    return json({ ok: true, direction: 'push', clients_pushed: clientsPushed, contractors_pushed: contractorsPushed })

  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
