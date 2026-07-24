# MISSION BRIEF — XERO INTEGRATION
**Spec:** XERO-001  
**Status:** READY TO IMPLEMENT  
**Date:** 2026-07-24  
**Engineer:** Apply in order. DB first, then Edge Functions, then Settings UI.

---

## Context

KaiFlow needs to integrate with Xero to:
1. **OAuth connect** a company's Xero organisation
2. **Contacts sync** — push KaiFlow Clients (Customers) and Contractors (Suppliers) to Xero; pull Xero contacts back into KaiFlow
3. **Payroll push** — push approved payslips to Xero as Draft Manual Journals for the accountant to review and post

The Xero developer app **KaiSync** is already registered at developer.xero.com.  
Client ID: `6C28683A08C94332BDC5719B071A1F2D`  
Callback URL already set to: `https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/xero-oauth-callback`

---

## STEP 0 — Set Supabase Secrets

Run in terminal (Supabase CLI required):

```bash
supabase secrets set \
  XERO_CLIENT_ID=6C28683A08C94332BDC5719B071A1F2D \
  XERO_CLIENT_SECRET=xzl5zQ8zaTlJrwfkJXGy6ovkprhdCtMo4dbDneleZIUgHOWk \
  XERO_REDIRECT_URI=https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/xero-oauth-callback \
  KAISYNC_WEB_URL=https://www.kaisyncworkforce.com \
  --project-ref vcivtjwreybaxgtdhtou
```

Verify they were set:
```bash
supabase secrets list --project-ref vcivtjwreybaxgtdhtou
```

---

## STEP 1 — Create DB tables

Save the SQL below to a file (e.g. `xero_tables.sql`) and run:

```bash
supabase db execute --project-ref vcivtjwreybaxgtdhtou < xero_tables.sql
```

**`xero_tables.sql`:**

```sql
-- DB-1: xero_oauth_states
-- Stores the anti-CSRF state token for the OAuth flow (expires in 15 min, used once).
CREATE TABLE IF NOT EXISTS public.xero_oauth_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  hr_user_id      uuid NOT NULL,
  state_token     text NOT NULL UNIQUE,
  redirect_to     text,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xero_oauth_states_token ON public.xero_oauth_states (state_token);
ALTER TABLE public.xero_oauth_states ENABLE ROW LEVEL SECURITY;
-- Service role only — Edge Functions use service role key

-- DB-2: xero_connections
-- One row per company. Stores tokens and tenant info.
CREATE TABLE IF NOT EXISTS public.xero_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  tenant_id            text NOT NULL,
  tenant_name          text,
  access_token         text NOT NULL,
  refresh_token        text NOT NULL,
  token_expires_at     timestamptz NOT NULL,
  connected_at         timestamptz NOT NULL DEFAULT now(),
  connected_by_user_id uuid,
  is_active            boolean NOT NULL DEFAULT true,
  -- Xero chart of accounts codes — update these in Supabase if your chart differs
  wages_expense_code   text DEFAULT '477',
  wages_payable_code   text DEFAULT '814',
  paye_payable_code    text DEFAULT '825'
);

ALTER TABLE public.xero_connections ENABLE ROW LEVEL SECURITY;
-- Service role only

-- DB-3: xero_contact_links
-- Maps each KaiFlow client/contractor to its Xero ContactID.
CREATE TABLE IF NOT EXISTS public.xero_contact_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  record_type       text NOT NULL CHECK (record_type IN ('client', 'contractor')),
  record_id         uuid NOT NULL,
  xero_contact_id   text NOT NULL,
  xero_contact_name text,
  last_synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_contact_links_company ON public.xero_contact_links (company_id, record_type);
ALTER TABLE public.xero_contact_links ENABLE ROW LEVEL SECURITY;
-- Service role only

-- DB-4: xero_journal_links
-- Tracks which payslips have been pushed to Xero.
CREATE TABLE IF NOT EXISTS public.xero_journal_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_approval_id   uuid NOT NULL REFERENCES public.payment_approvals(id) ON DELETE CASCADE,
  xero_journal_id       text NOT NULL,
  xero_journal_status   text,  -- 'DRAFT' | 'POSTED'
  pushed_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_approval_id)
);

ALTER TABLE public.xero_journal_links ENABLE ROW LEVEL SECURITY;
-- Service role only
```

