import { describe, expect, it } from 'vitest'
import { companyQuoteVat, loadedQuoteVat, quoteMoney, vatPercentLabel } from '@/lib/quote-vat'

describe('office quote VAT', () => {
  it('uses the company rate when the company is VAT registered', () => {
    expect(companyQuoteVat({ isVatRegistered: true, defaultVatRate: 0.15 })).toEqual({
      vatOn: true,
      vatRate: 0.15,
    })
    expect(quoteMoney(1000, true, 0.15)).toEqual({
      subtotal: 1000,
      vatRate: 0.15,
      vat: 150,
      total: 1150,
    })
    expect(vatPercentLabel(0.15)).toBe('15')
  })

  it('stores no VAT when switched off, and keeps a saved zero-VAT quote off', () => {
    expect(quoteMoney(1000, false, 0.15)).toEqual({
      subtotal: 1000,
      vatRate: 0,
      vat: 0,
      total: 1000,
    })
    expect(loadedQuoteVat({
      lineRates: [0, 0],
      subtotal: 1000,
      company: { vatOn: true, vatRate: 0.15 },
    })).toEqual({ vatOn: false, vatRate: 0.15 })
  })

  it('keeps an existing 15% quote on even if the company is not registered', () => {
    expect(loadedQuoteVat({
      lineRates: [0.15],
      subtotal: 200,
      company: companyQuoteVat({ isVatRegistered: false, defaultVatRate: 0.15 }),
    })).toEqual({ vatOn: true, vatRate: 0.15 })
  })
})
