/**
 * How a quote line is supplied: outsourced (bought in from a supplier, or a service done by a contractor), done by
 * your own team (service), or taken from stock. Stock is chosen automatically when the item is in stock, unless
 * the office picks "Outsource instead".
 */

import { lineMarginPct, priceForMargin, type ItemType } from '@/lib/line-items'

export type SupplyMode = 'outsource' | 'service' | 'stock'

/** What a line is when nobody chose: stock items in stock come from stock, other items are outsourced, the rest is a service. */
export function defaultSupplyMode(itemType: ItemType, qty: number, onHand: number | null | undefined): SupplyMode {
  if (itemType === 'inventory') return (Number(onHand) || 0) >= Math.max(Number(qty) || 0, 1) ? 'stock' : 'outsource'
  if (itemType === 'catalogue') return 'outsource'
  return 'service'
}

/** The line's mode: the one chosen, else the default. "Stock" only holds while it is a stock item. */
export function supplyModeOf(stored: SupplyMode | null | undefined, itemType: ItemType, qty: number, onHand: number | null | undefined): SupplyMode {
  if (stored === 'stock' && itemType !== 'inventory') return 'outsource'
  return stored ?? defaultSupplyMode(itemType, qty, onHand)
}

/**
 * The selling price after choosing a supplier's cost.
 * keep 'margin': the line's margin stays the same (or, when it had none yet, the default margin is used).
 * keep 'price': the selling price stays (or, when it had none yet, the default margin is used).
 */
export function priceAfterChoice(opts: {
  cost: number; prevCost: number | null | undefined; prevPrice: number; discountPct: number | null | undefined
  keep: 'margin' | 'price'; defaultMarginPct: number
}): number {
  const prevPrice = Number(opts.prevPrice) || 0
  if (opts.keep === 'price' && prevPrice > 0) return prevPrice
  const prevMargin = lineMarginPct({ unitPrice: prevPrice, discountPct: opts.discountPct, unitCost: opts.prevCost })
  const margin = opts.keep === 'margin' && prevMargin != null ? prevMargin : opts.defaultMarginPct
  return priceForMargin(opts.cost, margin, opts.discountPct) ?? prevPrice
}
