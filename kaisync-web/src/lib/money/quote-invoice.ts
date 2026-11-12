/**
 * Invoice from a quote (an order): the same rules as the database's _quote_to_draft_invoice, so it doesn't matter
 * whether the draft was made when the client accepted, from the quote page, or from the order page.
 *  - One open invoice per quote: an existing one (not voided or cancelled) is returned instead of making another.
 *  - The invoice is a draft with no number; it gets its number when it is sent.
 *  - A discounted line is invoiced at its price after discount, with "(10% discount)" in the description.
 *  - Part billing: a deposit or progress invoice is a % of the order (createPartInvoiceFromQuote). The final
 *    invoice then has every line, less what was already invoiced, so the order adds up to the quote.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

type QuoteRow = {
  id: string; company_id: string; client_id: string | null; deal_id: string | null; job_id: string | null
  quote_number: string | null; title: string | null; currency: string | null
  subtotal: number | null; vat_amount: number | null; total_amount: number | null; payment_terms_days?: number | null
}
type QuoteLineRow = {
  description: string | null; quantity: number | null; unit: string | null; unit_sell_price: number | null
  subtotal_sell: number | null; vat_rate: number | null; discount_percent: number | null; is_excluded: boolean | null
  job_service_id: string | null; inventory_item_id: string | null; catalogue_item_id: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The quote's open invoice, if it has one. */
