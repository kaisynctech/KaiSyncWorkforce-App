/**
 * Buyout: asking suppliers (or contractors, for an outsourced service) what they will charge for a quote's
 * outsourced lines, before the quote is accepted.
 *
 * It is an RFQ made from the quote (rfqs.is_buyout), one per quote:
 *  - rfq_lines: one per outsourced quote line (rfq_lines.quote_line_id)
 *  - rfq_recipients: one per supplier, asked only for the items ticked for them (line_ids), sent to send_to (+ cc)
 *  - rfq_response_lines: their price, quantity and lead time per item (typed in by them on the private link, or by
 *    the office when they reply by email)
 * Choosing a reply puts that supplier's cost on the quote line (commercial_quote_lines.supplier_id,
 * chosen_response_line_id, cost_price). Purchase orders are made from those choices when the order is processed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type PriceVat = 'excl' | 'incl' | 'none'

export type BuyoutLine = { rfqLineId: string; quoteLineId: string | null; description: string; qty: number; unit: string }
export type BuyoutRecipient = {
  id: string; supplierId: string; name: string; contact: string | null; supplierEmail: string | null
  isVatRegistered: boolean | null; sendTo: string | null; cc: string[]; lineIds: string[] | null
  status: string; sentAt: string | null; respondedAt: string | null; viewedAt: string | null
  pricesIncludeVat: PriceVat | null; chargesVat: boolean | null; repliedOnline: boolean
  attachmentPath: string | null; validUntil: string | null; notes: string | null
}
export type BuyoutReply = { id: string; recipientId: string; rfqLineId: string; unitPrice: number; qty: number | null; leadDays: number | null; notes: string | null }
export type Buyout = {
  rfqId: string; rfqNumber: string | null; status: string
  lines: BuyoutLine[]; recipients: BuyoutRecipient[]; replies: BuyoutReply[]
}

/** The quote line, as the buyout needs it. */
export type OutsourcedLine = { id: string; description: string; qty: number; unit: string }

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** Is this item asked of this supplier? */
export function asks(r: Pick<BuyoutRecipient, 'lineIds'>, rfqLineId: string): boolean {
  return !r.lineIds || r.lineIds.includes(rfqLineId)
}

/** Cost of one unit excluding VAT, from a supplier's price. */
export function costExVat(unitPrice: number, pricesIncludeVat: PriceVat | null, vatRate = 0.15): number {
  const p = Number(unitPrice) || 0
  return pricesIncludeVat === 'incl' ? Math.round((p / (1 + vatRate)) * 100) / 100 : p
}

/** Does this supplier add VAT on the purchase order? Their own answer, else what they said about their prices, else their record. */
export function chargesVat(r: Pick<BuyoutRecipient, 'chargesVat' | 'pricesIncludeVat' | 'isVatRegistered'>): boolean {
  if (r.chargesVat != null) return r.chargesVat
  if (r.pricesIncludeVat === 'none') return false
  if (r.pricesIncludeVat) return true
  return r.isVatRegistered !== false
}

