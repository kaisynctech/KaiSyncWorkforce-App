import { describe, expect, it } from 'vitest'
import { annualTaxThreshold, calculateAnnualTax, calculateMonthlyPaye, deductibleRetirementMonthly, isBelowAnnualTaxThreshold, medicalTaxCreditMonthly } from './sars-paye'

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

describe('pension and medical aid (2026/27, added 23 Oct 2026)', () => {
  it('Ironvale foreman: R32,500, R1,200 pension, medical aid with no dependants', () => {
    expect(calculateMonthlyPaye(32_500, null, null)).toBe(5359.75)
    expect(calculateMonthlyPaye(32_500, null, null, { retirementFundMonthly: 1200 })).toBe(5019)
    expect(calculateMonthlyPaye(32_500, null, null, { retirementFundMonthly: 1200, medicalAidMonthly: 1850 })).toBe(4643)
  })
  it('medical credits: R376 main, R376 first dependant, R254 each further dependant', () => {
    expect(medicalTaxCreditMonthly(0, 3)).toBe(0)
    expect(medicalTaxCreditMonthly(1500, 0)).toBe(376)
    expect(medicalTaxCreditMonthly(1500, 1)).toBe(752)
    expect(medicalTaxCreditMonthly(1500, 3)).toBe(1260)
  })
  it('retirement deduction is capped at 27.5% of pay', () => {
    expect(deductibleRetirementMonthly(10_000, 5_000)).toBe(2750)
    expect(deductibleRetirementMonthly(10_000, 500)).toBe(500)
  })
  it('credits never make PAYE negative', () => {
    expect(calculateMonthlyPaye(9_000, null, null, { medicalAidMonthly: 2000, medicalAidDependants: 4 })).toBe(0)
  })
  it('a tax directive still overrides everything', () => {
    expect(calculateMonthlyPaye(20_000, null, 25, { retirementFundMonthly: 2000, medicalAidMonthly: 1000 })).toBe(5000)
  })
})
