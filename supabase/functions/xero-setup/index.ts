import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { type Admin, getValidXeroToken, xero } from '../_shared/xero.ts'

/**
 * "Set up from Xero": reads the connected Xero organisation and suggests everything the sync needs — the sales,
 * purchases and bank accounts, and checks that VAT 15% and every client/supplier currency are switched on in Xero.
 * Read-only: Settings shows the result, and the owner presses "Finish setup" to save it and match contacts.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...cors } })

type Acc = { AccountID: string; Code?: string; Name: string; Type: string; Class: string; Status: string }

const pick = (list: Acc[], tests: Array<(a: Acc) => boolean>) => {
  for (const t of tests) { const a = list.find(t); if (a) return a }
  return null
}
const val = (a: Acc | null) => (a ? a.Code || a.AccountID : null)
const label = (a: Acc | null) => (a ? `${a.Code ? `${a.Code} · ` : ''}${a.Name}` : null)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing Authorization' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Invalid session' }, 401)
    const body = await req.json().catch(() => ({})) as { company_id?: string }
    const companyId = String(body.company_id ?? '')
    const { data: can } = await userClient.rpc('xero_can_manage', { p_company_id: companyId })
    if (can !== true) return json({ error: 'Only the owner, HR, finance and admins can set up Xero.' }, 403)

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) as Admin
    const token = await getValidXeroToken(admin, companyId)
    if (!token) return json({ error: 'Xero is not connected. Connect Xero first.' }, 409)

    const [org, accs, curs, taxes] = await Promise.all([
      xero(token, '/Organisation'), xero(token, '/Accounts'), xero(token, '/Currencies'), xero(token, '/TaxRates'),
    ])
    if (!accs.ok) return json({ error: accs.error ?? 'Could not read your Xero accounts.' }, 502)
    const accounts = ((accs.data?.Accounts ?? []) as Acc[]).filter(a => a.Status === 'ACTIVE')
    const sales = pick(accounts, [
      a => a.Class === 'REVENUE' && a.Code === '200', a => a.Class === 'REVENUE' && /^sales$/i.test(a.Name),
      a => a.Class === 'REVENUE' && /sales/i.test(a.Name), a => a.Class === 'REVENUE' && a.Type === 'REVENUE',
    ])
    const purchases = pick(accounts, [
      a => a.Type === 'DIRECTCOSTS' && /purchases/i.test(a.Name), a => a.Type === 'DIRECTCOSTS' && /cost of (goods )?sales/i.test(a.Name),
      a => a.Code === '300' || a.Code === '310', a => a.Type === 'DIRECTCOSTS', a => /purchases/i.test(a.Name) && a.Class === 'EXPENSE',
    ])
    const bank = pick(accounts, [a => a.Type === 'BANK'])

    const base = String(org.data?.Organisations?.[0]?.BaseCurrency ?? '').toUpperCase()
    const orgName = String(org.data?.Organisations?.[0]?.Name ?? '')
    const { data: home } = await admin.rpc('company_home_currency', { p_company_id: companyId })
    const xeroCurrencies = new Set<string>([base, ...((curs.data?.Currencies ?? []) as Array<{ Code: string }>).map(c => String(c.Code).toUpperCase())])
    const [{ data: cl }, { data: co }] = await Promise.all([
      admin.from('clients').select('currency').eq('company_id', companyId).not('currency', 'is', null),
      admin.from('contractors').select('currency').eq('company_id', companyId).not('currency', 'is', null),
    ])
    const used = new Set<string>([...(cl ?? []), ...(co ?? [])].map(r => String(r.currency).toUpperCase()))
    const missingCurrencies = [...used].filter(c => !xeroCurrencies.has(c)).sort()

    const rates = ((taxes.data?.TaxRates ?? []) as Array<{ EffectiveRate: number; Status: string; CanApplyToRevenue?: boolean; CanApplyToExpenses?: boolean }>)
      .filter(t => t.Status === 'ACTIVE')
    const has15 = (side: 'rev' | 'exp') => rates.some(t => Math.abs(Number(t.EffectiveRate) - 15) < 0.001
      && (side === 'rev' ? t.CanApplyToRevenue !== false : t.CanApplyToExpenses !== false))
    const { data: comp } = await admin.from('companies').select('is_vat_registered').eq('id', companyId).maybeSingle()

    const [{ count: clients }, { count: suppliers }, { count: linked }] = await Promise.all([
      admin.from('clients').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      admin.from('contractors').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      admin.from('xero_contact_links').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    ])

    const checks: Array<{ ok: boolean; text: string }> = [
      { ok: !!sales, text: sales ? `Sales go to ${label(sales)}` : 'No sales account found in Xero — choose one below.' },
      { ok: !!purchases, text: purchases ? `Bills go to ${label(purchases)}` : 'No purchases account found in Xero — choose one below.' },
      { ok: !!bank, text: bank ? `Payments go through ${label(bank)}` : 'Xero has no bank account yet. Add one in Xero (Accounting → Bank accounts), then run setup again.' },
      { ok: !base || base === String(home ?? 'ZAR').toUpperCase(),
        text: !base || base === String(home ?? 'ZAR').toUpperCase() ? `Xero works in ${base || 'your currency'}, like KaiSync`
          : `Xero works in ${base}, KaiSync in ${home}. Documents still go across, but rand amounts in KaiSync use the daily rate, not Xero's.` },
      ...(comp?.is_vat_registered === false ? [] : [{ ok: has15('rev') && has15('exp'),
        text: has15('rev') && has15('exp') ? 'VAT 15% is set up in Xero' : 'Xero has no 15% VAT rate for sales and purchases. Add it in Xero (Accounting → Advanced → Tax rates).' }]),
      { ok: missingCurrencies.length === 0,
        text: missingCurrencies.length ? `Switch on in Xero (Accounting → Advanced → Currencies): ${missingCurrencies.join(', ')}` : 'Every client and supplier currency is switched on in Xero' },
    ]

    return json({
      ok: true, organisation: orgName,
      suggested: { sales: val(sales), purchases: val(purchases), bank: val(bank) },
      checks,
      contacts: { clients: clients ?? 0, suppliers: suppliers ?? 0, already_linked: linked ?? 0 },
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
