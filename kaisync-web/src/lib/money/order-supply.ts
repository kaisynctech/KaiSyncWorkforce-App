/**
 * Piece 9: an order's supply side. Process order → one PO per chosen supplier, part deliveries, PO edit / cancel.
 * The database does each step safely (quote_process_order, po_receive_goods, goods_received_*, po_update_lines,
 * po_cancel); this file holds the line statuses the Order page shows and the friendly messages.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type SupplyMode = 'outsource' | 'service' | 'stock' | null
export type OrderLine = { id: string; supply_mode: SupplyMode; quantity: number | null; is_excluded?: boolean | null; supplier_id?: string | null }
export type OrderPoLine = {
  id: string; po_id: string; quote_line_id: string | null; description: string | null; unit: string | null
  quantity_ordered: number | null; quantity_received: number | null; unit_price: number | null; vat_rate: number | null
}
export type OrderPo = { id: string; po_number: string | null; status: string | null; sent_at?: string | null }

export type LineSupply = {
  key: 'service' | 'stock' | 'to_source' | 'ready' | 'on_po' | 'part' | 'received'
  label: string
  cls: string
  source: string
  po: OrderPo | null
  ordered: number
  received: number
}

const CLS = {
  amber: 'bg-amber-50 text-amber-800',
  violet: 'bg-violet-50 text-violet-800',
  blue: 'bg-blue-50 text-blue-800',
  green: 'bg-emerald-50 text-emerald-800',
  slate: 'bg-slate-100 text-slate-700',
}

const num = (n: number | null | undefined) => Number(n) || 0
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000)

/** Where a quote line stands: To source → On PO → Part received n/m → Received (service and stock lines say so). */
export function lineSupply(line: OrderLine, poLines: OrderPoLine[], pos: OrderPo[]): LineSupply {
  const live = poLines.filter(p => p.quote_line_id === line.id && pos.find(o => o.id === p.po_id)?.status !== 'cancelled')
  const ordered = live.reduce((s, p) => s + num(p.quantity_ordered), 0)
  const received = live.reduce((s, p) => s + num(p.quantity_received), 0)
  const po = live.length ? pos.find(o => o.id === live[0].po_id) ?? null : null
  const base = { po, ordered, received }
  if (line.supply_mode === 'service') return { key: 'service', label: 'Service', cls: CLS.slate, source: 'Service', ...base }
  if (line.supply_mode === 'stock' && !live.length) return { key: 'stock', label: 'From stock', cls: CLS.slate, source: 'From stock', ...base }
  if (line.supply_mode !== 'outsource' && !live.length) return { key: 'service', label: '—', cls: CLS.slate, source: '—', ...base }
  const source = line.supply_mode === 'stock' ? 'From stock' : 'Outsource'
  if (!live.length && line.supplier_id) return { key: 'ready', label: 'Ready for PO', cls: CLS.amber, source, ...base }
  if (!live.length) return { key: 'to_source', label: 'To source', cls: CLS.amber, source, ...base }
  if (received <= 0) return { key: 'on_po', label: 'On PO', cls: CLS.violet, source, ...base }
  if (received < ordered) return { key: 'part', label: `Part received ${qtyText(received)}/${qtyText(ordered)}`, cls: CLS.blue, source, ...base }
  return { key: 'received', label: 'Received', cls: CLS.green, source, ...base }
}

/** A service-only order (every line a Service, nothing bought in): no purchase orders or deliveries tabs. */
export function isServiceOnly(lines: OrderLine[], pos: OrderPo[]): boolean {
  return pos.length === 0 && lines.filter(l => !l.is_excluded).every(l => l.supply_mode === 'service')
}

/** POs made by "Process order" that haven't been emailed yet. */
export const readyToSend = <T extends OrderPo>(pos: T[]): T[] => pos.filter(p => p.status === 'approved' && !p.sent_at)

export const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: CLS.slate },
  pending_approval: { label: 'Waiting for approval', cls: CLS.amber },
  approved: { label: 'Ready to send', cls: CLS.amber },
  sent: { label: 'Sent', cls: CLS.violet },
  partially_received: { label: 'Part received', cls: CLS.blue },
  received: { label: 'Received', cls: CLS.green },
  cancelled: { label: 'Cancelled', cls: CLS.slate },
  rejected: { label: 'Rejected', cls: CLS.slate },
}