export async function loadBuyout(supabase: SupabaseClient, companyId: string, quoteId: string): Promise<Buyout | null> {
  const { data: rfq } = await supabase.from('rfqs').select('id, rfq_number, status')
    .eq('company_id', companyId).eq('quote_id', quoteId).eq('is_buyout', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!rfq) return null
  const r = rfq as { id: string; rfq_number: string | null; status: string }
  const [{ data: lines }, { data: recs }, { data: replies }] = await Promise.all([
    supabase.from('rfq_lines').select('id, quote_line_id, description, quantity, unit, sort_order').eq('rfq_id', r.id).order('sort_order'),
    supabase.from('rfq_recipients')
      .select('id, supplier_id, status, sent_at, viewed_at, responded_at, response_valid_until, response_notes, line_ids, send_to, cc, prices_include_vat, charges_vat, replied_online, reply_attachment_path, created_at, supplier:contractors(name, contact_person, email, is_vat_registered)')
      .eq('rfq_id', r.id).order('created_at'),
    supabase.from('rfq_response_lines').select('id, recipient_id, rfq_line_id, unit_price, quantity, lead_time_days, availability_notes').eq('rfq_id', r.id),
  ])
  return {
    rfqId: r.id, rfqNumber: r.rfq_number, status: r.status,
    lines: ((lines ?? []) as Record<string, unknown>[]).map(l => ({
      rfqLineId: String(l.id), quoteLineId: (l.quote_line_id as string | null) ?? null, description: String(l.description ?? ''),
      qty: Number(l.quantity ?? 1), unit: String(l.unit ?? 'each'),
    })),
    recipients: ((recs ?? []) as Record<string, unknown>[]).map(x => {
      const s = (x.supplier ?? {}) as { name?: string; contact_person?: string | null; email?: string | null; is_vat_registered?: boolean | null }
      return {
        id: String(x.id), supplierId: String(x.supplier_id), name: s.name ?? 'Supplier', contact: s.contact_person ?? null,
        supplierEmail: s.email ?? null, isVatRegistered: s.is_vat_registered ?? null,
        sendTo: (x.send_to as string | null) ?? null, cc: (x.cc as string[] | null) ?? [], lineIds: (x.line_ids as string[] | null) ?? null,
        status: String(x.status ?? 'pending'), sentAt: (x.sent_at as string | null) ?? null, respondedAt: (x.responded_at as string | null) ?? null,
        viewedAt: (x.viewed_at as string | null) ?? null,
        pricesIncludeVat: (x.prices_include_vat as PriceVat | null) ?? null, chargesVat: (x.charges_vat as boolean | null) ?? null,
        repliedOnline: !!x.replied_online, attachmentPath: (x.reply_attachment_path as string | null) ?? null,
        validUntil: (x.response_valid_until as string | null) ?? null, notes: (x.response_notes as string | null) ?? null,
      }
    }),
    replies: ((replies ?? []) as Record<string, unknown>[])
      .filter(x => Number(x.unit_price) > 0)
      .map(x => ({
        id: String(x.id), recipientId: String(x.recipient_id), rfqLineId: String(x.rfq_line_id), unitPrice: Number(x.unit_price),
        qty: num(x.quantity), leadDays: num(x.lead_time_days), notes: (x.availability_notes as string | null) ?? null,
      })),
  }
}

/**
 * The quote's buyout RFQ, made the first time, with one item per outsourced quote line (kept in step with the quote:
 * new outsourced lines are added, changed ones updated, and lines no longer outsourced are taken off unless a
 * supplier already priced them).
 */
export async function ensureBuyout(
  supabase: SupabaseClient,
  opts: { companyId: string; quoteId: string; employeeId: string | null; title: string; dealId: string | null; lines: OutsourcedLine[] },
): Promise<{ rfqId: string } | { error: string }> {
  let { data: rfq } = await supabase.from('rfqs').select('id')
    .eq('company_id', opts.companyId).eq('quote_id', opts.quoteId).eq('is_buyout', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!rfq) {
    const { data: n } = await supabase.rpc('generate_rfq_number', { p_company_id: opts.companyId })
    const ins = await supabase.from('rfqs').insert({
      company_id: opts.companyId, quote_id: opts.quoteId, deal_id: opts.dealId, is_buyout: true, status: 'draft',
      title: opts.title.trim() || 'Request for quotation', rfq_number: (n as string | null) ?? null, created_by: opts.employeeId,
    }).select('id').single()
    if (ins.error || !ins.data) return { error: ins.error?.message ?? 'Could not start the buyout.' }
    rfq = ins.data
  }
  const rfqId = (rfq as { id: string }).id

  const [{ data: have }, { data: priced }] = await Promise.all([
    supabase.from('rfq_lines').select('id, quote_line_id, description, quantity, unit').eq('rfq_id', rfqId),
    supabase.from('rfq_response_lines').select('rfq_line_id').eq('rfq_id', rfqId),
  ])
  const existing = (have ?? []) as { id: string; quote_line_id: string | null; description: string; quantity: number; unit: string | null }[]
  const pricedIds = new Set(((priced ?? []) as { rfq_line_id: string }[]).map(p => p.rfq_line_id))
  const want = new Map(opts.lines.filter(l => l.description.trim()).map((l, i) => [l.id, { ...l, sort: i }]))

  const adds = [...want.values()].filter(l => !existing.some(e => e.quote_line_id === l.id))
  if (adds.length) {
    const { error } = await supabase.from('rfq_lines').insert(adds.map(l => ({
      company_id: opts.companyId, rfq_id: rfqId, quote_line_id: l.id, sort_order: l.sort,
      description: l.description.trim(), quantity: l.qty || 1, unit: l.unit || 'each',
    })))
    if (error) return { error: error.message }
  }
  for (const e of existing) {
    const w = e.quote_line_id ? want.get(e.quote_line_id) : undefined
    if (w) {
      if (w.description.trim() !== e.description || Number(w.qty) !== Number(e.quantity) || (w.unit || 'each') !== (e.unit || 'each')) {
        await supabase.from('rfq_lines').update({ description: w.description.trim(), quantity: w.qty || 1, unit: w.unit || 'each', sort_order: w.sort }).eq('id', e.id)
      }
    } else if (!pricedIds.has(e.id)) {
      await supabase.from('rfq_lines').delete().eq('id', e.id)
    }
  }
  return { rfqId }
}