---

## Edge Function code

Create all files below, then deploy using the commands in STEP 3.

### Shared utility — `supabase/functions/_shared/xero-utils.ts`

All four Edge Functions import from this file — create it first.

**File:** `supabase/functions/_shared/xero-utils.ts`

```typescript
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const XERO_API_BASE   = 'https://api.xero.com/api.xro/2.0';
export const XERO_TOKEN_URL  = 'https://identity.xero.com/connect/token';
export const XERO_CONNS_URL  = 'https://api.xero.com/connections';

export interface XeroToken {
  access_token: string;
  tenant_id:    string;
}

/**
 * Returns a valid (non-expired) access token for the given company.
 * Refreshes automatically if the token expires within 5 minutes.
 * Returns null if no connection exists or refresh fails.
 */
export async function getValidXeroToken(
  admin: SupabaseClient,
  companyId: string,
): Promise<XeroToken | null> {
  const { data: conn } = await admin
    .from('xero_connections')
    .select('access_token, refresh_token, token_expires_at, tenant_id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) return null;

  const expiresAt = new Date(conn.token_expires_at).getTime();
  const fiveMin   = 5 * 60 * 1000;

  if (Date.now() + fiveMin < expiresAt) {
    // Token still valid
    return { access_token: conn.access_token, tenant_id: conn.tenant_id };
  }

  // Refresh
  const clientId     = Deno.env.get('XERO_CLIENT_ID')!;
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!;

  const resp = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:  'Basic ' + btoa(`${clientId}:${clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: conn.refresh_token,
    }),
  });

  if (!resp.ok) return null;

  const tokens = await resp.json() as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
  };

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await admin
    .from('xero_connections')
    .update({
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token ?? conn.refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq('company_id', companyId)
    .eq('is_active', true);

  return { access_token: tokens.access_token, tenant_id: conn.tenant_id };
}

/** Standard CORS headers */
export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
```

---

## EF-1 — xero-oauth-start

**File:** `supabase/functions/xero-oauth-start/index.ts`  
**verify_jwt:** `true` (HR users only)

```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS, json } from '../_shared/xero-utils.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401);

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const clientId     = Deno.env.get('XERO_CLIENT_ID')!;
    const redirectUri  = Deno.env.get('XERO_REDIRECT_URI')!;

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Invalid session' }, 401);

    const body = await req.json() as { company_id: string; redirect_to?: string };
    if (!body.company_id) return json({ error: 'Missing company_id' }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Confirm user is an active HR member of this company
    const { data: hr } = await admin
      .from('hr_users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .eq('company_id', body.company_id)
      .eq('is_active', true)
      .maybeSingle();
    if (!hr) return json({ error: 'Not authorized for this company' }, 403);

    // Store state token
    const state = crypto.randomUUID().replaceAll('-', '');
    await admin.from('xero_oauth_states').insert({
      company_id:  body.company_id,
      hr_user_id:  user.id,
      state_token: state,
      redirect_to: body.redirect_to ?? null,
      expires_at:  new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    // Build Xero auth URL
    const authUrl = new URL('https://login.xero.com/identity/connect/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id',     clientId);
    authUrl.searchParams.set('redirect_uri',  redirectUri);
    authUrl.searchParams.set('scope',
      'accounting.contacts accounting.transactions offline_access openid profile email');
    authUrl.searchParams.set('state', state);

    return json({ ok: true, auth_url: authUrl.toString() });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
```

---

## EF-2 — xero-oauth-callback

**File:** `supabase/functions/xero-oauth-callback/index.ts`  
**verify_jwt:** `false` (Xero calls this directly in the browser — no Authorization header)

```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { XERO_TOKEN_URL, XERO_CONNS_URL } from '../_shared/xero-utils.ts';

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req: Request) => {
  const webUrl    = Deno.env.get('KAISYNC_WEB_URL') ?? 'https://www.kaisyncworkforce.com';
  const errUrl    = `${webUrl}/dashboard/settings?xero=error`;
  const successUrl = `${webUrl}/dashboard/settings?xero=connected`;

  try {
    const url   = new URL(req.url);
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) return redirect(errUrl);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const clientId    = Deno.env.get('XERO_CLIENT_ID')!;
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!;
    const redirectUri  = Deno.env.get('XERO_REDIRECT_URI')!;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Validate and consume state token
    const { data: stateRow } = await admin
      .from('xero_oauth_states')
      .select('*')
      .eq('state_token', state)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!stateRow) return redirect(errUrl + '&reason=invalid_state');

    // Mark state as used immediately (replay protection)
    await admin
      .from('xero_oauth_states')
      .update({ used_at: new Date().toISOString() })
      .eq('id', stateRow.id);

    // Exchange code for tokens
    const tokenResp = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization:  'Basic ' + btoa(`${clientId}:${clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResp.ok) return redirect(errUrl + '&reason=token_exchange');

    const tokens = await tokenResp.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
    };

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Get tenant (organisation) list — take the first one
    const connsResp = await fetch(XERO_CONNS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!connsResp.ok) return redirect(errUrl + '&reason=tenant_lookup');

    const connections = await connsResp.json() as Array<{
      tenantId:   string;
      tenantName: string;
      tenantType: string;
    }>;

    const org = connections.find(c => c.tenantType === 'ORGANISATION') ?? connections[0];
    if (!org) return redirect(errUrl + '&reason=no_organisation');

    // Upsert connection record
    await admin.from('xero_connections').upsert({
      company_id:           stateRow.company_id,
      tenant_id:            org.tenantId,
      tenant_name:          org.tenantName,
      access_token:         tokens.access_token,
      refresh_token:        tokens.refresh_token,
      token_expires_at:     tokenExpiresAt,
      connected_at:         new Date().toISOString(),
      connected_by_user_id: stateRow.hr_user_id,
      is_active:            true,
    }, { onConflict: 'company_id' });

    return redirect(stateRow.redirect_to ?? successUrl);
  } catch (err) {
    console.error('xero-oauth-callback error:', err);
    return redirect(errUrl + '&reason=unexpected');
  }
});
```

---

## EF-3 — xero-sync-contacts

**File:** `supabase/functions/xero-sync-contacts/index.ts`  
**verify_jwt:** `true`

Pushes KaiFlow clients (IsCustomer: true) and contractors (IsSupplier: true) to Xero.  
Stores the Xero ContactID in `xero_contact_links`.  
Also creates/updates — does NOT delete (Xero contacts are never deleted via API, only archived).

```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { XERO_API_BASE, CORS, json, getValidXeroToken } from '../_shared/xero-utils.ts';

type XeroContact = {
  ContactID?: string;
  Name:        string;
  EmailAddress?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  TaxNumber?:  string;
  Phones?: Array<{ PhoneType: string; PhoneNumber: string }>;
  Addresses?: Array<{ AddressType: string; AddressLine1?: string }>;
};

async function upsertXeroContacts(
  accessToken: string,
  tenantId:    string,
  contacts:    XeroContact[],
): Promise<XeroContact[]> {
  const resp = await fetch(`${XERO_API_BASE}/Contacts`, {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({ Contacts: contacts }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Xero contacts API error ${resp.status}: ${text}`);
  }
  const data = await resp.json() as { Contacts: XeroContact[] };
  return data.Contacts;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Invalid session' }, 401);

    const body = await req.json() as { company_id: string };
    if (!body.company_id) return json({ error: 'Missing company_id' }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Auth check
    const { data: hr } = await admin
      .from('hr_users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .eq('company_id', body.company_id)
      .eq('is_active', true)
      .maybeSingle();
    if (!hr) return json({ error: 'Not authorized' }, 403);

    // Get valid Xero token
    const token = await getValidXeroToken(admin, body.company_id);
    if (!token) return json({ error: 'Xero not connected. Please connect Xero first.' }, 400);

    const companyId = body.company_id;

    // ── Push Clients (Customers) ───────────────────────────────────────────────
    const { data: clients } = await admin
      .from('clients')
      .select('id, name, email, phone, address')
      .eq('company_id', companyId);

    const { data: clientLinks } = await admin
      .from('xero_contact_links')
      .select('record_id, xero_contact_id')
      .eq('company_id', companyId)
      .eq('record_type', 'client');

    const clientLinkMap = new Map((clientLinks ?? []).map(l => [l.record_id, l.xero_contact_id]));

    const clientXeroPayloads: XeroContact[] = (clients ?? []).map(c => ({
      ...(clientLinkMap.has(c.id) ? { ContactID: clientLinkMap.get(c.id) } : {}),
      Name:        c.name ?? 'Unknown Client',
      EmailAddress: c.email ?? undefined,
      IsCustomer:  true,
      Phones: c.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] : [],
      Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
    }));

    let clientsPushed = 0;
    if (clientXeroPayloads.length > 0) {
      // Xero accepts max 100 contacts per call — chunk if needed
      for (let i = 0; i < clientXeroPayloads.length; i += 100) {
        const chunk = clientXeroPayloads.slice(i, i + 100);
        const originalChunk = (clients ?? []).slice(i, i + 100);
        const created = await upsertXeroContacts(token.access_token, token.tenant_id, chunk);

        // Upsert links
        const linkRows = created
          .filter(xc => xc.ContactID)
          .map((xc, idx) => ({
            company_id:        companyId,
            record_type:       'client' as const,
            record_id:         originalChunk[idx].id,
            xero_contact_id:   xc.ContactID!,
            xero_contact_name: xc.Name,
            last_synced_at:    new Date().toISOString(),
          }));

        if (linkRows.length > 0) {
          await admin
            .from('xero_contact_links')
            .upsert(linkRows, { onConflict: 'company_id,record_type,record_id' });
        }
        clientsPushed += created.length;
      }
    }

    // ── Push Contractors (Suppliers) ───────────────────────────────────────────
    const { data: contractors } = await admin
      .from('contractors')
      .select('id, name, email, phone, address, vat_number, registration_number')
      .eq('company_id', companyId)
      .eq('is_active', true);

    const { data: contractorLinks } = await admin
      .from('xero_contact_links')
      .select('record_id, xero_contact_id')
      .eq('company_id', companyId)
      .eq('record_type', 'contractor');

    const contractorLinkMap = new Map((contractorLinks ?? []).map(l => [l.record_id, l.xero_contact_id]));

    const contractorXeroPayloads: XeroContact[] = (contractors ?? []).map(c => ({
      ...(contractorLinkMap.has(c.id) ? { ContactID: contractorLinkMap.get(c.id) } : {}),
      Name:         c.name ?? 'Unknown Contractor',
      EmailAddress: c.email ?? undefined,
      IsSupplier:   true,
      TaxNumber:    c.vat_number ?? undefined,
      Phones: c.phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] : [],
      Addresses: c.address ? [{ AddressType: 'STREET', AddressLine1: c.address }] : [],
    }));

    let contractorsPushed = 0;
    if (contractorXeroPayloads.length > 0) {
      for (let i = 0; i < contractorXeroPayloads.length; i += 100) {
        const chunk = contractorXeroPayloads.slice(i, i + 100);
        const originalChunk = (contractors ?? []).slice(i, i + 100);
        const created = await upsertXeroContacts(token.access_token, token.tenant_id, chunk);

        const linkRows = created
          .filter(xc => xc.ContactID)
          .map((xc, idx) => ({
            company_id:        companyId,
            record_type:       'contractor' as const,
            record_id:         originalChunk[idx].id,
            xero_contact_id:   xc.ContactID!,
            xero_contact_name: xc.Name,
            last_synced_at:    new Date().toISOString(),
          }));

        if (linkRows.length > 0) {
          await admin
            .from('xero_contact_links')
            .upsert(linkRows, { onConflict: 'company_id,record_type,record_id' });
        }
        contractorsPushed += created.length;
      }
    }

    return json({
      ok: true,
      clients_pushed:     clientsPushed,
      contractors_pushed: contractorsPushed,
    });
  } catch (err) {
    console.error('xero-sync-contacts error:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
```

---

## EF-4 — xero-push-payroll

**File:** `supabase/functions/xero-push-payroll/index.ts`  
**verify_jwt:** `true`

Takes a period range, finds all `approved` payment_approvals for the company in that period (excluding already-pushed ones), creates one Draft Manual Journal per payslip in Xero.

Uses account codes stored in `xero_connections` (defaults: wages expense `477`, wages payable `814`). HR can update these codes later in Settings.

```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { XERO_API_BASE, CORS, json, getValidXeroToken } from '../_shared/xero-utils.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Invalid session' }, 401);

    const body = await req.json() as {
      company_id:   string;
      period_start: string;  // YYYY-MM-DD
      period_end:   string;  // YYYY-MM-DD
    };
    if (!body.company_id || !body.period_start || !body.period_end) {
      return json({ error: 'Missing company_id, period_start, or period_end' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Auth check
    const { data: hr } = await admin
      .from('hr_users')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .eq('company_id', body.company_id)
      .eq('is_active', true)
      .maybeSingle();
    if (!hr) return json({ error: 'Not authorized' }, 403);

    // Get valid Xero token + account codes
    const token = await getValidXeroToken(admin, body.company_id);
    if (!token) return json({ error: 'Xero not connected. Please connect Xero first.' }, 400);

    const { data: xeroConn } = await admin
      .from('xero_connections')
      .select('wages_expense_code, wages_payable_code, paye_payable_code')
      .eq('company_id', body.company_id)
      .maybeSingle();

    const wagesExpenseCode  = xeroConn?.wages_expense_code  ?? '477';
    const wagesPayableCode  = xeroConn?.wages_payable_code  ?? '814';

    // Fetch approved payslips in period, excluding already-pushed ones
    const { data: alreadyPushed } = await admin
      .from('xero_journal_links')
      .select('payment_approval_id')
      .eq('company_id', body.company_id);

    const pushedIds = new Set((alreadyPushed ?? []).map(r => r.payment_approval_id));

    const { data: payslips, error: psError } = await admin
      .from('payment_approvals')
      .select(`
        id, employee_id, period_start, period_end,
        gross_pay, deductions, net_pay,
        employees!inner(name, surname)
      `)
      .eq('company_id', body.company_id)
      .eq('status', 'approved')
      .gte('period_start', body.period_start)
      .lte('period_end', body.period_end);

    if (psError) return json({ error: psError.message }, 500);

    const unpushed = (payslips ?? []).filter(p => !pushedIds.has(p.id));
    if (unpushed.length === 0) {
      return json({ ok: true, pushed: 0, message: 'No new approved payslips to push for this period.' });
    }

    // Build and push one Manual Journal per payslip
    const journalLinks: Array<{ payment_approval_id: string; xero_journal_id: string; xero_journal_status: string; company_id: string }> = [];

    for (const ps of unpushed) {
      const emp = (ps as any).employees;
      const empName = emp ? `${emp.name} ${emp.surname}` : ps.employee_id;
      const grossPay = Number(ps.gross_pay ?? 0);
      const netPay   = Number(ps.net_pay ?? 0);
      const deductions = Number(ps.deductions ?? 0);

      const narration = `Payroll: ${empName} | ${ps.period_start} to ${ps.period_end}`;

      const journal = {
        Date:        ps.period_end,
        Narration:   narration,
        Status:      'DRAFT',
        JournalLines: [
          // Debit Wages Expense (gross pay)
          {
            AccountCode: wagesExpenseCode,
            Description: `Gross pay — ${empName}`,
            LineAmount:  grossPay,
          },
          // Credit Wages Payable (net pay)
          {
            AccountCode: wagesPayableCode,
            Description: `Net pay — ${empName}`,
            LineAmount:  -netPay,
          },
          // Credit PAYE/Deductions Payable (deductions)
          ...(deductions > 0 ? [{
            AccountCode: xeroConn?.paye_payable_code ?? '825',
            Description: `Deductions — ${empName}`,
            LineAmount:  -deductions,
          }] : []),
        ],
      };

      const resp = await fetch(`${XERO_API_BASE}/ManualJournals`, {
        method: 'POST',
        headers: {
          Authorization:    `Bearer ${token.access_token}`,
          'xero-tenant-id': token.tenant_id,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ ManualJournals: [journal] }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`Xero ManualJournal error for ${ps.id}:`, text);
        continue; // Skip this one, push the rest
      }

      const result = await resp.json() as { ManualJournals: Array<{ ManualJournalID: string; Status: string }> };
      const created = result.ManualJournals?.[0];

      if (created?.ManualJournalID) {
        journalLinks.push({
          company_id:           body.company_id,
          payment_approval_id:  ps.id,
          xero_journal_id:      created.ManualJournalID,
          xero_journal_status:  created.Status,
        });
      }
    }

    if (journalLinks.length > 0) {
      await admin.from('xero_journal_links').insert(journalLinks);
    }

    return json({
      ok:     true,
      pushed: journalLinks.length,
      skipped: unpushed.length - journalLinks.length,
      total:  unpushed.length,
    });
  } catch (err) {
    console.error('xero-push-payroll error:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
```

---

## WEB-1 — Settings page Xero section

**File:** `kaisync-web/src/app/dashboard/settings/page.tsx`

Add the following at the **top of the file** with the other state declarations, and a new `useEffect` / `loadXero()` function inside the component, plus a UI section near the bottom of the page render.

### 1. Add state variables (inside `SettingsPage` component, with the other `useState` declarations)

```typescript
// ── Xero state ──────────────────────────────────────────────────────────────
const [xeroConn,       setXeroConn]       = useState<{
  tenant_name:        string;
  connected_at:       string;
  wages_expense_code: string;
  wages_payable_code: string;
  paye_payable_code:  string;
} | null>(null)
const [xeroConnected,  setXeroConnected]  = useState(false)
const [xeroConnecting, setXeroConnecting] = useState(false)
const [xeroSyncing,    setXeroSyncing]    = useState(false)
const [xeroPushing,    setXeroPushing]    = useState(false)
const [xeroMsg,        setXeroMsg]        = useState<string | null>(null)
const [payrollPeriodStart, setPayrollPeriodStart] = useState('')
const [payrollPeriodEnd,   setPayrollPeriodEnd]   = useState('')
```

### 2. Add `loadXero()` inside the component and call it from `load()`

```typescript
async function loadXero(cId: string) {
  const { data } = await supabase
    .from('xero_connections')
    .select('tenant_name, connected_at, wages_expense_code, wages_payable_code, paye_payable_code')
    .eq('company_id', cId)
    .eq('is_active', true)
    .maybeSingle()
  if (data) {
    setXeroConn(data)
    setXeroConnected(true)
  }
}
```

Call it inside `load()` after you have `cId`:
```typescript
await loadXero(cId)
```

Also check `useEffect` on mount — after the URL param check add:
```typescript
// Check for Xero OAuth result in URL
const params = new URLSearchParams(window.location.search)
const xeroStatus = params.get('xero')
if (xeroStatus === 'connected') setXeroMsg('Xero connected successfully!')
if (xeroStatus === 'error')     setXeroMsg('Xero connection failed. Please try again.')
```

### 3. Add handler functions inside the component

```typescript
async function connectXero() {
  if (!companyId) return
  setXeroConnecting(true)
  setXeroMsg(null)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setXeroMsg('Not authenticated'); return }

    const resp = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-oauth-start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      }
    )
    const data = await resp.json()
    if (data.auth_url) {
      window.location.href = data.auth_url
    } else {
      setXeroMsg(data.error ?? 'Failed to start Xero connection')
    }
  } catch (e) {
    setXeroMsg('Unexpected error')
  } finally {
    setXeroConnecting(false)
  }
}

async function syncXeroContacts() {
  if (!companyId) return
  setXeroSyncing(true)
  setXeroMsg(null)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      }
    )
    const data = await resp.json()
    if (data.ok) {
      setXeroMsg(`Synced ${data.clients_pushed} clients and ${data.contractors_pushed} contractors to Xero.`)
    } else {
      setXeroMsg(data.error ?? 'Sync failed')
    }
  } catch (e) {
    setXeroMsg('Unexpected error during sync')
  } finally {
    setXeroSyncing(false)
  }
}

