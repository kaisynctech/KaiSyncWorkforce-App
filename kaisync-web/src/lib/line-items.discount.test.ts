import { describe, expect, it } from 'vitest'
import { lineMarginPct, lineTotal, linesProfit, priceForMargin } from './line-items'

describe('quote line discount and margin', () => {
  it('takes the discount off the line total', () => {
    expect(lineTotal({ type: 'custom', qty: 2, unitPrice: 100, discountPct: 10 })).toBe(180)
    expect(lineTotal({ type: 'custom', qty: 2, unitPrice: 100 })).toBe(200)
  })
  it('works out margin on the price after discount', () => {
    expect(lineMarginPct({ unitPrice: 1000, unitCost: 650 })).toBeCloseTo(35)
    expect(lineMarginPct({ unitPrice: 1000, unitCost: 650, discountPct: 10 })).toBeCloseTo((900 - 650) / 900 * 100)
    expect(lineMarginPct({ unitPrice: 1000 })).toBeNull()
  })
  it('sets the selling price from a margin', () => {
    expect(priceForMargin(650, 35, 0)).toBe(1000)
    const p = priceForMargin(650, 35, 10)!
    expect(lineMarginPct({ unitPrice: p, unitCost: 650, discountPct: 10 })).toBeCloseTo(35, 1)
    expect(priceForMargin(0, 35, 0)).toBeNull()
    expect(priceForMargin(100, 100, 0)).toBeNull()
  })
  it('totals cost and margin with discounts', () => {
    const r = linesProfit([
      { type: 'custom', qty: 1, unitPrice: 1000, unitCost: 650 },
      { type: 'custom', qty: 1, unitPrice: 300, unitCost: 200, discountPct: 50 },
    ])
    expect(r.sell).toBe(1150)
    expect(r.cost).toBe(850)
  })
})
