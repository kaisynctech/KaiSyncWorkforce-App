# MISSION BRIEF — XERO PER-RECORD SYNC UX
**Spec:** XERO-002  
**Status:** READY TO IMPLEMENT  
**Date:** 2026-07-24  
**Depends on:** XERO-001 must be deployed (xero_contact_links table + xero-sync-contacts Edge Function)

---

## What we're building

Every contractors, suppliers, and clients page gets:

1. **Xero column in the table** — green tick if synced to Xero, grey "+ Xero" button if not. Clicking the button pushes that single record instantly (no page navigation required). The row updates in place.
2. **"Sync All to Xero" button in the toolbar** — pushes all un-synced records in one go (skips already-synced ones).
3. **Xero status on the detail page** — badge showing "Synced ✓" or "Not in Xero" with a "Push to Xero" button.

---

## Backend change — update xero-sync-contacts Edge Function

The existing function pushes ALL records. Add support for a single-record push by accepting optional `record_id` and `record_type` parameters.

**File:** `supabase/functions/xero-sync-contacts/index.ts`

Replace the body parse at the top of the handler with:

```typescript
const body = await req.json() as {
  company_id:   string;
  record_id?:   string;   // if present, push only this record
  record_type?: 'client' | 'contractor'; // required when record_id is set
};
if (!body.company_id) return json({ error: 'Missing company_id' }, 400);
if (body.record_id && !body.record_type) return json({ error: 'record_type required when record_id is set' }, 400);
```

Then after the auth check, add a branch:

```typescript
// ── Single-record push ─────────────────────────────────────────────────────
if (body.record_id && body.record_type) {
  const token = await getValidXeroToken(admin, body.company_id);
  if (!token) return json({ error: 'Xero not connected' }, 400);

  if (body.record_type === 'client') {
    const { data: c } = await admin
      .from('clients')
      .select('id, name, email, phone, address')
      .eq('id', body.record_id)
      .eq('company_id', body.company_id)
      .maybeSingle();
    if (!c) return json({ error: 'Client not found' }, 404);

    const { data: link } = await admin
      .from('xero_contact_links')
      .select('xero_contact_id')
      .eq('company_id', body.company_id)
      .eq('record_type', 'client')
      .eq('record_id', body.record_id)
      .maybeSingle();

    const payload = {
      ...(link ? { ContactID: link.xero_contact_id } : {}),
      Name:        c.name ?? 'Unknown Client',
      EmailAddress: c.email ?? undefined,
      IsCustomer:  true,
      Phones: c.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] : [],
      Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
    };

    const resp = await fetch(`${XERO_API_BASE}/Contacts`, {
      method: 'POST',
      headers: {
        Authorization:    `Bearer ${token.access_token}`,
        'xero-tenant-id': token.tenant_id,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ Contacts: [payload] }),
    });
    if (!resp.ok) return json({ error: `Xero error ${resp.status}` }, 500);
    const result = await resp.json() as { Contacts: Array<{ ContactID: string; Name: string }> };
    const xc = result.Contacts?.[0];
    if (xc?.ContactID) {
      await admin.from('xero_contact_links').upsert({
        company_id: body.company_id, record_type: 'client', record_id: body.record_id,
        xero_contact_id: xc.ContactID, xero_contact_name: xc.Name,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'company_id,record_type,record_id' });
    }
    return json({ ok: true, xero_contact_id: xc?.ContactID });
  }

  // contractor / supplier
  const { data: c } = await admin
    .from('contractors')
    .select('id, name, email, phone, address, vat_number')
    .eq('id', body.record_id)
    .eq('company_id', body.company_id)
    .maybeSingle();
  if (!c) return json({ error: 'Contractor not found' }, 404);

  const { data: link } = await admin
    .from('xero_contact_links')
    .select('xero_contact_id')
    .eq('company_id', body.company_id)
    .eq('record_type', 'contractor')
    .eq('record_id', body.record_id)
    .maybeSingle();

  const payload = {
    ...(link ? { ContactID: link.xero_contact_id } : {}),
    Name:         c.name ?? 'Unknown Contractor',
    EmailAddress: c.email ?? undefined,
    IsSupplier:   true,
    TaxNumber:    c.vat_number ?? undefined,
    Phones: c.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] : [],
    Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
  };

  const resp = await fetch(`${XERO_API_BASE}/Contacts`, {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${token.access_token}`,
      'xero-tenant-id': token.tenant_id,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({ Contacts: [payload] }),
  });
  if (!resp.ok) return json({ error: `Xero error ${resp.status}` }, 500);
  const result = await resp.json() as { Contacts: Array<{ ContactID: string; Name: string }> };
  const xc = result.Contacts?.[0];
  if (xc?.ContactID) {
    await admin.from('xero_contact_links').upsert({
      company_id: body.company_id, record_type: 'contractor', record_id: body.record_id,
      xero_contact_id: xc.ContactID, xero_contact_name: xc.Name,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'company_id,record_type,record_id' });
  }
  return json({ ok: true, xero_contact_id: xc?.ContactID });
}
// ── end single-record push — fall through to bulk push below ──────────────
```

Then redeploy:
```bash
supabase functions deploy xero-sync-contacts --project-ref vcivtjwreybaxgtdhtou
```

---

## WEB-1 — Contractors page (`/dashboard/contractors/page.tsx`)

### 1. New state at the top of the component

```typescript
const supabase = createClient()  // move outside load() so handlers can use it

