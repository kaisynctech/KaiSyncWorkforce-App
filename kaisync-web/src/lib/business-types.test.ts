import { describe, expect, it } from 'vitest'
import { BUSINESS_TYPES, businessType, combinedSetup } from './business-types'

describe('business types', () => {
  it('has 17 types with unique keys and a starting template each', () => {
    expect(BUSINESS_TYPES).toHaveLength(17)
    expect(new Set(BUSINESS_TYPES.map(t => t.key)).size).toBe(17)
    for (const t of BUSINESS_TYPES) {
      expect(t.quote.templateName.length).toBeGreaterThan(0)
      expect(t.quote.columns.length).toBeGreaterThan(0)
      expect(t.catalogue.length).toBeGreaterThan(0)
    }
  })
  it('finds a type by key and nothing for an unknown key', () => {
    expect(businessType('parts_supply')?.label).toBe('Parts supply')
    expect(businessType('nope')).toBeNull()
    expect(businessType(null)).toBeNull()
  })
  it('combines several types without duplicates, main type first', () => {
    const c = combinedSetup(['beauty_events', 'trades', 'unknown'])
    expect(c.types.map(t => t.key)).toEqual(['beauty_events', 'trades'])
    expect(c.templates[0].businessType).toBe('beauty_events')
    expect(c.catalogue.filter(k => k === 'service')).toHaveLength(1)
    expect(c.askSuppliers).toBe(true)
  })
})
