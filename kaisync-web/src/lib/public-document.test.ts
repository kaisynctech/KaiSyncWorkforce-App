import { describe, expect, it } from 'vitest'
import { quoteWithChoices, type PublicQuoteView } from '@/lib/public-document'

const view = {
  doc: { subtotal: 10500, vat: 1575, total: 12075, vat_rate: 0.15, deposit: { pct: 50, amount: 6037.5 } } as PublicQuoteView['doc'],
  lines: [
    { id: 'a', description: 'Alternator', quantity: 2, unit: 'each', unit_sell_price: 2500, subtotal_sell: 5000, line_total: 5750 },
    { id: 'b', description: 'Pads', quantity: 4, unit: 'each', unit_sell_price: 1250, subtotal_sell: 5000, line_total: 5750 },
    { id: 'c', description: 'Contingency 5%', quantity: 1, unit: 'sum', unit_sell_price: 500, subtotal_sell: 500, line_total: 575, is_contingency: true },
  ],
  options: [{ id: 'a2', description: 'Alternator, reman', quantity: 2, unit: 'each', unit_sell_price: 1650, subtotal_sell: 3300, line_total: 3795, option_of: 'a' }],
}

describe('quoteWithChoices', () => {
  it('no choices: the quotation as sent', () => {
    const r = quoteWithChoices(view, {})
    expect(r.subtotal).toBe(10500)
    expect(r.total).toBe(12075)
    expect(r.deposit).toBe(6037.5)
  })
  it('a chosen option replaces its line; contingency, VAT and deposit follow', () => {
    const r = quoteWithChoices(view, { a: 'a2' })
    expect(r.lines.map(l => l.id)).toEqual(['a2', 'b', 'c'])
    expect(r.lines[2].subtotal_sell).toBe(415) // 5% of 8 300
    expect(r.subtotal).toBe(8715)
    expect(r.vat).toBe(1307.25)
    expect(r.total).toBe(10022.25)
    expect(r.deposit).toBe(5011.13)
  })
  it('ignores an option that is not for that line', () => {
    expect(quoteWithChoices(view, { b: 'a2' }).subtotal).toBe(10500)
  })
})