// Xero
const [xeroLinked,    setXeroLinked]    = useState<Set<string>>(new Set())
const [xeroConnected, setXeroConnected] = useState(false)
const [xeroPushing,   setXeroPushing]   = useState<string | null>(null) // record id being pushed
const [companyId,     setCompanyId]     = useState<string | null>(null)
const [sessionToken,  setSessionToken]  = useState<string | null>(null)
```

### 2. Load Xero state inside `load()`

After setting `contractors`, add:

```typescript
const cId = member.companyId

// Check if Xero is connected
const { data: xConn } = await supabase
  .from('xero_connections')
  .select('id')
  .eq('company_id', cId)
  .eq('is_active', true)
  .maybeSingle()
setXeroConnected(!!xConn)
setCompanyId(cId)

// Load which contractors are already synced
const { data: links } = await supabase
  .from('xero_contact_links')
  .select('record_id')
  .eq('company_id', cId)
  .eq('record_type', 'contractor')
setXeroLinked(new Set((links ?? []).map(l => l.record_id)))

// Capture session token for Edge Function calls
const { data: { session } } = await supabase.auth.getSession()
setSessionToken(session?.access_token ?? null)
```

### 3. Add `pushToXero` handler

```typescript
async function pushToXero(e: React.MouseEvent, contractorId: string) {
  e.stopPropagation() // don't navigate to detail page
  if (!companyId || !sessionToken || xeroPushing) return
  setXeroPushing(contractorId)
  try {
    const resp = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, record_id: contractorId, record_type: 'contractor' }),
      }
    )
    const data = await resp.json()
    if (data.ok) {
      setXeroLinked(prev => new Set([...prev, contractorId]))
    }
  } finally {
    setXeroPushing(null)
  }
}

async function syncAllToXero() {
  if (!companyId || !sessionToken) return
  setXeroPushing('__all__')
  try {
    await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      }
    )
    await load() // reload to get fresh link state
  } finally {
    setXeroPushing(null)
  }
}
```

### 4. Add "Sync All to Xero" button in the filter toolbar

In the toolbar div (next to the existing `+ Add` button), add — only when Xero is connected:

```tsx
{xeroConnected && (
  <button
    onClick={syncAllToXero}
    disabled={xeroPushing === '__all__'}
    className="h-8 px-3 text-[13px] rounded-lg border border-[#13B5EA] text-[#13B5EA] font-medium hover:bg-[#13B5EA]/10 disabled:opacity-50 transition-colors"
  >
    {xeroPushing === '__all__' ? 'Syncing…' : '⟳ Sync All to Xero'}
  </button>
)}
```

### 5. Add Xero column to the table

In `<thead>`, add after the last `<th>` (Status):

```tsx
{xeroConnected && (
  <th style={{ width: 80 }} className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Xero</th>
)}
```

In each `<tr>` inside the map, add after the last `<td>` (Status):

```tsx
{xeroConnected && (
  <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
    {xeroLinked.has(c.id) ? (
      <span className="text-green-400 text-[18px]" title="Synced to Xero">✓</span>
    ) : (
      <button
        onClick={e => pushToXero(e, c.id)}
        disabled={xeroPushing === c.id}
        className="text-[11px] px-2 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors whitespace-nowrap"
      >
        {xeroPushing === c.id ? '…' : '+ Xero'}
      </button>
    )}
  </td>
)}
```

Also update the `colSpan` values on the loading/empty rows from `10` to `{xeroConnected ? 11 : 10}`.

---

## WEB-2 — Suppliers page (`/dashboard/suppliers/page.tsx`)

Apply the same pattern as WEB-1. Suppliers use `record_type: 'contractor'` (same table, same Edge Function).

Changes are identical — replace "contractor" with "supplier" in display text only. The `record_type` passed to the Edge Function stays `'contractor'`.

The suppliers table currently has these columns: Supplier, Contact, Phone, Email, VAT, Banking, Status.  
Add `Xero` as the last column using the same `xeroConnected && (...)` guard.

---

## WEB-3 — Clients page (`/dashboard/clients/page.tsx`)

Same pattern, but `record_type: 'client'`.

The clients table currently has: Client, Code, Type, Contact, Email, Phone.  
Add `Xero` as the last column.

Load xero links in `load()`:

```typescript
// No resolveCurrentMember on clients page — add it
const member = await resolveCurrentMember(supabase)  
// (clients page currently skips member resolution — add this)