export async function addSupplier(
  supabase: SupabaseClient,
  opts: { companyId: string; rfqId: string; supplierId: string; email: string | null; lineIds: string[] | null },
): Promise<{ error: string } | { ok: true }> {
  const { error } = await supabase.from('rfq_recipients').insert({
    company_id: opts.companyId, rfq_id: opts.rfqId, supplier_id: opts.supplierId, status: 'pending',
    line_ids: opts.lineIds, send_to: opts.email || null,
  })
  if (error) return { error: error.code === '23505' ? 'That supplier is already on the list.' : error.message }
  return { ok: true }
}

export async function updateRecipient(supabase: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('rfq_recipients').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  return error ? { error: error.message } : { ok: true as const }
}

/** Only a supplier who hasn't been sent anything can be taken off. */
export async function removeRecipient(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('rfq_recipients').delete().eq('id', id).eq('status', 'pending')
  return error ? { error: error.message } : { ok: true as const }
}

/** A reply the office types in (the supplier answered by email or sent a PDF). */
export async function saveReply(
  supabase: SupabaseClient,
  opts: { companyId: string; rfqId: string; recipientId: string; vat: PriceVat; rows: { rfqLineId: string; unitPrice: number; qty: number | null; leadDays: number | null }[] },
): Promise<{ error: string } | { ok: true }> {
  const rows = opts.rows.filter(r => r.unitPrice > 0)
  if (!rows.length) return { error: 'Enter at least one price.' }
  const { error } = await supabase.from('rfq_response_lines').upsert(rows.map(r => ({
    company_id: opts.companyId, rfq_id: opts.rfqId, recipient_id: opts.recipientId, rfq_line_id: r.rfqLineId,
    unit_price: r.unitPrice, quantity: r.qty, lead_time_days: r.leadDays,
    subtotal: Math.round(r.unitPrice * (r.qty ?? 1) * 100) / 100,
  })), { onConflict: 'recipient_id,rfq_line_id' })
  if (error) return { error: error.message }
  const now = new Date().toISOString()
  const { error: e2 } = await supabase.from('rfq_recipients').update({
    status: 'responded', responded_at: now, prices_include_vat: opts.vat, updated_at: now,
  }).eq('id', opts.recipientId)
  return e2 ? { error: e2.message } : { ok: true }
}

export const isEmailAddress = (v: string | null | undefined) => /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test((v ?? '').trim())

/** Where the request goes: the address chosen for it, else the supplier's email. */
export function sendToOf(r: Pick<BuyoutRecipient, 'sendTo' | 'supplierEmail'>): string {
  return (r.sendTo ?? '').trim() || (r.supplierEmail ?? '').trim()
}
