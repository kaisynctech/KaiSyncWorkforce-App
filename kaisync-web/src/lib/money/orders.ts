/**
 * Orders: an accepted quote is an order. Everything done for it hangs off the quote:
 * invoices (quote_id) → payments (finance_transactions on the invoice) and credit notes (invoice_id);
 * RFQs and purchase orders (quote_id) → goods received (po_id) and supplier bills (po_id);
 * and, when the quote is for a job, contractor payouts on that job.
 * No separate order table: every accepted quote, old or new, is an order.
 */

export type OrderInvoice = {
  id: string; quote_id: string | null; invoice_number: string | null; status: string | null; currency: string | null
  subtotal: number | null; total_amount: number | null; amount_paid: number | null; balance_due: number | null
  issue_date: string | null; due_date: string | null
}

export type OrderState = 'to_invoice' | 'draft' | 'part_invoiced' | 'invoiced' | 'part_paid' | 'paid'

export const ORDER_STATE: Record<OrderState, { label: string; cls: string }> = {
  to_invoice: { label: 'To invoice', cls: 'bg-amber-100 text-amber-800' },
  draft: { label: 'Invoice draft', cls: 'bg-slate-100 text-slate-700' },
  part_invoiced: { label: 'Part invoiced', cls: 'bg-blue-100 text-blue-700' },
  invoiced: { label: 'Invoiced', cls: 'bg-blue-100 text-blue-700' },
  part_paid: { label: 'Part paid', cls: 'bg-purple-100 text-purple-700' },
  paid: { label: 'Paid', cls: 'bg-green-100 text-green-700' },
}

const LIVE = (s: string | null) => !['voided', 'cancelled'].includes(String(s ?? ''))
const SENT = (s: string | null) => LIVE(s) && String(s ?? '') !== 'draft'

export type OrderMoney = {
  /** Quote total incl. VAT. */
  value: number
  /** Sent invoices, incl. VAT. */
  invoiced: number
  paid: number
  owing: number
  /** Value still to invoice (incl. VAT), never below 0. */
  toInvoice: number
  hasDraft: boolean
  state: OrderState
}

/** Money on an order, from its quote total and its invoices (voided and cancelled ones don't count). */
export function orderMoney(quoteTotal: number, invoices: OrderInvoice[]): OrderMoney {
  const live = invoices.filter(i => LIVE(i.status))
  const sent = live.filter(i => SENT(i.status))
  const invoiced = sent.reduce((s, i) => s + (Number(i.total_amount) || 0), 0)
  const paid = sent.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0)
  const owing = sent.reduce((s, i) => s + (Number(i.balance_due) || 0), 0)
  const hasDraft = live.some(i => String(i.status) === 'draft')
  const value = Number(quoteTotal) || 0
  const toInvoice = Math.max(0, Math.round((value - invoiced) * 100) / 100)
  let state: OrderState
  if (sent.length === 0) state = hasDraft ? 'draft' : 'to_invoice'
  else if (toInvoice > 0.01) state = paid > 0.004 ? 'part_paid' : 'part_invoiced'
  else if (owing <= 0.01) state = 'paid'
  else state = paid > 0.004 ? 'part_paid' : 'invoiced'
  return { value, invoiced, paid, owing, toInvoice, hasDraft, state }
}
