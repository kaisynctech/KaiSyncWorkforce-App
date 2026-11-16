/**
 * The quotation engine (piece 7): one set of rules for every industry. A template (lib/quote-templates.ts) decides
 * what shows; these rules decide what counts.
 *
 * - Options (option_of set) are shown but never counted: they are saved with is_excluded = true until the client
 *   chooses one (piece 8), so invoices, orders and reports never see them.
 * - Contingency is a normal line ("Contingency 5%") worked out from the counted lines, so everything downstream
 *   adds up without knowing about it.
 * - Monthly / weekly / yearly lines count once in the total (the first period) and are also shown as their own
 *   "every month" total.
 * - Days (hire): quantity on the quotation = units × days; the units and days are kept in the line's extra fields.
 */

export type RecurringPeriod = 'week' | 'month' | 'year'

export type EngineLine = {
  key: string
  description: string
  /** Quantity saved on the quotation (units × days when the line has days). */
  qty: number
  unitPrice: number
  discountPct?: number | null
  unitCost?: number | null
  section?: string | null
  /** Key of the line this one is an option for. */
  optionOf?: string | null
  recurring?: RecurringPeriod | null
  /** The contingency line the engine keeps up to date. */
  isContingency?: boolean
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function engineLineTotal(l: Pick<EngineLine, 'qty' | 'unitPrice' | 'discountPct'>): number {
  const d = Math.min(100, Math.max(0, Number(l.discountPct) || 0)) / 100
  return r2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * (1 - d))
}

/** Lines that count towards the total (no options; contingency included). */
export function countedLines<T extends EngineLine>(lines: T[]): T[] {
  return lines.filter(l => !l.optionOf)
}

/** The amount contingency adds: a % of everything counted except contingency itself. */
export function contingencyAmount(lines: EngineLine[], pct: number): number {
  const p = Math.min(100, Math.max(0, Number(pct) || 0))
  if (!p) return 0
  const base = countedLines(lines).filter(l => !l.isContingency).reduce((s, l) => s + engineLineTotal(l), 0)
  return r2((base * p) / 100)
}

export function contingencyLabel(pct: number): string {
  return `Contingency ${Math.round((Number(pct) || 0) * 100) / 100}%`
}

/**
 * Keeps the contingency line in step: added at the end when there is a %, updated when lines change, removed at 0.
 * `make` builds a new line in the caller's shape.
 */
export function withContingency<T extends EngineLine>(lines: T[], pct: number, make: (amount: number, label: string) => T): T[] {
  const rest = lines.filter(l => !l.isContingency)
  const existing = lines.find(l => l.isContingency)
  const amount = contingencyAmount(rest, pct)
  if (!(Number(pct) > 0)) return rest
  const label = contingencyLabel(pct)
  const line = existing ? { ...existing, description: label, qty: 1, unitPrice: amount, discountPct: 0 } : make(amount, label)
  return [...rest, line]
}

export type QuoteTotals = {
  subtotal: number
  vat: number
  total: number
  /** Every-period amounts (counted lines only), excl. VAT. */
  recurring: Partial<Record<RecurringPeriod, number>>
  contingency: number
  /** Options shown to the client, not counted. */
  optionsCount: number
  deposit: number
  cost: number
  profit: number
  marginPct: number
}

export function quoteTotals(lines: EngineLine[], opts: { vatOn: boolean; vatRate: number; depositPct?: number | null }): QuoteTotals {
  const counted = countedLines(lines)
  const subtotal = r2(counted.reduce((s, l) => s + engineLineTotal(l), 0))
  const rate = opts.vatOn ? Number(opts.vatRate) || 0 : 0
  const vat = r2(subtotal * rate)
  const total = r2(subtotal + vat)
  const recurring: Partial<Record<RecurringPeriod, number>> = {}
  for (const l of counted) {
    if (!l.recurring) continue
    recurring[l.recurring] = r2((recurring[l.recurring] ?? 0) + engineLineTotal(l))
  }
  const cost = r2(counted.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0))
  const profit = r2(subtotal - cost)
  const dp = Math.min(100, Math.max(0, Number(opts.depositPct) || 0))
  return {
    subtotal, vat, total, recurring,
    contingency: r2(counted.filter(l => l.isContingency).reduce((s, l) => s + engineLineTotal(l), 0)),
    optionsCount: lines.length - counted.length,
    deposit: r2((total * dp) / 100),
    cost, profit, marginPct: subtotal > 0 ? (profit / subtotal) * 100 : 0,
  }
}

/** Lines in the order they print: each section together (in order of first appearance), each option after its line. */
export function orderedForDisplay<T extends EngineLine>(lines: T[]): { section: string | null; lines: T[] }[] {
  const mains = lines.filter(l => !l.optionOf)
  const optionsBy = new Map<string, T[]>()
  for (const l of lines) if (l.optionOf) optionsBy.set(l.optionOf, [...(optionsBy.get(l.optionOf) ?? []), l])
  const groups: { section: string | null; lines: T[] }[] = []
  const pushTo = (section: string | null, l: T) => {
    let g = groups.find(x => x.section === section)
    if (!g) { g = { section, lines: [] }; groups.push(g) }
    g.lines.push(l, ...(optionsBy.get(l.key) ?? []))
  }
  // Contingency always last, outside any section.
  for (const l of mains.filter(x => !x.isContingency)) pushTo(l.section?.trim() || null, l)
  for (const l of mains.filter(x => x.isContingency)) pushTo(null, l)
  // Options whose line is gone still show (at the end) so nothing disappears silently.
  const placed = new Set(groups.flatMap(g => g.lines.map(l => l.key)))
  for (const l of lines) if (!placed.has(l.key)) pushTo(null, l)
  return groups
}

export function sectionTotal(lines: EngineLine[]): number {
  return r2(countedLines(lines).reduce((s, l) => s + engineLineTotal(l), 0))
}

/** Hire: quantity on the quotation from units and days. */
export function qtyFromDays(units: number, days: number | null | undefined): number {
  const d = Number(days)
  return d > 0 ? r2((Number(units) || 0) * d) : Number(units) || 0
}

export const PERIOD_LABEL: Record<RecurringPeriod, string> = { week: 'week', month: 'month', year: 'year' }
