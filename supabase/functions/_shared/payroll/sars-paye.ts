/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/payroll/sars-paye.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * SARS PAYE for the 2026/2027 tax year (1 March 2026 to 28 February 2027).
 * Source: SARS Budget tax guide 2026 and the employer employees' tax guide.
 * Annual brackets, then the age rebate, then a monthly amount.
 */

type Bracket = { limit: number; base: number; rate: number }

const ANNUAL_BRACKETS: Bracket[] = [
  { limit: 245_100, base: 0, rate: 0.18 },
  { limit: 383_100, base: 44_118, rate: 0.26 },
  { limit: 530_200, base: 79_998, rate: 0.31 },
  { limit: 695_800, base: 125_599, rate: 0.36 },
  { limit: 887_000, base: 185_215, rate: 0.39 },
  { limit: 1_878_600, base: 259_783, rate: 0.41 },
  { limit: Infinity, base: 666_339, rate: 0.45 },
]

const PRIMARY_REBATE_ANNUAL = 17_820
const SECONDARY_REBATE_ANNUAL = 9_765 // 65+
const TERTIARY_REBATE_ANNUAL = 3_249 // 75+

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function calculateAnnualTax(annualTaxable: number): number {
  if (annualTaxable <= 0) return 0

  let prevLimit = 0
  for (const { limit, base, rate } of ANNUAL_BRACKETS) {
    if (annualTaxable <= limit) return base + (annualTaxable - prevLimit) * rate
    prevLimit = limit
  }

  const last = ANNUAL_BRACKETS[ANNUAL_BRACKETS.length - 1]
  return last.base + (annualTaxable - 1_878_600) * last.rate
}

function rebatesFor(dateOfBirth?: string | null): number {
  if (!dateOfBirth) return PRIMARY_REBATE_ANNUAL
  const dobYear = Number(dateOfBirth.slice(0, 4))
  if (Number.isNaN(dobYear)) return PRIMARY_REBATE_ANNUAL
  const age = new Date().getFullYear() - dobYear
  if (age >= 75) return PRIMARY_REBATE_ANNUAL + SECONDARY_REBATE_ANNUAL + TERTIARY_REBATE_ANNUAL
  if (age >= 65) return PRIMARY_REBATE_ANNUAL + SECONDARY_REBATE_ANNUAL
  return PRIMARY_REBATE_ANNUAL
}

/** Annual income at which PAYE becomes payable (rebate ÷ first-bracket rate). 2026/27. */
export function annualTaxThreshold(dateOfBirth?: string | null): number {
  return Math.round((rebatesFor(dateOfBirth) / 0.18) * 100) / 100
}

/** True when a full year at this monthly amount is at or under the SARS tax threshold. */
export function isBelowAnnualTaxThreshold(monthlyTaxable: number, dateOfBirth?: string | null): boolean {
  if (monthlyTaxable <= 0) return true
  return monthlyTaxable * 12 <= annualTaxThreshold(dateOfBirth)
}

export function calculateMonthlyPaye(
  monthlyTaxableIncome: number,
  dateOfBirth?: string | null,
  directiveRatePercent?: number | null
): number {
  if (monthlyTaxableIncome <= 0) return 0

  if (directiveRatePercent && directiveRatePercent > 0) {
    return round2((monthlyTaxableIncome * directiveRatePercent) / 100)
  }

  const annual = monthlyTaxableIncome * 12
  let tax = calculateAnnualTax(annual)
  const rebate = rebatesFor(dateOfBirth)
  tax = Math.max(0, tax - rebate)
  return round2(tax / 12)
}
