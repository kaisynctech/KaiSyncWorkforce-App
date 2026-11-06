import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const TOKEN_URL = 'https://identity.xero.com/connect/token'

function tokenScopes(accessToken: string): string {
  try {
    const p = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return Array.isArray(p.scope) ? p.scope.join(' ') : String(p.scope ?? '')
  } catch { return '' }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const webUrl = Deno.env.get('KAISYNC_WEB_URL') ?? 'https://www.kaisyncworkforce.com'
  const errRedir = `${webUrl}/dashboard/settings?tab=integrations&xero=error`
  const okRedir = `${webUrl}/dashboard/settings?tab=integrations&xero=connected`
  if (!code || !state) return Response.redirect(errRedir, 302)

  try {
    const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: stateRow } = await adminSb.from('xero_oauth_states').select('*').eq('state', state)
      .gt('expires_at', new Date().toISOString()).maybeSingle()
    if (!stateRow) return Response.redirect(errRedir, 302)
    await adminSb.from('xero_oauth_states').delete().eq('state', state)

    const clientId = Deno.env.get('XERO_CLIENT_ID')!
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: Deno.env.get('XERO_REDIRECT_URI')! }),
    })
    if (!tokenRes.ok) return Response.redirect(errRedir, 302)
    const tokens = await tokenRes.json()
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const tenantsRes = await fetch('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } })
    const tenants = await tenantsRes.json().catch(() => [])
    // Prefer the organisation this company was connected to before (reconnecting must not switch books).
    const { data: prev } = await adminSb.from('xero_connections').select('tenant_id').eq('company_id', stateRow.company_id).maybeSingle()
    const list = Array.isArray(tenants) ? tenants.filter((t: { tenantType?: string }) => !t.tenantType || t.tenantType === 'ORGANISATION') : []
    const tenant = list.find((t: { tenantId: string }) => t.tenantId === prev?.tenant_id) ?? list[0]
    if (!tenant) return Response.redirect(errRedir, 302)

    await adminSb.from('xero_connections').upsert({
      company_id: stateRow.company_id, tenant_id: tenant.tenantId, tenant_name: tenant.tenantName,
      access_token: tokens.access_token, refresh_token: tokens.refresh_token,
      expires_at: expiresAt, token_expires_at: expiresAt, scopes: tokenScopes(tokens.access_token),
      is_active: true, last_error: null, last_error_at: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })

    return Response.redirect(okRedir, 302)
  } catch (e) {
    console.error('xero-oauth-callback error:', e)
    return Response.redirect(errRedir, 302)
  }
})
