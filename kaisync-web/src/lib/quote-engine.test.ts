import { describe, expect, it } from 'vitest'
import {
  contingencyAmount, engineLineTotal, orderedForDisplay, qtyFromDays, quoteTotals, withContingency, type EngineLine,
} from '@/lib/quote-engine'

const L = (key: string, qty: number, unitPrice: number, more: Partial<EngineLine> = {}): EngineLine =>
  ({ key, description: key, qty, unitPrice, ...more })

describe('quote engine', () => {
  it('line total applies the discount', () => {
    expect(engineLineTotal({ qty: 4, unitPrice: 850, discountPct: 10 })).toBe(3060)
  })

  it('options are shown but never counted', () => {
    const lines = [L('alt', 2, 2500, { unitCost: 1980 }), L('reman', 2, 1650, { optionOf: 'alt' }), L('pads', 4, 850)]
    const t = quoteTotals(lines, { vatOn: true, vatRate: 0.15 })
    expect(t.subtotal).toBe(8400)
    expect(t.vat).toBe(1260)
    expect(t.total).toBe(9660)
    expect(t.optionsCount).toBe(1)
    expect(t.cost).toBe(3960)
  })

  it('board C: makeup artist, no VAT, 50% deposit', () => {
    const lines = [L('bridal', 1, 2500), L('maids', 4, 1200), L('travel', 1, 500), L('touch', 1, 800)]
    const t = quoteTotals(lines, { vatOn: false, vatRate: 0.15, depositPct: 50 })
    expect(t.total).toBe(8600)
    expect(t.deposit).toBe(4300)
  })

  it('board E: contingency 5% on the phases', () => {
    const base = [L('a', 100, 150, { section: 'Earthworks' }), L('b', 30, 2200, { section: 'Concrete' }), L('c', 200, 350, { section: 'Concrete' }),
      L('d', 15, 1200, { section: 'Concrete' }), L('e', 1, 25000, { section: 'Electrical' })]
    expect(contingencyAmount(base, 5)).toBe(9700)
    const withC = withContingency(base, 5, (amount, label) => L('cont', 1, amount, { description: label, isContingency: true }))
    expect(withC).toHaveLength(6)
    expect(withC[5].description).toBe('Contingency 5%')
    const t = quoteTotals(withC, { vatOn: true, vatRate: 0.15 })
    expect(t.subtotal).toBe(203700)
    expect(t.vat).toBe(30555)
    expect(t.total).toBe(234255)
    expect(t.contingency).toBe(9700)
    // Changing a line keeps it in step; 0% removes it.
    const again = withContingency([...withC.slice(0, 4), L('e', 1, 35000, { section: 'Electrical' }), withC[5]], 5, () => { throw new Error('should reuse') })
    expect(again[5].unitPrice).toBe(10200)
    expect(withContingency(withC, 0, () => { throw new Error('no') })).toHaveLength(5)
  })

  it('monthly lines count once and show their own total', () => {
    const t = quoteTotals([L('setup', 1, 3000), L('care', 1, 1200, { recurring: 'month' }), L('opt', 1, 900, { recurring: 'month', optionOf: 'care' })],
      { vatOn: false, vatRate: 0 })
    expect(t.total).toBe(4200)
    expect(t.recurring).toEqual({ month: 1200 })
  })

  it('groups lines by section with options after their line and contingency last', () => {
    const lines = [L('c', 1, 1, { isContingency: true }), L('a', 1, 1, { section: 'P1' }), L('x', 1, 1), L('a2', 1, 1, { optionOf: 'a' }), L('b', 1, 1, { section: 'P2' })]
    const g = orderedForDisplay(lines)
    expect(g.map(x => x.section)).toEqual(['P1', null, 'P2'])
    expect(g[0].lines.map(l => l.key)).toEqual(['a', 'a2'])
    expect(g[1].lines.map(l => l.key)).toEqual(['x', 'c'])
  })

  it('hire: units × days', () => {
    expect(qtyFromDays(2, 3)).toBe(6)
    expect(qtyFromDays(2, null)).toBe(2)
  })
})
