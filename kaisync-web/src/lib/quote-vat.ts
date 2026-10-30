/** Office quote VAT. Prices stay exclusive. The rate is the company's saved rate. */

export type QuoteVatChoice = {
  vatOn: boolean
  /** Rate used when VAT is on, for example 0.15. */
  vatRate: number
}

export function normaliseVatRate(rate: number | null | undefined): number {
  const n = Number(rate)
  if (!Number.isFinite(n) || n <= 0) return 0.15
  if (n > 1) return n / 100
  return n
}

export function companyQuoteVat(input: {
  isVatRegistered: boolean | null | undefined
  defaultVatRate: number | null | undefined
}): QuoteVatChoice {
  const vatRate = normaliseVatRate(input.defaultVatRate)
  return {
    vatOn: input.isVatRegistered !== false && vatRate > 0,
    vatRate,
  }
}

/** Saved lines win. A positive line rate means VAT was on at that rate. */
export function loadedQuoteVat(input: {
  lineRates: number[]
  subtotal: number
  company: QuoteVatChoice
}): QuoteVatChoice {
  const positive = input.lineRates.map(Number).find(rate => Number.isFinite(rate) && rate > 0)
  if (positive) return { vatOn: true, vatRate: positive }
  if (input.lineRates.length > 0 || input.subtotal > 0) {
    return { vatOn: false, vatRate: input.company.vatRate }
  }
  return input.company
}

export function quoteMoney(subtotal: number, vatOn: boolean, vatRate: number) {
  const rate = vatOn ? vatRate : 0
  const vat = subtotal * rate
  return { subtotal, vatRate: rate, vat, total: subtotal + vat }
}

export function vatPercentLabel(rate: number): string {
  const pct = Math.round(rate * 10000) / 100
  return Number.isInteger(pct) ? String(pct) : String(pct)
}
