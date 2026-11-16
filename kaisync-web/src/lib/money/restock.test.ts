import { describe, expect, it } from 'vitest'
import { ago, suggestion } from '@/lib/money/restock'

describe('restock', () => {
  it('suggests ordering at a recent best price, else asking', () => {
    expect(suggestion({ best_supplier_id: 's', best_supplier_name: 'Apex', best_price: 640, price_old: false })).toEqual({ kind: 'order', label: 'Order from Apex' })
    expect(suggestion({ best_supplier_id: 's', best_supplier_name: 'Apex', best_price: 210, price_old: true }).label).toBe('Price is old: ask')
    expect(suggestion({ best_supplier_id: null, best_supplier_name: null, best_price: null, price_old: false }).kind).toBe('ask')
  })
  it('says how old a price is', () => {
    const now = new Date('2026-11-16T12:00:00Z').getTime()
    expect(ago('2026-11-07T12:00:00Z', now)).toBe('9 days ago')
    expect(ago('2026-10-26T12:00:00Z', now)).toBe('3 weeks ago')
    expect(ago('2026-06-16T12:00:00Z', now)).toBe('5 months ago')
  })
})
