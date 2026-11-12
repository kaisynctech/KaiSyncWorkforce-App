import { describe, expect, it } from 'vitest'
import { orderMoney, type OrderInvoice } from './orders'

const inv = (p: Partial<OrderInvoice>): OrderInvoice => ({
  id: 'i', quote_id: 'q', invoice_number: null, status: 'sent', currency: 'ZAR', subtotal: 0,
  total_amount: 0, amount_paid: 0, balance_due: 0, issue_date: null, due_date: null, ...p,
})

describe('orderMoney', () => {
  it('nothing invoiced yet', () => {
    expect(orderMoney(1150, []).state).toBe('to_invoice')
    expect(orderMoney(1150, [inv({ status: 'draft', total_amount: 1150, balance_due: 1150 })]).state).toBe('draft')
  })
  it('voided invoices do not count', () => {
    expect(orderMoney(1150, [inv({ status: 'voided', total_amount: 1150 })]).state).toBe('to_invoice')
  })
  it('invoiced, part paid, paid', () => {
    expect(orderMoney(4025, [inv({ total_amount: 4025, balance_due: 4025 })]).state).toBe('invoiced')
    const part = orderMoney(4025, [inv({ status: 'partially_paid', total_amount: 4025, amount_paid: 1000, balance_due: 3025 })])
    expect(part.state).toBe('part_paid'); expect(part.owing).toBe(3025)
    expect(orderMoney(4025, [inv({ status: 'paid', total_amount: 4025, amount_paid: 4025, balance_due: 0 })]).state).toBe('paid')
  })
  it('a deposit invoice leaves the rest to invoice', () => {
    const m = orderMoney(10000, [inv({ total_amount: 5000, balance_due: 5000 })])
    expect(m.state).toBe('part_invoiced'); expect(m.toInvoice).toBe(5000)
  })
})
