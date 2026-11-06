import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Starts "Connect Xero". Asks for contacts, settings (accounts and VAT rates), invoices (incl. bills, credit notes,
// purchase orders), payments and manual journals (payroll). Granular scopes: valid for every Xero app.
// The old screens ask for the old set; the new Settings sends { full: true }.
const OLD_SCOPES = 'accounting.contacts accounting.manualjournals offline_access openid profile email'
const XERO_SCOPES = 'openid profile email offline_access accounting.contacts accounting.settings accounting.invoices accounting.payments accounting.manualjournals'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const company_id: string | undefined = (body as { company_id?: string }).company_id
    const full = (body as { full?: boolean }).full === true
    if (!company_id) return json({ error: 'company_id required' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const userSb = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userSb.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const adminSb = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: emp } = await adminSb.from('employees').select('id').eq('user_id', user.id).eq('company_id', company_id).eq('is_active', true).maybeSingle()
    if (!emp) return json({ error: 'Forbidden' }, 403)

    const state = crypto.randomUUID()
    await adminSb.from('xero_oauth_states').insert({ state, company_id, employee_id: emp.id })

    const authUrl = 'https://login.xero.com/identity/connect/authorize?' + new URLSearchParams({
      response_type: 'code', client_id: Deno.env.get('XERO_CLIENT_ID')!, redirect_uri: Deno.env.get('XERO_REDIRECT_URI')!,
      scope: full ? XERO_SCOPES : OLD_SCOPES, state,
    })
    return json({ auth_url: authUrl })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
