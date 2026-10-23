import type { SupabaseClient } from '@supabase/supabase-js'
import { localISODate } from '@/lib/utils'

export type QuoteInvoiceResult =
  | { ok: true; invoiceId: string; alreadyExisted: boolean }
  | { ok: false; message: string }

type QuoteRow = {
  id: string
  company_id: string
  client_id: string | null
  deal_id: string | null
  job_id: string | null
  title: string
  currency: string
  subtotal: number
  vat_amount: number
  total_amount: number
}

type QuoteLineRow = {
  description: string
  quantity: number
  unit_sell_price: number
  subtotal_sell: number
  vat_rate: number
  vat_amount: number
  line_total: number
  is_excluded: boolean
  sort_order: number
}

function vatRateFromTotals(subtotal: number, vatAmount: number): number {
  if (subtotal <= 0) return 0.15
  return Math.round((vatAmount / subtotal) * 10000) / 10000
}

/**
 * Copy an accepted project quotation into a draft finance invoice.
 * A second click opens the invoice that was already created from that quote.
 */
export async function createInvoiceFromAcceptedQuote(
  supabase: SupabaseClient,
  opts: { companyId: string; clientId: string; quoteId: string; employeeId: string | null },
): Promise<QuoteInvoiceResult> {
  const { data: quote, error: quoteError } = await supabase
    .from('commercial_quotes')
    .select('id, company_id, client_id, deal_id, job_id, title, currency, subtotal, vat_amount, total_amount')
    .eq('id', opts.quoteId)
    .eq('company_id', opts.companyId)
    .eq('client_id', opts.clientId)
    .maybeSingle()

  if (quoteError) return { ok: false, message: quoteError.message }
  if (!quote) return { ok: false, message: 'That quotation is not on this client.' }

  const row = quote as QuoteRow
  if (!row.deal_id) {
    return { ok: false, message: 'This quotation is not on a project the client can accept.' }
  }

  const { data: deal, error: dealError } = await supabase
    .from('client_deals')
    .select('quotation_response')
    .eq('id', row.deal_id)
    .eq('company_id', opts.companyId)
    .maybeSingle()
  if (dealError) return { ok: false, message: dealError.message }
  if (deal?.quotation_response !== 'accepted') {
    return { ok: false, message: 'The client has not accepted this quotation yet.' }
  }

  const { data: existing, error: existingError } = await supabase
    .from('finance_invoices')
    .select('id')
    .eq('company_id', opts.companyId)
    .eq('quote_id', row.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) return { ok: false, message: existingError.message }
  if (existing?.id) return { ok: true, invoiceId: existing.id as string, alreadyExisted: true }

  const { data: lineData, error: lineReadError } = await supabase
    .from('commercial_quote_lines')
    .select('description, quantity, unit_sell_price, subtotal_sell, vat_rate, vat_amount, line_total, is_excluded, sort_order')
    .eq('quote_id', row.id)
    .eq('company_id', opts.companyId)
    .order('sort_order', { ascending: true })
  if (lineReadError) return { ok: false, message: lineReadError.message }

  const sourceLines = ((lineData ?? []) as QuoteLineRow[]).filter(line => !line.is_excluded)
  const subtotal = Number(row.subtotal)
  const vatAmount = Number(row.vat_amount)
  const total = Number(row.total_amount)
  const vatRate = vatRateFromTotals(subtotal, vatAmount)
  const issue = localISODate()

  const { data: invoice, error: invoiceError } = await supabase
    .from('finance_invoices')
    .insert({
      company_id: opts.companyId,
      client_id: opts.clientId,
      deal_id: row.deal_id,
      project_id: row.deal_id,
      job_id: row.job_id,
      quote_id: row.id,
      invoice_number: null,
      status: 'draft',
      currency: row.currency || 'ZAR',
      subtotal,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total_amount: total,
      amount_paid: 0,
      balance_due: total,
      is_vat_inclusive: false,
      tax_type: 'standard',
      issue_date: issue,
      due_date: null,
      created_by: opts.employeeId,
      invoice_type: 'standard',
    })
    .select('id')
    .maybeSingle()

  if (invoiceError || !invoice?.id) {
    return { ok: false, message: invoiceError?.message ?? 'Could not create the invoice.' }
  }

  const invoiceId = invoice.id as string
  const invoiceLines = sourceLines.length > 0
    ? sourceLines.map((line, index) => ({
      company_id: opts.companyId,
      invoice_id: invoiceId,
      line_no: index + 1,
      description: line.description.trim() || row.title || `Line ${index + 1}`,
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_sell_price),
      subtotal: Number(line.subtotal_sell),
      vat_rate: Number(line.vat_rate),
      vat_amount: Number(line.vat_amount),
      total_amount: Number(line.line_total),
      is_vat_inclusive: false,
      tax_type: 'standard',
    }))
    : [{
      company_id: opts.companyId,
      invoice_id: invoiceId,
      line_no: 1,
      description: row.title || 'Accepted quotation',
      quantity: 1,
      unit_price: subtotal,
      subtotal,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total_amount: total,
      is_vat_inclusive: false,
      tax_type: 'standard',
    }]

  const { error: lineWriteError } = await supabase.from('finance_invoice_lines').insert(invoiceLines)
  if (lineWriteError) {
    await supabase.from('finance_invoices').delete().eq('id', invoiceId).eq('company_id', opts.companyId)
    return { ok: false, message: lineWriteError.message }
  }

  return { ok: true, invoiceId, alreadyExisted: false }
}
