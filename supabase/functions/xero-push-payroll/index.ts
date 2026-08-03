/**
 * Push approved payment_approvals to Xero as Draft Manual Journals.
 * Idempotent via xero_journal_links.payment_approval_id.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const TOKEN_URL = 'https://identity.xero.com/connect/token'

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

  const expiresAt = conn.token_expires_at ?? conn.expires_at
  if (new Date(expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return { access_token: conn.access_token as string, tenant_id: conn.tenant_id as string }
  }

  const clientId = Deno.env.get('XERO_CLIENT_ID')!
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

  const tokens = await res.json()
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await admin.from('xero_connections').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? conn.refresh_token,
    token_expires_at: newExpiry,
    expires_at: newExpiry,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId)

  return { access_token: tokens.access_token as string, tenant_id: conn.tenant_id as string }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session' }, 401)

    const body = await req.json() as {
      company_id: string
      period_start: string
      period_end: string
    }
    if (!body.company_id || !body.period_start || !body.period_end) {
      return json({ error: 'Missing company_id, period_start, or period_end' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    // Live schema: employees.user_id + access_level.
    const { data: actor } = await admin
      .from('employees')
      .select('id, access_level')
      .eq('user_id', user.id)
      .eq('company_id', body.company_id)
      .eq('is_active', true)
      .maybeSingle()
    const level = (actor?.access_level ?? '').toLowerCase()
    if (!actor || !['owner', 'hr', 'hr_admin', 'admin'].includes(level)) {
      return json({ error: 'Not authorized' }, 403)
    }

    const token = await getValidXeroToken(admin, body.company_id)
    if (!token) return json({ error: 'Xero not connected. Please connect Xero first.' }, 400)

    const { data: xeroConn } = await admin
      .from('xero_connections')
      .select('wages_expense_code, wages_payable_code, paye_payable_code, accounts_payable_code')
      .eq('company_id', body.company_id)
      .maybeSingle()

    const wagesExpenseCode = xeroConn?.wages_expense_code ?? '477'
    const wagesPayableCode = xeroConn?.wages_payable_code ?? xeroConn?.accounts_payable_code ?? '814'
    const payePayableCode = xeroConn?.paye_payable_code ?? '825'

    const { data: alreadyPushed } = await admin
      .from('xero_journal_links')
      .select('payment_approval_id, payslip_id')
      .eq('company_id', body.company_id)

    const pushedIds = new Set<string>()
    for (const row of alreadyPushed ?? []) {
      if (row.payment_approval_id) pushedIds.add(row.payment_approval_id as string)
      if (row.payslip_id) pushedIds.add(row.payslip_id as string)
    }

    const { data: payslips, error: psError } = await admin
      .from('payment_approvals')
      .select(`
        id, employee_id, period_start, period_end,
        gross_pay, deductions, net_pay, status,
        employees!inner(name, surname)
      `)
      .eq('company_id', body.company_id)
      .in('status', ['approved', 'paid'])
      .gte('period_start', body.period_start)
      .lte('period_end', body.period_end)

    if (psError) return json({ error: psError.message }, 500)

    const unpushed = (payslips ?? []).filter(p => !pushedIds.has(p.id))
    if (unpushed.length === 0) {
      return json({
        ok: true,
        pushed: 0,
        message: 'No new approved payslips to push for this period.',
      })
    }

    const journalLinks: Array<{
      company_id: string
      payment_approval_id: string
      payslip_id: string
      xero_journal_id: string
      xero_journal_status: string
    }> = []
    let skipped = 0

    for (const ps of unpushed) {
      const worker = (ps as { employees?: { name?: string; surname?: string } }).employees
      const empName = worker ? `${worker.name ?? ''} ${worker.surname ?? ''}`.trim() : ps.employee_id
      const grossPay = Number(ps.gross_pay ?? 0)
      const netPay = Number(ps.net_pay ?? 0)
      const deductions = Number(ps.deductions ?? 0)

      const journal = {
        Date: ps.period_end,
        Narration: `Payroll: ${empName} | ${ps.period_start} to ${ps.period_end}`,
        Status: 'DRAFT',
        LineAmountTypes: 'NoTax',
        JournalLines: [
          {
            AccountCode: wagesExpenseCode,
            Description: `Gross pay — ${empName}`,
            LineAmount: grossPay,
          },
          {
            AccountCode: wagesPayableCode,
            Description: `Net pay — ${empName}`,
            LineAmount: -netPay,
          },
          ...(deductions > 0
            ? [{
                AccountCode: payePayableCode,
                Description: `Deductions — ${empName}`,
                LineAmount: -deductions,
              }]
            : []),
        ],
      }

      const resp = await fetch(`${XERO_API_BASE}/ManualJournals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'xero-tenant-id': token.tenant_id,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ ManualJournals: [journal] }),
      })

      if (!resp.ok) {
        console.error(`Xero ManualJournal error for ${ps.id}:`, await resp.text())
        skipped++
        continue
      }

      const result = await resp.json() as {
        ManualJournals: Array<{ ManualJournalID: string; Status: string }>
      }
      const created = result.ManualJournals?.[0]
      if (created?.ManualJournalID) {
        journalLinks.push({
          company_id: body.company_id,
          payment_approval_id: ps.id,
          payslip_id: ps.id, // legacy column still NOT NULL-friendly; same uuid
          xero_journal_id: created.ManualJournalID,
          xero_journal_status: created.Status ?? 'DRAFT',
        })
      } else {
        skipped++
      }
    }

    if (journalLinks.length > 0) {
      const { error: linkErr } = await admin.from('xero_journal_links').insert(journalLinks)
      if (linkErr) return json({ error: linkErr.message, pushed: 0 }, 500)
    }

    return json({
      ok: true,
      pushed: journalLinks.length,
      skipped,
      total: unpushed.length,
      message: `Pushed ${journalLinks.length} payslip${journalLinks.length === 1 ? '' : 's'} to Xero as Draft Manual Journals.`,
    })
  } catch (err) {
    console.error('xero-push-payroll error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
