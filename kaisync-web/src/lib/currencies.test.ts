import { describe, expect, it } from 'vitest'
import { currencyOptions, currencySymbol, formatCurrency } from './currencies'
import { fmtMoney } from './finance-calc'

const clean = (s: string) => s.replace(/\s/g, ' ')

describe('currencies', () => {
  it('lists many world currencies, ZAR first, no historic ones', () => {
    const list = currencyOptions()
    expect(list[0].code).toBe('ZAR')
    expect(list.length).toBeGreaterThan(100)
    expect(list.some(c => c.code === 'USD' && /dollar/i.test(c.name))).toBe(true)
    expect(list.some(c => /\(\d{4}/.test(c.name))).toBe(false)
  })
  it('keeps rand exactly as before', () => {
    expect(clean(fmtMoney(1250))).toBe('R 1 250,00')
    expect(clean(fmtMoney(1250, 'ZAR'))).toBe('R 1 250,00')
    expect(fmtMoney(null)).toBe('R —')
  })
  it('formats other currencies with their narrow symbol (not the ISO code)', () => {
    expect(clean(formatCurrency(1250, 'USD'))).toMatch(/^\$/)
    expect(clean(formatCurrency(1250, 'USD'))).not.toContain('USD')
    expect(clean(formatCurrency(1250, 'EUR'))).toContain('€')
    expect(clean(formatCurrency(1250, 'GBP'))).toContain('£')
  })
  it('exposes narrow symbols for price inputs', () => {
    expect(currencySymbol('ZAR')).toBe('R')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
  })
})
