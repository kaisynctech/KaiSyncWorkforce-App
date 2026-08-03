import { describe, expect, it } from 'vitest'
import { calculateAnnualTax, calculateMonthlyPaye } from './sars-paye'

describe('calculateAnnualTax', () => {
  it('applies the first bracket rate from zero', () => {
    expect(calculateAnnualTax(100_000)).toBeCloseTo(18_000, 2)
  })

  it('applies bracket base + marginal rate above the first threshold', () => {
    expect(calculateAnnualTax(300_000)).toBeCloseTo(42_678 + (300_000 - 237_100) * 0.26, 2)
  })

  it('applies the top marginal rate above the highest bracket', () => {
    expect(calculateAnnualTax(2_000_000)).toBeCloseTo(956_793 + (2_000_000 - 1_817_000) * 0.45, 2)
  })

  it('returns 0 for non-positive income', () => {
    expect(calculateAnnualTax(0)).toBe(0)
    expect(calculateAnnualTax(-500)).toBe(0)
  })
})

describe('calculateMonthlyPaye', () => {
  it('applies the primary rebate with no date of birth', () => {
    const monthly = 30_000
    const annualTax = calculateAnnualTax(monthly * 12)
    const expected = Math.round(Math.max(0, annualTax - 17_235) / 12 * 100) / 100
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
