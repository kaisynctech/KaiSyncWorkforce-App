/** Quotation display helpers — MAUI ProjectQuotationDisplay. */

import type { QuotationLine } from './types'

export const SUMMARY_LINE = 'Total agreed amount'

export function isSummaryLine(description: string | null | undefined): boolean {
  return (description ?? '').trim().toLowerCase() === SUMMARY_LINE.toLowerCase()
}

export function clientQuotationLines(lines: QuotationLine[]): QuotationLine[] {
  return [...lines]
    .filter(l => !isSummaryLine(l.description))
    .sort((a, b) => a.line_no - b.line_no)
}

export function lineTotal(l: QuotationLine): number {
  return (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
}

export function clientQuotationTotal(offerAmount: number, lines: QuotationLine[]): number {
  if (offerAmount > 0) return offerAmount
  return clientQuotationLines(lines).reduce((s, l) => s + lineTotal(l), 0)
}

export function moneyZAR(n: number): string {
  return `R${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
