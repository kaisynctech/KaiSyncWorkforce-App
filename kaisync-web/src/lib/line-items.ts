/**
 * Line items shared by quotes and invoices.
 * A line comes from one of four places: a job service (fixed price, no quantity), the catalogue (price list),
 * inventory (stock; leaves stock when an invoice is sent) or the user's own line.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ItemType = 'service' | 'catalogue' | 'inventory' | 'custom'

export type EditorLine = {
  key: string
  type: ItemType
  /** job_services / quote_catalogue_items / inventory_items id; null for the user's own line. */
  sourceId: string | null
  description: string
  qty: number
  unitPrice: number
  unit: string
  /** Small grey hint after the name, e.g. "Client price" or "12 in stock". */
  hint?: string | null
  /** What one unit costs the business (office only; never on the PDF or the client's page). */
  unitCost?: number | null
  /** Discount on this line, in % (0–100). Quotes only for now. */
  discountPct?: number | null
}

export type PickItem = {
  key: string
  type: ItemType
  sourceId: string
  name: string
  price: number
  unit: string
  /** Shown under the name in the picker. */
  detail: string
  /** Shown after the name once on the document. */
  hint: string | null
  /** Cost price from the catalogue or stock item, when known. */
  cost?: number | null
  /** Stock items: how many are on hand. */
  onHand?: number | null
  /** Products & stock kind (part, service, material, labour, package, fee, hire); job services are 'service'. */
  kind?: string | null
  sku?: string | null
  brand?: string | null
}

export const ITEM_KIND: Record<ItemType, { label: string; dot: string; fg: string; bg: string }> = {
  service: { label: 'Service', dot: '#7C3AED', fg: '#6D28D9', bg: '#F5F3FF' },
  catalogue: { label: 'Catalogue', dot: '#2563EB', fg: '#1D4ED8', bg: '#EFF6FF' },
  inventory: { label: 'Inventory', dot: '#D97706', fg: '#B45309', bg: '#FFFBEB' },
  custom: { label: 'Own line', dot: '#6B7280', fg: '#374151', bg: '#F3F4F6' },
}

/** A service is one fixed price: its quantity is always 1. */
export function lineQty(l: Pick<EditorLine, 'type' | 'qty'>): number {
  return l.type === 'service' ? 1 : Math.max(0, Number(l.qty) || 0)
}

/** Discount as a fraction (0–1), from a line's discount %. */
export function discountFraction(l: Pick<EditorLine, 'discountPct'>): number {
  const d = Number(l.discountPct) || 0
  return Math.min(100, Math.max(0, d)) / 100
}

/** Price of one unit after the line's discount. */
export function netUnitPrice(l: Pick<EditorLine, 'unitPrice' | 'discountPct'>): number {
  return (Number(l.unitPrice) || 0) * (1 - discountFraction(l))
}

export function lineTotal(l: Pick<EditorLine, 'type' | 'qty' | 'unitPrice' | 'discountPct'>): number {
  return Math.round(lineQty(l) * netUnitPrice(l) * 100) / 100
}

/** Margin (profit as a % of the selling price after discount); null when there is no cost or no price. */
export function lineMarginPct(l: Pick<EditorLine, 'unitPrice' | 'discountPct' | 'unitCost'>): number | null {
  const net = netUnitPrice(l)
  const cost = Number(l.unitCost) || 0
  if (!(cost > 0) || !(net > 0)) return null
  return ((net - cost) / net) * 100
}

/** The selling price (before discount) that gives this margin on the cost. Null when it can't be done. */
export function priceForMargin(cost: number, marginPct: number, discountPct: number | null | undefined): number | null {
  const m = marginPct / 100
  const d = Math.min(100, Math.max(0, Number(discountPct) || 0)) / 100
  if (!(cost > 0) || m >= 1 || d >= 1) return null
  return Math.round((cost / (1 - m) / (1 - d)) * 100) / 100
}

export function linesSubtotal(lines: Pick<EditorLine, 'type' | 'qty' | 'unitPrice' | 'discountPct'>[]): number {
  return Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100
}

/** Lines worth saving: something described or priced. */
export function meaningfulLines<T extends Pick<EditorLine, 'description' | 'unitPrice'>>(lines: T[]): T[] {
  return lines.filter(l => l.description.trim() || Number(l.unitPrice) > 0)
}

