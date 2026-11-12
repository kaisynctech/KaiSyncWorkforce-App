/**
 * Invoice from a quote (an order): the same rules as the database's _quote_to_draft_invoice, so it doesn't matter
 * whether the draft was made when the client accepted, from the quote page, or from the order page.
 *  - One open invoice per quote: an existing one (not voided or cancelled) is returned instead of making another.
 *  - The invoice is a draft with no number; it gets its number when it is sent.
 *  - A discounted line is invoiced at its price after discount, with "(10% discount)" in the description.
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

/** Returns the invoice id (an existing open one, or a new draft), or an error message. */
export async function createInvoiceFromQuote(
  supabase: SupabaseClient,
  opts: { companyId: string; quoteId: string; employeeId?: string | null },
): Promise<{ id: string; created: boolean } | { error: string }> {
  const existing = await openInvoiceForQuote(supabase, opts.companyId, opts.quoteId)
  if (existing) return { id: existing, created: false }

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

  let terms = 30
  if (quote.client_id) {
    const { data: c } = await supabase.from('clients').select('payment_terms_days').eq('id', quote.client_id).maybeSingle()
    const t = Number((c as { payment_terms_days?: number | null } | null)?.payment_terms_days)
    if (t > 0) terms = t
  }

  const subtotal = Number(quote.subtotal) || 0
  const vatAmount = Number(quote.vat_amount) || 0
  const rate = subtotal > 0 ? Math.round((vatAmount / subtotal) * 10000) / 10000 : 0
  const taxType = rate > 0 ? 'standard' : 'exempt'
  const issue = new Date()
  const due = new Date(issue.getTime() + terms * 86400000)

  const { data: inv, error: invErr } = await supabase.from('finance_invoices').insert({
    company_id: quote.company_id,
    client_id: quote.client_id,
    deal_id: quote.deal_id,
    project_id: quote.deal_id,
    job_id: quote.job_id,
    quote_id: quote.id,
    invoice_number: null,
    status: 'draft',
    currency: quote.currency || 'ZAR',
    subtotal,
    vat_rate: rate,
    vat_amount: vatAmount,
    total_amount: Number(quote.total_amount) || 0,
    amount_paid: 0,
    balance_due: Number(quote.total_amount) || 0,
    is_vat_inclusive: false,
    tax_type: taxType,
    issue_date: issue.toISOString().slice(0, 10),
    due_date: due.toISOString().slice(0, 10),
    created_by: opts.employeeId ?? null,
    invoice_type: 'standard',
    notes: `From quote ${quote.quote_number ?? ''} (accepted).`.replace('  ', ' '),
  }).select('id').maybeSingle()
  if (invErr || !inv) return { error: invErr?.message ?? 'Could not create the invoice.' }
  const invId = (inv as { id: string }).id

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
  return { id: invId, created: true }
}