const { data: xConn } = await supabase
  .from('xero_connections')
  .select('id')
  .eq('company_id', member.companyId)
  .eq('is_active', true)
  .maybeSingle()
setXeroConnected(!!xConn)
setCompanyId(member.companyId)

const { data: links } = await supabase
  .from('xero_contact_links')
  .select('record_id')
  .eq('company_id', member.companyId)
  .eq('record_type', 'client')
setXeroLinked(new Set((links ?? []).map(l => l.record_id)))
```

Note: the clients `load()` currently does not call `resolveCurrentMember` and has no company_id filter on the query. Fix both at the same time:
```typescript
// Change the select to:
supabase.from('clients').select('*').eq('company_id', member.companyId).order('name')
```

---

## WEB-4 — Contractor detail page (`/dashboard/contractors/[id]/page.tsx`)

Add Xero status badge near the page header. Load the link on init, show status + button.

Add to state:
```typescript
const [xeroLink,      setXeroLink]      = useState<{ xero_contact_id: string; last_synced_at: string } | null>(null)
const [xeroConnected, setXeroConnected] = useState(false)
const [xeroPushing,   setXeroPushing]   = useState(false)
const [sessionToken,  setSessionToken]  = useState<string | null>(null)
```

Add to `init()` after loading contractor:
```typescript
const { data: xConn } = await supabase
  .from('xero_connections').select('id').eq('company_id', member.companyId).eq('is_active', true).maybeSingle()
setXeroConnected(!!xConn)

const { data: link } = await supabase
  .from('xero_contact_links')
  .select('xero_contact_id, last_synced_at')
  .eq('company_id', member.companyId)
  .eq('record_type', 'contractor')
  .eq('record_id', contractorId)
  .maybeSingle()
setXeroLink(link ?? null)

const { data: { session } } = await supabase.auth.getSession()
setSessionToken(session?.access_token ?? null)
```

Add handler:
```typescript
async function pushToXero() {
  if (!companyId || !sessionToken) return
  setXeroPushing(true)
  try {
    const resp = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, record_id: contractorId, record_type: 'contractor' }),
      }
    )
    const data = await resp.json()
    if (data.ok) {
      setXeroLink({ xero_contact_id: data.xero_contact_id, last_synced_at: new Date().toISOString() })
    }
  } finally {
    setXeroPushing(false)
  }
}
```

Add Xero badge in the page header area (below the contractor name):
```tsx
{xeroConnected && (
  <div className="flex items-center gap-2 mt-1">
    {xeroLink ? (
      <>
        <span className="inline-flex items-center gap-1 text-[12px] text-green-400">
          <span className="text-[14px]">✓</span> Synced to Xero
        </span>
        <span className="text-text-disabled text-[11px]">
          {new Date(xeroLink.last_synced_at).toLocaleDateString()}
        </span>
        <button
          onClick={pushToXero}
          disabled={xeroPushing}
          className="text-[11px] text-[#13B5EA] hover:opacity-70 disabled:opacity-40"
        >
          Update in Xero
        </button>
      </>
    ) : (
      <button
        onClick={pushToXero}
        disabled={xeroPushing}
        className="inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors"
      >
        {xeroPushing ? 'Pushing…' : '+ Push to Xero'}
      </button>
    )}
  </div>
)}
```

Apply the same WEB-4 pattern to the **client detail page** (`/dashboard/clients/[id]/page.tsx`) using `record_type: 'client'`.

---

## Deploy order

1. Update `xero-sync-contacts` Edge Function with single-record support
2. Redeploy: `supabase functions deploy xero-sync-contacts --project-ref vcivtjwreybaxgtdhtou`
3. Apply WEB-1 (contractors page)
4. Apply WEB-2 (suppliers page)
5. Apply WEB-3 (clients page)
6. Apply WEB-4 (contractor + client detail pages)

---

## Rules

- The Xero column and buttons must only render when `xeroConnected === true` — if the company hasn't connected Xero, nothing should change visually
- `e.stopPropagation()` on every Xero button click in the table — the row is clickable and must not navigate when the Xero button is clicked
- `record_type` for both contractors AND suppliers is `'contractor'` — they share the same DB table
- Do not use `apply_migration`
