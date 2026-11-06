import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Loads the European Central Bank's daily exchange rates (euro-based, via frankfurter.dev) into fx_rates,
 * from the day after the last one stored (from 2024 on the first run), then gives non-rand documents that
 * still have no rate one (fx_fill_missing). Called daily by the 'fx-rates-daily' cron with the vault secret.
 */

const SOURCE = 'https://api.frankfurter.dev/v1'

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: okSecret } = await admin.rpc('xero_sync_secret_ok', { p_secret: req.headers.get('x-xero-sync-secret') ?? '' })
  if (okSecret !== true) return new Response('forbidden', { status: 403 })

  const { data: last } = await admin.from('fx_rates').select('day').order('day', { ascending: false }).limit(1).maybeSingle()
  const from = last?.day
    ? new Date(new Date(`${last.day}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
    : '2024-01-01'
  const today = new Date().toISOString().slice(0, 10)

  let days: Record<string, Record<string, number>> = {}
  if (from <= today) {
    const r = await fetch(`${SOURCE}/${from}..?base=EUR`, { headers: { Accept: 'application/json' } })
    if (!r.ok) return Response.json({ ok: false, error: `Rate source answered ${r.status}` }, { status: 502 })
    const body = await r.json() as { rates?: Record<string, Record<string, number>> }
    days = body.rates ?? {}
  }

  const rows: Array<{ day: string; currency: string; per_eur: number }> = []
  for (const [day, rates] of Object.entries(days)) {
    if (last?.day && day <= last.day) continue
    rows.push({ day, currency: 'EUR', per_eur: 1 })
    for (const [currency, v] of Object.entries(rates)) {
      if (/^[A-Z]{3}$/.test(currency) && Number(v) > 0) rows.push({ day, currency, per_eur: Number(v) })
    }
  }
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from('fx_rates').upsert(rows.slice(i, i + 1000), { onConflict: 'day,currency' })
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  const { data: filled, error: fillErr } = await admin.rpc('fx_fill_missing')
  return Response.json({ ok: true, from, days: Object.keys(days).length, rows: rows.length, filled: filled ?? 0, fill_error: fillErr?.message ?? null })
})
