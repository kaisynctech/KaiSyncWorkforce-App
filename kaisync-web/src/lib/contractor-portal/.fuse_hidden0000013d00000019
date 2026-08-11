/**
 * Contractor quote helpers — filters, labels, client-side totals (MAUI parity).
 */

import type {
  ContractorQuote,
  QuoteLineDraft,
  QuoteTotals,
  QuoteVatMode,
} from './types'

export const QUOTE_FILTERS = ['All', 'Drafts', 'Active', 'Approved', 'Rejected', 'Expired'] as const
export type QuoteFilter = (typeof QUOTE_FILTERS)[number]

export const VAT_MODE_OPTIONS: { label: string; value: QuoteVatMode }[] = [
  { label: 'None', value: 'none' },
  { label: 'VAT Exclusive', value: 'exclusive' },
  { label: 'VAT Inclusive', value: 'inclusive' },
]

export function quoteStatusLabel(status: string): string {
  switch ((status || '').toLowerCase()) {
    case 'draft': return 'Draft'
    case 'submitted': return 'Submitted'
    case 'under_review': return 'Under review'
    case 'revision_requested': return 'Revision requested'
    case 'approved': return 'Approved'
    case 'rejected': return 'Rejected'
    case 'converted': return 'Converted'
    case 'expired': return 'Expired'
    default: return status || '—'
  }
}

export function quoteCanEdit(q: ContractorQuote): boolean {
  return q.status === 'draft' || q.status === 'revision_requested'
}

export function quoteCanResubmit(q: ContractorQuote): boolean {
  return q.status === 'revision_requested'
}

export function quoteIsDraft(q: ContractorQuote): boolean {
  return q.status === 'draft'
}

export function filterQuotes(quotes: ContractorQuote[], filter: QuoteFilter): ContractorQuote[] {
  switch (filter) {
    case 'Drafts':
      return quotes.filter(q => q.status === 'draft')
    case 'Active':
      return quotes.filter(q =>
        q.status === 'submitted' || q.status === 'under_review' || q.status === 'revision_requested')
    case 'Approved':
      return quotes.filter(q => q.status === 'approved' || q.status === 'converted')
    case 'Rejected':
      return quotes.filter(q => q.status === 'rejected')
    case 'Expired':
      return quotes.filter(q => q.status === 'expired')
    default:
      return quotes
  }
}

export function lineSubtotal(row: QuoteLineDraft): number {
  const qty = Number(row.quantity) || 0
  const price = Number(row.unit_price) || 0
  const disc = Number(row.discount_amount) || 0
  return Math.max(0, qty * price - disc)
}

/** Mirrors MAUI Create* totals / _cq_compute_totals order. */
export function computeQuoteTotals(input: {
  lines: QuoteLineDraft[]
  discount: number
  freight: number
  duty: number
  levies: number
  otherCharges: number
  vatMode: QuoteVatMode
  vatRate: number
}): QuoteTotals {
  const line_subtotal = input.lines.reduce((s, r) => s + lineSubtotal(r), 0)
  const after_discount = line_subtotal - (Number(input.discount) || 0)
  const charges = (Number(input.freight) || 0)
    + (Number(input.duty) || 0)
    + (Number(input.levies) || 0)
    + (Number(input.otherCharges) || 0)
  const taxable = after_discount + charges
  const rate = Number(input.vatRate) || 0
  let vat_amount = 0
  if (input.vatMode === 'exclusive') {
    vat_amount = Math.round(taxable * rate * 100) / 100
  } else if (input.vatMode === 'inclusive') {
    vat_amount = Math.round((taxable * rate / (1 + rate)) * 100) / 100
  }
  const grand_total = input.vatMode === 'exclusive' ? taxable + vat_amount : taxable
  return {
    line_subtotal,
    after_discount,
    charges,
    taxable,
    vat_amount,
    grand_total,
  }
}

/** Upload-mode totals: base amount instead of line items. */
export function computeUploadTotals(input: {
  baseAmount: number
  discount: number
  freight: number
  duty: number
  levies: number
  otherCharges: number
  vatMode: QuoteVatMode
  vatRate: number
}): QuoteTotals {
  const line_subtotal = Number(input.baseAmount) || 0
  return computeQuoteTotals({
    lines: [{ description: '', quantity: 1, unit_price: line_subtotal, discount_amount: 0 }],
    discount: input.discount,
    freight: input.freight,
    duty: input.duty,
    levies: input.levies,
    otherCharges: input.otherCharges,
    vatMode: input.vatMode,
    vatRate: input.vatRate,
  })
}

export function emptyLine(): QuoteLineDraft {
  return { description: '', quantity: 1, unit_price: 0, discount_amount: 0 }
}

export function fmtMoney(n: number): string {
  return `R${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtQuoteDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}