export async function openInvoiceForQuote(supabase: SupabaseClient, companyId: string, quoteId: string): Promise<string | null> {
  const { data } = await supabase.from('finance_invoices').select('id')
    .eq('company_id', companyId).eq('quote_id', quoteId)
    .not('status', 'in', '(voided,cancelled)')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Sent (not draft, voided or cancelled) invoices for a quote: what has already been billed. */
async function billedForQuote(supabase: SupabaseClient, companyId: string, quoteId: string) {
  const { data } = await supabase.from('finance_invoices').select('id, invoice_number, status, subtotal')
    .eq('company_id', companyId).eq('quote_id', quoteId).not('status', 'in', '(voided,cancelled,draft)')
  const rows = (data ?? []) as { id: string; invoice_number: string | null; subtotal: number | null }[]
  return { rows, subtotal: round2(rows.reduce((s, r) => s + (Number(r.subtotal) || 0), 0)) }
}

/** Open draft for a quote (a draft is reused rather than making another). */
async function draftForQuote(supabase: SupabaseClient, companyId: string, quoteId: string): Promise<string | null> {
  const { data } = await supabase.from('finance_invoices').select('id')
    .eq('company_id', companyId).eq('quote_id', quoteId).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/**
 * A deposit or progress invoice: a % of the order (excl. VAT), as one line. Reuses an open draft if there is one.
 */
export async function createPartInvoiceFromQuote(
  supabase: SupabaseClient,
  opts: { companyId: string; quoteId: string; employeeId?: string | null; percent: number; label: string },
): Promise<{ id: string; created: boolean } | { error: string }> {
  const draft = await draftForQuote(supabase, opts.companyId, opts.quoteId)
  if (draft) return { id: draft, created: false }
  const pct = Math.min(100, Math.max(0, Number(opts.percent) || 0))
  if (!(pct > 0)) return { error: 'Enter the % to invoice.' }
  const { data: q, error } = await supabase.from('commercial_quotes')
    .select('id, company_id, client_id, deal_id, job_id, quote_number, title, currency, subtotal, vat_amount, total_amount')
    .eq('id', opts.quoteId).eq('company_id', opts.companyId).maybeSingle()
  if (error || !q) return { error: error?.message ?? 'Quote not found.' }
  const quote = q as QuoteRow
  const billed = await billedForQuote(supabase, opts.companyId, opts.quoteId)
  const qSub = Number(quote.subtotal) || 0
  const sub = round2(qSub * pct / 100)
  if (sub > round2(qSub - billed.subtotal) + 0.01) return { error: `That is more than is left to invoice on this order.` }
  const rate = qSub > 0 ? Math.round(((Number(quote.vat_amount) || 0) / qSub) * 10000) / 10000 : 0
  const vat = round2(sub * rate)
  const terms = await clientTerms(supabase, quote.client_id)
  const label = (opts.label || 'Deposit').trim()
  const desc = `${label} ${Math.round(pct * 100) / 100}% of quote ${quote.quote_number ?? ''}${quote.title ? ` · ${quote.title}` : ''}`.replace(/\s+/g, ' ').trim()
  const inv = await insertInvoice(supabase, quote, { subtotal: sub, rate, vat, terms, employeeId: opts.employeeId, note: `${label} for quote ${quote.quote_number ?? ''}.` })
  if ('error' in inv) return inv
  const { error: lErr } = await supabase.from('finance_invoice_lines').insert({
    company_id: quote.company_id, invoice_id: inv.id, line_no: 1, description: desc, quantity: 1, unit_price: sub,
    subtotal: sub, vat_rate: rate, vat_amount: vat, total_amount: round2(sub + vat), is_vat_inclusive: false,
    tax_type: rate > 0 ? 'standard' : 'exempt', item_type: 'custom', source_id: null, unit: null,
  })
  if (lErr) return { error: lErr.message }
  return { id: inv.id, created: true }
}

async function clientTerms(supabase: SupabaseClient, clientId: string | null): Promise<number> {
  if (!clientId) return 30
  const { data: c } = await supabase.from('clients').select('payment_terms_days').eq('id', clientId).maybeSingle()
  const t = Number((c as { payment_terms_days?: number | null } | null)?.payment_terms_days)
  return t > 0 ? t : 30
}

async function insertInvoice(
  supabase: SupabaseClient, quote: QuoteRow,
  v: { subtotal: number; rate: number; vat: number; terms: number; employeeId?: string | null; note: string },
): Promise<{ id: string } | { error: string }> {
  const issue = new Date()
  const due = new Date(issue.getTime() + v.terms * 86400000)
  const total = round2(v.subtotal + v.vat)
  const { data, error } = await supabase.from('finance_invoices').insert({
    company_id: quote.company_id, client_id: quote.client_id, deal_id: quote.deal_id, project_id: quote.deal_id,
    job_id: quote.job_id, quote_id: quote.id, invoice_number: null, status: 'draft', currency: quote.currency || 'ZAR',
    subtotal: v.subtotal, vat_rate: v.rate, vat_amount: v.vat, total_amount: total, amount_paid: 0, balance_due: total,
    is_vat_inclusive: false, tax_type: v.rate > 0 ? 'standard' : 'exempt',
    issue_date: issue.toISOString().slice(0, 10), due_date: due.toISOString().slice(0, 10),
    created_by: v.employeeId ?? null, invoice_type: 'standard', notes: v.note,
  }).select('id').maybeSingle()
  if (error || !data) return { error: error?.message ?? 'Could not create the invoice.' }
  return { id: (data as { id: string }).id }
}

/** Returns the invoice id (an existing open one, or a new draft), or an error message. */
export async function createInvoiceFromQuote(
  supabase: SupabaseClient,
  opts: { companyId: string; quoteId: string; employeeId?: string | null },
): Promise<{ id: string; created: boolean } | { error: string }> {
  // A draft is reused. If deposits / progress invoices were sent, this is the final invoice for what is left.
  const draft = await draftForQuote(supabase, opts.companyId, opts.quoteId)
  if (draft) return { id: draft, created: false }
  const billed = await billedForQuote(supabase, opts.companyId, opts.quoteId)

  const [{ data: q, error: qErr }, { data: lineData, error: lErr }] = await Promise.all([
    supabase.from('commercial_quotes')
      .select('id, company_id, client_id, deal_id, job_id, quote_number, title, currency, subtotal, vat_amount, total_amount')
      .eq('id', opts.quoteId).eq('company_id', opts.companyId).maybeSingle(),
    supabase.from('commercial_quote_lines')
      .select('description, quantity, unit, unit_sell_price, subtotal_sell, vat_rate, discount_percent, is_excluded, job_service_id, inventory_item_id, catalogue_item_id')
      .eq('quote_id', opts.quoteId).order('sort_order'),
  ])
  if (qErr || !q) return { error: qErr?.message ?? 'Quote not found.' }
  if (lErr) return { error: lErr.message }
  const quote = q as QuoteRow

  const quoteSub = Number(quote.subtotal) || 0
  const rate = quoteSub > 0 ? Math.round(((Number(quote.vat_amount) || 0) / quoteSub) * 10000) / 10000 : 0
  // Everything already invoiced: open the latest invoice instead of making an empty one.
  if (billed.rows.length && quoteSub - billed.subtotal <= 0.01) return { id: billed.rows[billed.rows.length - 1].id, created: false }
  const subtotal = round2(quoteSub - billed.subtotal)
  const vatAmount = billed.rows.length ? round2(subtotal * rate) : Number(quote.vat_amount) || 0
  const terms = await clientTerms(supabase, quote.client_id)
  const inserted = await insertInvoice(supabase, quote, {
    subtotal, rate, vat: vatAmount, terms, employeeId: opts.employeeId,
    note: billed.rows.length ? `Final invoice for quote ${quote.quote_number ?? ''}.` : `From quote ${quote.quote_number ?? ''} (accepted).`,
  })
  if ('error' in inserted) return inserted
  const invId = inserted.id

  const lines = ((lineData ?? []) as QuoteLineRow[]).filter(l => !l.is_excluded)
  if (lines.length) {
    const { error } = await supabase.from('finance_invoice_lines').insert(lines.map((l, i) => {
      const qty = Number(l.quantity ?? 1) || 0
      const disc = Number(l.discount_percent) || 0
      const sub = round2(Number(l.subtotal_sell) || 0)
      const lineRate = l.vat_rate != null ? Number(l.vat_rate) : rate
      const vat = round2(sub * lineRate)
      const desc = (l.description ?? '').trim() || quote.title || `Line ${i + 1}`
      return {
        company_id: quote.company_id,
        invoice_id: invId,
        line_no: i + 1,
        description: disc > 0 ? `${desc} (${Math.round(disc * 100) / 100}% discount)` : desc,
        quantity: qty,
        unit_price: disc > 0 && qty > 0 ? Math.round((sub / qty) * 10000) / 10000 : Number(l.unit_sell_price) || 0,
        subtotal: sub,
        vat_rate: lineRate,
        vat_amount: vat,
        total_amount: round2(sub + vat),
        is_vat_inclusive: false,
        tax_type: lineRate > 0 ? 'standard' : 'exempt',
        item_type: l.job_service_id ? 'service' : l.inventory_item_id ? 'inventory' : l.catalogue_item_id ? 'catalogue' : 'custom',
        source_id: l.job_service_id ?? l.inventory_item_id ?? l.catalogue_item_id ?? null,
        unit: l.unit || null,
      }
    }))
    if (error) return { error: error.message }
  }
  if (billed.rows.length) {
    // Less what the deposit / progress invoices already billed, so the order adds up to the quote.
    const less = -billed.subtotal
    const vat = round2(less * rate)
    const nums = billed.rows.map(r => r.invoice_number).filter(Boolean).join(', ')
    const { error } = await supabase.from('finance_invoice_lines').insert({
      company_id: quote.company_id, invoice_id: invId, line_no: lines.length + 1,
      description: `Less: already invoiced${nums ? ` (${nums})` : ''}`, quantity: 1, unit_price: less, subtotal: less,
      vat_rate: rate, vat_amount: vat, total_amount: round2(less + vat), is_vat_inclusive: false,
      tax_type: rate > 0 ? 'standard' : 'exempt', item_type: 'custom', source_id: null, unit: null,
    })
    if (error) return { error: error.message }
  }
  return { id: invId, created: true }
}
