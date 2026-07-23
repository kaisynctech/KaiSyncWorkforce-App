/** Deterministic finance math — mirrors KaiFlow.Finance VatCalculator / FinanceCalculationHelper. */

export type TaxType = 'standard' | 'zero_rated' | 'exempt' | 'no_vat'

export type PaymentState = 'unpaid' | 'partially_paid' | 'paid' | 'overdue'

export type VatResult = {
  subtotal: number
  vatRate: number
  vatAmount: number
  totalAmount: number
  isVatInclusive: boolean
  taxType: TaxType
}

export function roundFinancial(value: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round((value + Number.EPSILON) * f) / f // away-from-zero approx for money
}

export function normalizeRate(vatRate: number): number {
  if (vatRate < 0) throw new Error('VAT rate cannot be negative')
  return vatRate > 1 ? vatRate / 100 : vatRate
}

export function taxAppliesVat(taxType: TaxType): boolean {
  return taxType === 'standard'
}

export function effectiveRate(vatRate: number, taxType: TaxType = 'standard'): number {
  return taxAppliesVat(taxType) ? normalizeRate(vatRate) : 0
}

export function calculateVatExclusive(
  subtotal: number,
  vatRate: number,
  taxType: TaxType = 'standard',
): VatResult {
  const rate = effectiveRate(vatRate, taxType)
  const sub = roundFinancial(subtotal)
  const vat = roundFinancial(sub * rate)
  return {
    subtotal: sub,
    vatRate: rate,
    vatAmount: vat,
    totalAmount: roundFinancial(sub + vat),
    isVatInclusive: false,
    taxType,
  }
}

export function calculateVatInclusive(
  totalAmount: number,
  vatRate: number,
  taxType: TaxType = 'standard',
): VatResult {
  const rate = effectiveRate(vatRate, taxType)
  const total = roundFinancial(totalAmount)
  const sub = rate === 0 ? total : roundFinancial(total / (1 + rate))
  const vat = roundFinancial(total - sub)
  return {
    subtotal: sub,
    vatRate: rate,
    vatAmount: vat,
    totalAmount: total,
    isVatInclusive: true,
    taxType,
  }
}

export function calculateLine(
  quantity: number,
  unitPrice: number,
  vatRate: number,
  isVatInclusive: boolean,
  taxType: TaxType = 'standard',
): VatResult {
  const gross = roundFinancial(quantity * unitPrice)
  return isVatInclusive
    ? calculateVatInclusive(gross, vatRate, taxType)
    : calculateVatExclusive(gross, vatRate, taxType)
}

export function summariseLines(lines: VatResult[]) {
  let sub = 0
  let vat = 0
  let total = 0
  for (const l of lines) {
    sub += l.subtotal
    vat += l.vatAmount
    total += l.totalAmount
  }
  return {
    subtotal: roundFinancial(sub),
    vatAmount: roundFinancial(vat),
    totalAmount: roundFinancial(total),
  }
}

export function balanceDue(totalAmount: number, amountPaid: number): number {
  return roundFinancial(Math.max(0, totalAmount - amountPaid))
}

export function resolvePaymentState(
  totalAmount: number,
  amountPaid: number,
  dueDate?: string | null,
  asOf?: Date,
): PaymentState {
  const today = asOf ?? new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const bal = roundFinancial(totalAmount - amountPaid)
  const isOverdue = Boolean(dueDate && todayStr > dueDate && bal > 0)

  if (bal <= 0 && totalAmount > 0) return 'paid'
  if (amountPaid > 0 && bal > 0) return isOverdue ? 'overdue' : 'partially_paid'
  if (isOverdue) return 'overdue'
  return 'unpaid'
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return 'R —'
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
