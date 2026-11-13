import { describe, expect, it } from 'vitest'
import { BUSINESS_TYPES } from '@/lib/business-types'
import { ALL_FEATURES, ALL_HEADERS, templateFromBusinessType } from '@/lib/quote-templates'

describe('templateFromBusinessType', () => {
  it('makes a starting template for every business type', () => {
    for (const b of BUSINESS_TYPES) {
      const t = templateFromBusinessType(b.key)!
      expect(t.name).toBe(b.quote.templateName)
      expect(t.business_type).toBe(b.key)
      expect(t.features.every(f => ALL_FEATURES.includes(f))).toBe(true)
      expect(t.header_fields.every(h => ALL_HEADERS.includes(h))).toBe(true)
      expect(t.columns.map(c => c.key)).toEqual(b.quote.columns)
      expect(t.defaults.valid_days).toBe(b.quote.validDays)
    }
  })
  it('keeps cost and margin for the team only', () => {
    const t = templateFromBusinessType('parts_supply')!
    expect(t.columns.find(c => c.key === 'cost')?.team_only).toBe(true)
    expect(t.columns.find(c => c.key === 'margin')?.team_only).toBe(true)
    expect(t.columns.find(c => c.key === 'price')?.team_only).toBe(false)
    expect(t.defaults.margin_pct).toBe(20)
  })
  it('returns null for an unknown type', () => {
    expect(templateFromBusinessType('nope')).toBeNull()
  })
})
