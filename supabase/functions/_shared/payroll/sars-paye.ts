/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/payroll/sars-paye.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * Ports KaiFlow.Payroll/SarsPayeCalculator.cs.
 * Simplified SA PAYE for 2025/2026 tax year (annual brackets, monthly conversion).
 * Use when policy.statutory.useSarsTaxTables is true.
 */

type Bracket = { limit: number; base: number; rate: number }

const ANNUAL_BRACKETS: Bracket[] = [
  { limit: 237_100, base: 0, rate: 0.18 },
  { limit: 370_500, base: 42_678, rate: 0.26 },
  { limit: 512_800, base: 77_362, rate: 0.31 },
  { limit: 673_000, base: 121_475, rate: 0.36 },
  { limit: 857_900, base: 179_147, rate: 0.39 },
  { limit: 1_817_000, base: 563_562, rate: 0.41 },
  { limit: Infinity, base: 956_793, rate: 0.45 },
]

const PRIMARY_REBATE_ANNUAL = 17_235
const SECONDARY_REBATE_ANNUAL = 9_444 // 65+
const TERTIARY_REBATE_ANNUAL = 3_145 // 75+

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
  return last.base + (annualTaxable - 1_817_000) * last.rate
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
