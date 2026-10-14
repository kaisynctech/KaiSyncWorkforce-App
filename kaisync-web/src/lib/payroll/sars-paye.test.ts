import { describe, expect, it } from 'vitest'
import { annualTaxThreshold, calculateAnnualTax, calculateMonthlyPaye, isBelowAnnualTaxThreshold } from './sars-paye'

describe('calculateAnnualTax', () => {
  it('applies the first bracket rate from zero', () => {
    expect(calculateAnnualTax(100_000)).toBeCloseTo(18_000, 2)
  })

  it('applies bracket base + marginal rate above the first threshold', () => {
    expect(calculateAnnualTax(300_000)).toBeCloseTo(44_118 + (300_000 - 245_100) * 0.26, 2)
  })

  it('applies the top marginal rate above the highest bracket', () => {
    expect(calculateAnnualTax(2_000_000)).toBeCloseTo(666_339 + (2_000_000 - 1_878_600) * 0.45, 2)
  })

  it('returns 0 for non-positive income', () => {
    expect(calculateAnnualTax(0)).toBe(0)
    expect(calculateAnnualTax(-500)).toBe(0)
  })
})

describe('annualTaxThreshold', () => {
  it('is the 2026/27 under-65 threshold', () => {
    expect(annualTaxThreshold()).toBe(99_000)
  })

  it('treats R4,000 a month as below the threshold', () => {
    expect(isBelowAnnualTaxThreshold(4_000)).toBe(true)
    expect(calculateMonthlyPaye(4_000)).toBe(0)
  })
})

describe('calculateMonthlyPaye', () => {
  it('applies the primary rebate with no date of birth', () => {
    const monthly = 30_000
    const annualTax = calculateAnnualTax(monthly * 12)
    const expected = Math.round(Math.max(0, annualTax - 17_820) / 12 * 100) / 100
    expect(calculateMonthlyPaye(monthly)).toBeCloseTo(expected, 2)
  })

  it('applies secondary rebate for employees 65 or older', () => {
    const youngerDob = `${new Date().getFullYear() - 40}-01-01`
    const olderDob = `${new Date().getFullYear() - 70}-01-01`
    const payeYounger = calculateMonthlyPaye(30_000, youngerDob)
    const payeOlder = calculateMonthlyPaye(30_000, olderDob)
    expect(payeOlder).toBeLessThan(payeYounger)
  })

  it('uses a tax directive rate when provided, bypassing brackets', () => {
    expect(calculateMonthlyPaye(30_000, null, 10)).toBeCloseTo(3_000, 2)
  })

  it('returns 0 for non-positive income', () => {
    expect(calculateMonthlyPaye(0)).toBe(0)
  })
})
