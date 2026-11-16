/**
 * Piece 9c: restock from low stock. The list and the POs come from the database (restock_list, restock_create_pos);
 * "Ask suppliers" makes an RFQ for the chosen items, so replies come back the usual way and become a PO.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supplyError } from '@/lib/money/order-supply'

export type RestockRow = {
  catalogue_item_id: string; inventory_item_id: string; name: string; sku: string | null; unit: string
  on_hand: number; on_order: number; reorder_point: number; suggested_qty: number
  best_supplier_id: string | null; best_supplier_name: string | null; best_price: number | null
  price_at: string | null; price_old: boolean
}

/** What the screen suggests for a row: order from the best supplier, or ask suppliers (old or no price). */
export function suggestion(r: Pick<RestockRow, 'best_supplier_id' | 'best_price' | 'price_old' | 'best_supplier_name'>): { kind: 'order' | 'ask'; label: string } {
  if (!r.best_supplier_id || r.best_price == null) return { kind: 'ask', label: 'Ask suppliers' }
  if (r.price_old) return { kind: 'ask', label: 'Price is old: ask' }
  return { kind: 'order', label: `Order from ${r.best_supplier_name ?? 'supplier'}` }
}

/** "9 days ago", "3 weeks ago", "5 months ago". */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 730) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}

export async function loadRestock(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase.rpc('restock_list', { p_company_id: companyId })
  if (error) return { ok: false as const, message: supplyError(error.message) }
  return { ok: true as const, rows: ((data ?? []) as RestockRow[]).map(r => ({
    ...r, on_hand: Number(r.on_hand) || 0, on_order: Number(r.on_order) || 0, reorder_point: Number(r.reorder_point) || 0,
    suggested_qty: Number(r.suggested_qty) || 0, best_price: r.best_price == null ? null : Number(r.best_price),
  })) }
}

export async function orderAtBestPrice(supabase: SupabaseClient, companyId: string, lines: { inventory_item_id: string; supplier_id: string; qty: number; unit_price: number }[]) {
  const { data, error } = await supabase.rpc('restock_create_pos', { p_company_id: companyId, p_lines: lines })
  if (error) return { ok: false as const, message: supplyError(error.message) }
  return { ok: true as const, created: ((data as { created: { id: string; po_number: string }[] } | null)?.created ?? []) }
}

/** An RFQ for the chosen items (suppliers are picked and emailed on the RFQ screen). */
export async function askSuppliers(supabase: SupabaseClient, opts: { companyId: string; employeeId: string | null; rows: { inventory_item_id: string; name: string; unit: string; qty: number }[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: n } = await (supabase.rpc as any)('generate_rfq_number', { p_company_id: opts.companyId })
  const { data: rfq, error } = await supabase.from('rfqs').insert({
    company_id: opts.companyId, rfq_number: (n as string | null) ?? null, title: 'Restock', status: 'draft',
    created_by: opts.employeeId, updated_at: new Date().toISOString(),
  }).select('id').single()
  if (error || !rfq) return { ok: false as const, message: supplyError(error?.message) }
  const id = (rfq as { id: string }).id
  const { error: lErr } = await supabase.from('rfq_lines').insert(opts.rows.map((r, i) => ({
    company_id: opts.companyId, rfq_id: id, sort_order: i, inventory_item_id: r.inventory_item_id,
    description: r.name, unit: r.unit || 'each', quantity: r.qty,
  })))
  if (lErr) return { ok: false as const, message: supplyError(lErr.message) }
  return { ok: true as const, id }
}
