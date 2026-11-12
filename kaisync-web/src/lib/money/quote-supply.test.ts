import { describe, expect, it } from 'vitest'
import { defaultSupplyMode, priceAfterChoice, supplyModeOf } from './quote-supply'
import { chargesVat, costExVat, asks } from './buyout'

describe('supply mode', () => {
  it('takes stock items from stock when there is enough', () => {
    expect(defaultSupplyMode('inventory', 4, 12)).toBe('stock')
    expect(defaultSupplyMode('inventory', 6, 2)).toBe('outsource')
    expect(defaultSupplyMode('catalogue', 1, null)).toBe('outsource')
    expect(defaultSupplyMode('service', 1, null)).toBe('service')
    expect(defaultSupplyMode('custom', 1, null)).toBe('service')
  })
  it('keeps what the office chose', () => {
    expect(supplyModeOf('outsource', 'inventory', 1, 50)).toBe('outsource')
    expect(supplyModeOf('stock', 'custom', 1, null)).toBe('outsource')
    expect(supplyModeOf(null, 'inventory', 1, 50)).toBe('stock')
  })
})

describe('price after choosing a supplier', () => {
  it('keeps the margin', () => {
    // 25% margin on cost 100 → 133.33; new cost 120 → 160
    expect(priceAfterChoice({ cost: 120, prevCost: 100, prevPrice: 133.33, discountPct: 0, keep: 'margin', defaultMarginPct: 30 })).toBeCloseTo(160, 1)
  })
  it('uses the default margin when the line had none', () => {
    expect(priceAfterChoice({ cost: 5120, prevCost: null, prevPrice: 0, discountPct: 0, keep: 'margin', defaultMarginPct: 25 })).toBe(6826.67)
  })
  it('keeps the selling price', () => {
    expect(priceAfterChoice({ cost: 90, prevCost: 100, prevPrice: 150, discountPct: 0, keep: 'price', defaultMarginPct: 25 })).toBe(150)
  })
})

describe('buyout helpers', () => {
  it('takes VAT off prices that include it', () => {
    expect(costExVat(115, 'incl')).toBe(100)
    expect(costExVat(100, 'excl')).toBe(100)
    expect(costExVat(100, 'none')).toBe(100)
  })
  it('works out whether the supplier adds VAT', () => {
    expect(chargesVat({ chargesVat: null, pricesIncludeVat: 'none', isVatRegistered: true })).toBe(false)
    expect(chargesVat({ chargesVat: null, pricesIncludeVat: null, isVatRegistered: false })).toBe(false)
    expect(chargesVat({ chargesVat: null, pricesIncludeVat: 'excl', isVatRegistered: null })).toBe(true)
    expect(chargesVat({ chargesVat: false, pricesIncludeVat: 'excl', isVatRegistered: true })).toBe(false)
  })
  it('asks a supplier for all items unless some were ticked', () => {
    expect(asks({ lineIds: null }, 'a')).toBe(true)
    expect(asks({ lineIds: ['b'] }, 'a')).toBe(false)
  })
})