export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`
}

export function lineFromPick(p: PickItem): EditorLine {
  return { key: newKey(), type: p.type, sourceId: p.sourceId, description: p.name, qty: 1, unitPrice: p.price, unit: p.unit, hint: p.hint, unitCost: p.cost ?? null }
}

export function blankEditorLine(): EditorLine {
  return { key: newKey(), type: 'custom', sourceId: null, description: '', qty: 1, unitPrice: 0, unit: 'each', hint: null }
}

export function asItemType(v: unknown): ItemType {
  return v === 'service' || v === 'catalogue' || v === 'inventory' ? v : 'custom'
}

export function filterPicks(items: PickItem[], tab: ItemType | 'all', query: string): PickItem[] {
  const q = query.trim().toLowerCase()
  return items.filter(i => (tab === 'all' || i.type === tab) && (!q || i.name.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)))
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Everything that can go on a quote or invoice for this company (and client: agreed service prices win). */
export async function loadPickItems(
  supabase: SupabaseClient,
  companyId: string,
  clientId: string | null,
): Promise<PickItem[]> {
  const [services, agreed, catalogue, stock] = await Promise.all([
    supabase.from('job_services').select('id, name, category, default_price').eq('company_id', companyId).eq('is_active', true).order('sort_order').order('name'),
    clientId
      ? supabase.from('client_job_services').select('service_id, agreed_price').eq('client_id', clientId)
      : Promise.resolve({ data: [] as { service_id: string; agreed_price: number | null }[] }),
    supabase.from('quote_catalogue_items').select('id, name, unit, item_type, sell_price, cost_price, code, sku, brand').eq('company_id', companyId).eq('is_active', true).order('name').limit(1000),
    supabase.from('inventory_items').select('id, name, sku, unit_of_measure, selling_price, unit_cost, quantity_on_hand, catalogue_item_id').eq('company_id', companyId).eq('is_active', true).order('name').limit(1000),
  ])
  const agreedBy = new Map<string, number>()
  for (const a of ((agreed as { data: unknown }).data ?? []) as { service_id: string; agreed_price: number | null }[]) {
    if (a.agreed_price != null) agreedBy.set(a.service_id, num(a.agreed_price))
  }
  const out: PickItem[] = []
  for (const s of (services.data ?? []) as { id: string; name: string; category: string | null; default_price: number | null }[]) {
    const clientPrice = agreedBy.get(s.id)
    out.push({
      key: `s:${s.id}`, type: 'service', sourceId: s.id, name: s.name, unit: 'job',
      price: clientPrice ?? num(s.default_price),
      detail: [clientPrice != null ? 'Client price' : 'Company price', s.category].filter(Boolean).join(' · '),
      hint: clientPrice != null ? 'Client price' : null,
      kind: 'service',
    })
  }
  type CatRow = { id: string; name: string; unit: string | null; item_type: string | null; sell_price: number | null; cost_price: number | null; code: string | null; sku: string | null; brand: string | null }
  const cats = (catalogue.data ?? []) as CatRow[]
  const catById = new Map(cats.map(c => [c.id, c]))
  // One item list (6b): a stocked product and its stock record are one item. It is offered once, as stock, so
  // invoicing it still takes it out of stock; the product's kind, part no. and brand come with it.
  const stocked = new Set(
    ((stock.data ?? []) as { catalogue_item_id: string | null }[]).map(i => i.catalogue_item_id).filter((x): x is string => !!x),
  )
  for (const c of cats) {
    if (stocked.has(c.id)) continue
    out.push({
      key: `c:${c.id}`, type: 'catalogue', sourceId: c.id, name: c.name, unit: c.unit || 'each', price: num(c.sell_price),
      cost: num(c.cost_price) > 0 ? num(c.cost_price) : null,
      detail: [c.code, c.unit ? `per ${c.unit}` : null].filter(Boolean).join(' · ') || 'Catalogue',
      hint: c.unit && c.unit !== 'each' ? `per ${c.unit}` : null,
      kind: c.item_type, sku: c.sku ?? c.code, brand: c.brand,
    })
  }
  for (const i of (stock.data ?? []) as { id: string; name: string; sku: string | null; unit_of_measure: string | null; selling_price: number | null; unit_cost: number | null; quantity_on_hand: number | null; catalogue_item_id: string | null }[]) {
    const onHand = num(i.quantity_on_hand)
    const cat = i.catalogue_item_id ? catById.get(i.catalogue_item_id) : undefined
    out.push({
      key: `i:${i.id}`, type: 'inventory', sourceId: i.id, name: i.name, unit: i.unit_of_measure || 'each', price: num(i.selling_price),
      cost: num(i.unit_cost) > 0 ? num(i.unit_cost) : null,
      detail: [i.sku, `${onHand.toLocaleString('en-ZA')} in stock`].filter(Boolean).join(' · '),
      hint: `${onHand.toLocaleString('en-ZA')} in stock`,
      onHand,
      kind: cat?.item_type ?? 'part', sku: i.sku ?? cat?.sku ?? null, brand: cat?.brand ?? null,
    })
  }
  return out
}

export function formatRand(n: number): string {
  return `R ${(Number(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Cost, profit and margin of a set of lines (only lines with a cost count towards the cost). */
export function linesProfit(lines: Pick<EditorLine, 'type' | 'qty' | 'unitPrice' | 'unitCost' | 'discountPct'>[]) {
  const sell = linesSubtotal(lines)
  const cost = Math.round(lines.reduce((s, l) => s + lineQty(l) * (Number(l.unitCost) || 0), 0) * 100) / 100
  const costed = lines.some(l => (Number(l.unitCost) || 0) > 0)
  const profit = Math.round((sell - cost) * 100) / 100
  return { sell, cost, profit, costed, marginPct: sell > 0 ? (profit / sell) * 100 : 0 }
}
