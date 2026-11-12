import { formatCurrency } from '@/lib/currencies'
/** Quotation display helpers */

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

/** Amounts in their own currencies, e.g. "R43 283,13 + €1 150,00" (rand alone shows as before). */
export function moneyMixed(rows: { amount: number; currency?: string | null }[]): string {
  const by = new Map<string, number>()
  for (const r of rows) {
    const c = (r.currency || 'ZAR').toUpperCase()
    by.set(c, (by.get(c) ?? 0) + (Number(r.amount) || 0))
  }
  if (by.size === 0) return moneyZAR(0)
  return [...by.entries()]
    .sort(([a], [b]) => (a === 'ZAR' ? -1 : b === 'ZAR' ? 1 : a.localeCompare(b)))
    .map(([c, n]) => (c === 'ZAR' ? moneyZAR(n) : formatCurrency(n, c)))
    .join(' + ')
}