const MESSAGES: Record<string, string> = {
  NOT_ALLOWED: 'You don’t have permission to do this.',
  QUOTE_NOT_ACCEPTED: 'The quote has to be accepted first.',
  PO_NOT_OPEN: 'This purchase order isn’t open for deliveries.',
  NOTHING_RECEIVED: 'Type how many arrived for at least one item.',
  BAD_QUANTITY: 'Quantities must be more than 0.',
  LINE_NOT_ON_PO: 'That item isn’t on this purchase order.',
  MORE_THAN_ORDERED: 'That’s more than was ordered. Edit the PO first if the supplier sent extra.',
  BILL_ALREADY_APPROVED: 'This delivery’s bill is already approved or paid, so it can’t be cancelled here.',
  GRN_CANCELLED: 'This delivery was cancelled.',
  PO_CLOSED: 'This purchase order is closed (fully received or cancelled).',
  LESS_THAN_RECEIVED: 'You can’t order fewer than have already arrived.',
  PO_HAS_DELIVERIES: 'Goods have already arrived on this PO, so it can’t be cancelled. Edit it instead.',
  INSUFFICIENT_STOCK: 'Some of this stock has already been used, so the delivery can’t be taken back.',
}

export function supplyError(message: string | null | undefined): string {
  const m = String(message ?? '')
  for (const [code, text] of Object.entries(MESSAGES)) if (m.includes(code)) return text
  return m || 'Something went wrong. Please try again.'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (supabase: SupabaseClient, fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args) as Promise<{ data: unknown; error: { message: string } | null }>

export async function processOrder(supabase: SupabaseClient, quoteId: string) {
  const { data, error } = await rpc(supabase, 'quote_process_order', { p_quote_id: quoteId })
  if (error) return { ok: false as const, message: supplyError(error.message) }
  const d = data as { created: { id: string; po_number: string }[]; to_source: number }
  return { ok: true as const, created: d.created ?? [], toSource: Number(d.to_source) || 0 }
}

export async function receiveGoods(supabase: SupabaseClient, poId: string, deliveryNote: string, lines: { po_line_id: string; qty: number }[], notes?: string) {
  const { data, error } = await rpc(supabase, 'po_receive_goods', { p_po_id: poId, p_delivery_note: deliveryNote, p_lines: lines.filter(l => l.qty > 0), p_notes: notes ?? null })
  if (error) return { ok: false as const, message: supplyError(error.message) }
  return { ok: true as const, ...(data as { grn_id: string; grn_number: string; bill_id: string; fully_received: boolean }) }
}

export async function cancelDelivery(supabase: SupabaseClient, grnId: string, reason?: string) {
  const { error } = await rpc(supabase, 'goods_received_cancel', { p_grn_id: grnId, p_reason: reason ?? null })
  return error ? { ok: false as const, message: supplyError(error.message) } : { ok: true as const }
}

export async function updateDelivery(supabase: SupabaseClient, grnId: string, deliveryNote: string, notes: string) {
  const { error } = await rpc(supabase, 'goods_received_update', { p_grn_id: grnId, p_delivery_note: deliveryNote, p_notes: notes })
  return error ? { ok: false as const, message: supplyError(error.message) } : { ok: true as const }
}

export async function updatePoLines(supabase: SupabaseClient, poId: string, lines: { id: string; quantity: number; unit_price: number }[]) {
  const { error } = await rpc(supabase, 'po_update_lines', { p_po_id: poId, p_lines: lines })
  return error ? { ok: false as const, message: supplyError(error.message) } : { ok: true as const }
}

export async function cancelPo(supabase: SupabaseClient, poId: string, reason?: string) {
  const { error } = await rpc(supabase, 'po_cancel', { p_po_id: poId, p_reason: reason ?? null })
  return error ? { ok: false as const, message: supplyError(error.message) } : { ok: true as const }
}

/** "1,5" or "1 200" → 1.5 / 1200; anything else → NaN. */
export function parseQty(v: string): number {
  const t = v.replace(/\s/g, '').replace(',', '.')
  return t === '' ? 0 : Number(t)
}