async function pushPayroll() {
  if (!companyId || !payrollPeriodStart || !payrollPeriodEnd) return
  setXeroPushing(true)
  setXeroMsg(null)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-push-payroll`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id:   companyId,
          period_start: payrollPeriodStart,
          period_end:   payrollPeriodEnd,
        }),
      }
    )
    const data = await resp.json()
    if (data.ok) {
      setXeroMsg(data.message ?? `Pushed ${data.pushed} payslips to Xero as Draft Manual Journals.`)
    } else {
      setXeroMsg(data.error ?? 'Payroll push failed')
    }
  } catch (e) {
    setXeroMsg('Unexpected error during payroll push')
  } finally {
    setXeroPushing(false)
  }
}
```

### 4. Add the UI section (insert before the closing `</div>` of the page)

```tsx
{/* ── Xero Integration ─────────────────────────────────────────── */}
<section className="bg-[#1e293b] rounded-xl p-6 space-y-4">
  <h2 className="text-lg font-semibold text-white">Xero Integration</h2>

  {xeroMsg && (
    <p className={`text-sm px-3 py-2 rounded ${
      xeroMsg.includes('success') || xeroMsg.includes('Synced') || xeroMsg.includes('Pushed')
        ? 'bg-green-900/40 text-green-300'
        : 'bg-red-900/40 text-red-300'
    }`}>{xeroMsg}</p>
  )}

  {!xeroConnected ? (
    <div className="space-y-2">
      <p className="text-sm text-slate-400">
        Connect KaiFlow to your Xero organisation to sync contacts and push payroll.
      </p>
      <button
        onClick={connectXero}
        disabled={xeroConnecting}
        className="px-4 py-2 rounded-lg bg-[#13B5EA] text-white text-sm font-medium hover:bg-[#0ea3d5] disabled:opacity-50"
      >
        {xeroConnecting ? 'Redirecting to Xero…' : 'Connect to Xero'}
      </button>
    </div>
  ) : (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-green-400">
        <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
        Connected to <strong>{xeroConn?.tenant_name ?? 'Xero'}</strong>
        {xeroConn?.connected_at && (
          <span className="text-slate-500 ml-1">since {formatDateTime(xeroConn.connected_at)}</span>
        )}
      </div>

      {/* Contacts Sync */}
      <div className="border border-slate-700 rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-medium text-white">Contacts Sync</h3>
        <p className="text-xs text-slate-400">
          Pushes all Clients (Customers) and active Contractors (Suppliers) to Xero.
          Existing Xero contacts are updated; new ones are created.
        </p>
        <button
          onClick={syncXeroContacts}
          disabled={xeroSyncing}
          className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm hover:bg-slate-600 disabled:opacity-50"
        >
          {xeroSyncing ? 'Syncing…' : 'Sync Contacts to Xero'}
        </button>
      </div>

      {/* Payroll Push */}
      <div className="border border-slate-700 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-white">Payroll Push</h3>
        <p className="text-xs text-slate-400">
          Pushes approved payslips to Xero as Draft Manual Journals.
          Your accountant reviews and posts them in Xero.
        </p>
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Period start</label>
            <input
              type="date"
              value={payrollPeriodStart}
              onChange={e => setPayrollPeriodStart(e.target.value)}
              className="bg-slate-800 text-white text-sm rounded px-3 py-1.5 border border-slate-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Period end</label>
            <input
              type="date"
              value={payrollPeriodEnd}
              onChange={e => setPayrollPeriodEnd(e.target.value)}
              className="bg-slate-800 text-white text-sm rounded px-3 py-1.5 border border-slate-600"
            />
          </div>
        </div>
        <button
          onClick={pushPayroll}
          disabled={xeroPushing || !payrollPeriodStart || !payrollPeriodEnd}
          className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm hover:bg-slate-600 disabled:opacity-50"
        >
          {xeroPushing ? 'Pushing…' : 'Push Payroll to Xero'}
        </button>
        <p className="text-xs text-slate-500">
          Account codes used — Wages Expense: {xeroConn?.wages_expense_code ?? '477'} ·
          Wages Payable: {xeroConn?.wages_payable_code ?? '814'} ·
          PAYE Payable: {xeroConn?.paye_payable_code ?? '825'}.
          Update in Supabase if your chart of accounts differs.
        </p>
      </div>

      {/* Reconnect */}
      <button
        onClick={connectXero}
        disabled={xeroConnecting}
        className="text-xs text-slate-500 hover:text-slate-300 underline"
      >
        Reconnect Xero
      </button>
    </div>
  )}
</section>
```

---

## STEP 2 — Create Edge Function files

Create these files in the repo exactly as shown above:

```
supabase/functions/_shared/xero-utils.ts          ← shared token helper
supabase/functions/xero-oauth-start/index.ts
supabase/functions/xero-oauth-callback/index.ts
supabase/functions/xero-sync-contacts/index.ts
supabase/functions/xero-push-payroll/index.ts
```

## STEP 3 — Deploy Edge Functions

```bash
supabase functions deploy xero-oauth-start    --project-ref vcivtjwreybaxgtdhtou
supabase functions deploy xero-oauth-callback --project-ref vcivtjwreybaxgtdhtou --no-verify-jwt
supabase functions deploy xero-sync-contacts  --project-ref vcivtjwreybaxgtdhtou
supabase functions deploy xero-push-payroll   --project-ref vcivtjwreybaxgtdhtou
```

`xero-oauth-callback` uses `--no-verify-jwt` because Xero calls it directly in the browser — no Supabase JWT is present.

## STEP 4 — Apply Settings UI changes

Edit `kaisync-web/src/app/dashboard/settings/page.tsx` as described in WEB-1 above.

---

## Verification checklist

After deploy, test this flow manually:

1. Open Settings page → confirm "Connect to Xero" button appears
2. Click it → confirm redirect to Xero login page
3. Authorise → confirm redirect back to `/dashboard/settings?xero=connected`
4. Confirm "Connected to KaiSync" shows with green dot
5. Click "Sync Contacts to Xero" → open Xero Contacts → confirm clients appear as Customers, contractors as Suppliers
6. Set period dates → click "Push Payroll" → open Xero Accounting → Manual Journals → confirm Draft entries appear with correct gross/net amounts
7. Check `xero_connections`, `xero_contact_links`, `xero_journal_links` tables in Supabase → confirm rows exist

---

## Notes

- Xero access tokens expire after **30 minutes**. The `getValidXeroToken` helper refreshes automatically.
- Xero refresh tokens expire after **60 days** of inactivity. If expired, HR must reconnect.
- The Xero free trial allows up to 5 connected organisations. Upgrade to a paid Xero plan when onboarding real clients.
- Payroll account codes `477`, `814`, `825` are Xero default codes. Adjust to match your actual chart of accounts.
- Contacts are **never deleted** from Xero via API — only archived. Deactivating a KaiFlow contractor does not remove them from Xero.
