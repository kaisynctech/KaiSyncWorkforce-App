import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { type Admin, getValidXeroToken, xero } from '../_shared/xero.ts'

/**
 * Brings money back from Xero (every 10 minutes from the 'xero-pull' cron, or "Check Xero now" in Settings):
 * • payments entered in Xero on invoices / bills that KaiSync sent → recorded in KaiSync;
 * • a payment that came from Xero and was deleted there → reversed in KaiSync;
 * • an invoice voided in Xero (no payments) → voided in KaiSync.
 * Only what changed since the last check is read (If-Modified-Since). The database functions never take a document
 * past what is owed, never send anything back to Xero, and remember every Xero payment they have seen.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...cors } })

/** Xero JSON dates look like "/Date(1573755038314+0000)/". */
function xeroDay(v: unknown): string {
  const m = /\/Date\((\d+)/.exec(String(v ?? ''))
  if (m) return new Date(Number(m[1]) + 2 * 3600e3).toISOString().slice(0, 10)
  const s = String(v ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10)
}

type Summary = { company_id: string; recorded: number; reversed: number; voided: number; skipped: string[]; error?: string }

async function linkFor(admin: Admin, companyId: string, entities: string[], xeroId: string) {
  const { data } = await admin.from('xero_doc_links').select('entity, record_id')
    .eq('company_id', companyId).eq('xero_id', xeroId).in('entity', entities)
  return (data ?? []) as Array<{ entity: string; record_id: string }>
}

async function pullCompany(admin: Admin, companyId: string): Promise<Summary> {
  const out: Summary = { company_id: companyId, recorded: 0, reversed: 0, voided: 0, skipped: [] }
  const { data: conn } = await admin.from('xero_connections').select('pulled_at, sync_from').eq('company_id', companyId).maybeSingle()
  const token = await getValidXeroToken(admin, companyId)
  if (!token) throw new Error('Xero is not connected (or the connection expired). Reconnect Xero in Settings → Integrations.')
  const started = new Date()
  const since = conn?.pulled_at ? new Date(new Date(conn.pulled_at).getTime() - 5 * 60e3)   // small overlap is harmless
    : conn?.sync_from ? new Date(`${conn.sync_from}T00:00:00Z`) : new Date(Date.now() - 86400e3)
  const ims = { 'If-Modified-Since': since.toUTCString() }

  // ── Payments ──
  for (let page = 1; page <= 50; page++) {
    const r = await xero(token, `/Payments?page=${page}`, { headers: ims })
    if (!r.ok) {
      if (r.status === 304) break
      throw new Error(r.error ?? 'Could not read payments from Xero')
    }
    const list = (r.data?.Payments ?? []) as Array<Record<string, any>>
    for (const p of list) {
      const pid = String(p.PaymentID ?? '')
      const invId = String(p.Invoice?.InvoiceID ?? '')
      if (!pid || !invId) continue
      const type = String(p.PaymentType ?? '')
      if (p.Status === 'DELETED') {
        if (type === 'ACCRECPAYMENT') {
          const { data } = await admin.rpc('xero_reverse_payment', { p_company_id: companyId, p_xero_payment_id: pid })
          if (data === 'reversed') out.reversed++
        }
        continue
      }
      if (p.Status !== 'AUTHORISED') continue
      const day = xeroDay(p.Date)
      const ref = String(p.Reference ?? '').slice(0, 200)
      if (type === 'ACCRECPAYMENT') {
        const [link] = await linkFor(admin, companyId, ['invoice'], invId)
        if (!link) continue   // an invoice made in Xero itself
        const { data, error } = await admin.rpc('xero_apply_payment', {
          p_company_id: companyId, p_invoice_id: link.record_id, p_amount: Number(p.Amount ?? 0), p_date: day,
          p_reference: ref, p_xero_payment_id: pid,
        })
        if (error) out.skipped.push(`${p.Invoice?.InvoiceNumber ?? invId}: ${error.message}`)
        else if (data === 'recorded') out.recorded++
        else if (String(data).startsWith('skipped')) out.skipped.push(`${p.Invoice?.InvoiceNumber ?? invId}: ${String(data).slice(9)}`)
      } else if (type === 'ACCPAYPAYMENT') {
        const links = await linkFor(admin, companyId, ['supplier_bill', 'po_bill'], invId)
        let siId = links.find(l => l.entity === 'supplier_bill')?.record_id
        if (!siId) {
          const po = links.find(l => l.entity === 'po_bill')
          if (po) {
            const { data: si } = await admin.from('supplier_invoices').select('id').eq('company_id', companyId).eq('po_id', po.record_id)
              .neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle()
            siId = si?.id
            if (!siId) { out.skipped.push(`${p.Invoice?.InvoiceNumber ?? 'Bill'}: paid in Xero, but there is no supplier invoice in KaiSync yet`); continue }
          }
        }
        if (!siId) continue
        const { data, error } = await admin.rpc('xero_apply_supplier_payment', {
          p_company_id: companyId, p_supplier_invoice_id: siId, p_amount: Number(p.Amount ?? 0), p_date: day,
          p_reference: ref, p_xero_payment_id: pid,
        })
        if (error) out.skipped.push(`${p.Invoice?.InvoiceNumber ?? invId}: ${error.message}`)
        else if (data === 'recorded') out.recorded++
      }
    }
    if (list.length < 100) break
  }

  // ── Invoices voided in Xero ──
  for (let page = 1; page <= 20; page++) {
    const where = encodeURIComponent('Type=="ACCREC"')
    const r = await xero(token, `/Invoices?Statuses=VOIDED&summaryOnly=true&where=${where}&page=${page}`, { headers: ims })
    if (!r.ok) {
      if (r.status === 304) break
      throw new Error(r.error ?? 'Could not read invoices from Xero')
    }
    const list = (r.data?.Invoices ?? []) as Array<Record<string, any>>
    for (const x of list) {
      const [link] = await linkFor(admin, companyId, ['invoice'], String(x.InvoiceID ?? ''))
      if (!link) continue
      const { data } = await admin.rpc('xero_apply_invoice_void', { p_company_id: companyId, p_invoice_id: link.record_id })
      if (data === 'voided') out.voided++
      else if (String(data).startsWith('skipped')) out.skipped.push(`${x.InvoiceNumber ?? 'Invoice'} was voided in Xero, ${String(data).slice(9)}`)
    }
    if (list.length < 100) break
  }

  await admin.from('xero_connections').update({ pulled_at: started.toISOString(), pull_error: out.skipped.length ? out.skipped.slice(0, 5).join(' · ') : null })
    .eq('company_id', companyId)
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) as Admin
  let companies: string[] = []
  const secret = req.headers.get('x-xero-sync-secret')
  if (secret) {
    const { data: ok } = await admin.rpc('xero_sync_secret_ok', { p_secret: secret })
    if (ok !== true) return json({ error: 'forbidden' }, 403)
    const { data } = await admin.from('xero_connections').select('company_id, is_active').eq('auto_sync', true).eq('pull_from_xero', true)
    companies = (data ?? []).filter(c => c.is_active !== false).map(c => c.company_id as string)
  } else {
    // "Check Xero now" from Settings: a signed-in owner / finance person, for their own company.
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing Authorization' }, 401)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Invalid session' }, 401)
    const body = await req.json().catch(() => ({})) as { company_id?: string }
    const cid = String(body.company_id ?? '')
    const { data: can } = await userClient.rpc('xero_can_manage', { p_company_id: cid })
    if (can !== true) return json({ error: 'Only the owner, HR, finance and admins can do this.' }, 403)
    companies = [cid]
  }

  const results: Summary[] = []
  for (const id of companies) {
    try { results.push(await pullCompany(admin, id)) } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await admin.from('xero_connections').update({ pull_error: msg.slice(0, 500) }).eq('company_id', id)
      results.push({ company_id: id, recorded: 0, reversed: 0, voided: 0, skipped: [], error: msg })
    }
  }
  return json({ ok: true, results })
})
