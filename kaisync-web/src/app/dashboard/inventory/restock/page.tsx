'use client'

/**
 * Restock (board H): stock items at or under their reorder point, a suggested quantity (counting what's already on
 * order) and the best known supplier price. "Order at best known price" makes one PO per supplier, ready to send;
 * "Ask suppliers" makes an RFQ for items with an old price or none. Phone first: cards.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatCurrency } from '@/lib/currencies'
import { ago, askSuppliers, loadRestock, orderAtBestPrice, suggestion, type RestockRow } from '@/lib/money/restock'
import { parseQty, type OrderPoLine } from '@/lib/money/order-supply'
import { PurchaseOrdersPanel, type SupplyPo } from '@/components/money/OrderSupply'
import { cn } from '@/lib/utils'

const q3 = (n: number) => String(Math.round(n * 1000) / 1000)

export default function RestockPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [rows, setRows] = useState<RestockRow[] | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [qty, setQty] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'order' | 'ask' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{ pos: SupplyPo[]; lines: OrderPoLine[] } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member?.companyId) return
    setCompanyId(member.companyId); setEmployeeId(member.employeeId)
    const r = await loadRestock(supabase, member.companyId)
    if (!r.ok) { setError(r.message); setRows([]); return }
    setRows(r.rows)
    setTicked(new Set(r.rows.map(x => x.inventory_item_id)))
    setQty(Object.fromEntries(r.rows.map(x => [x.inventory_item_id, q3(x.suggested_qty)])))
  }, [])

  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const loadMade = useCallback(async (ids: string[]) => {
    const supabase = createClient()
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, status, currency, subtotal, vat_amount, total_amount, required_delivery_date, created_at, approved_at, sent_at, delivery_address, notes, terms_and_conditions, supplier_id, supplier:contractors!purchase_orders_supplier_id_fkey(name, email)').in('id', ids).order('po_number'),
      supabase.from('purchase_order_lines').select('id, po_id, quote_line_id, description, unit, quantity_ordered, quantity_received, unit_price, vat_rate').in('po_id', ids).order('sort_order'),
    ])
    setMade({ pos: (p ?? []) as unknown as SupplyPo[], lines: (l ?? []) as OrderPoLine[] })
  }, [])

  const chosen = (rows ?? []).filter(r => ticked.has(r.inventory_item_id))
  const toOrder = chosen.filter(r => suggestion(r).kind === 'order')
  const toAsk = chosen.filter(r => suggestion(r).kind === 'ask')
  const qtyOf = (r: RestockRow) => parseQty(qty[r.inventory_item_id] ?? '')
  const badQty = chosen.some(r => !(qtyOf(r) > 0))

  async function order() {
    if (!companyId) return
    setBusy('order'); setError(null)
    const r = await orderAtBestPrice(createClient(), companyId, toOrder.map(x => ({
      inventory_item_id: x.inventory_item_id, supplier_id: x.best_supplier_id!, qty: qtyOf(x), unit_price: x.best_price!,
    })))
    setBusy(null)
    if (!r.ok) { setError(r.message); return }
    await loadMade(r.created.map(c => c.id))
    await load()
  }

  async function ask() {
    if (!companyId) return
    setBusy('ask'); setError(null)
    const r = await askSuppliers(createClient(), { companyId, employeeId, rows: toAsk.map(x => ({ inventory_item_id: x.inventory_item_id, name: x.name, unit: x.unit, qty: qtyOf(x) })) })
    setBusy(null)
    if (!r.ok) { setError(r.message); return }
    window.location.assign(`/dashboard/supply/rfqs/${r.id}`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Link href="/dashboard/inventory" className="mt-1 text-text-secondary hover:text-text-primary" aria-label="Back to products and stock"><span className="material-icons text-[20px]">arrow_back</span></Link>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary">Restock</h1>
            <p className="text-[12.5px] text-text-secondary">Stock items at or under their reorder point, with the best price you&apos;ve had from a supplier.</p>
          </div>
        </div>

        {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}

        {made && companyId && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 flex flex-col gap-2">
            <p className="text-[14px] font-semibold text-emerald-900">Purchase orders made. Check them and send.</p>
            <PurchaseOrdersPanel companyId={companyId} quoteId="" pos={made.pos} poLines={made.lines} sendTo={new Map()} toSource={0}
              canProcess={false} processing={false} onProcess={() => undefined}
              onChanged={async () => { await loadMade(made.pos.map(p => p.id)); await load() }} />
          </div>
        )}

        {rows === null ? <p className="py-10 text-center text-[13px] text-text-secondary">Loading…</p> : rows.length === 0 ? (
          <div className="rounded-xl border border-divider bg-surface p-6 text-center">
            <p className="text-[14px] font-semibold text-text-primary">Nothing to restock</p>
            <p className="text-[12.5px] text-text-secondary mt-1">Items show here when stock on hand plus what&apos;s on order is at or under their reorder point. Set a reorder point on an item in Products &amp; stock.</p>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur flex flex-wrap gap-2 border-b border-divider">
              <button type="button" disabled={busy !== null || badQty || toOrder.length === 0} onClick={() => void order()}
                className="btn-primary h-11 px-4 text-[13.5px] disabled:opacity-50">{busy === 'order' ? 'Making POs…' : `Order at best known price (${toOrder.length})`}</button>
              <button type="button" disabled={busy !== null || badQty || toAsk.length === 0} onClick={() => void ask()}
                className="btn-outlined h-11 px-4 text-[13.5px] disabled:opacity-50">{busy === 'ask' ? 'Opening…' : `Ask suppliers for prices (${toAsk.length})`}</button>
            </div>
            <p className="text-[12px] text-text-secondary">{rows.length} item{rows.length === 1 ? '' : 's'} to restock · ticked items go on the button that fits them.</p>
            {rows.map(r => {
              const s = suggestion(r)
              const on = ticked.has(r.inventory_item_id)
              const n = qtyOf(r)
              return (
                <section key={r.inventory_item_id} className={cn('rounded-xl border bg-surface p-3 flex flex-col gap-2', s.kind === 'ask' ? 'border-amber-200' : 'border-divider', !on && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={on} aria-label={`Restock ${r.name}`} className="mt-1 w-5 h-5"
                      onChange={() => setTicked(t => { const x = new Set(t); if (x.has(r.inventory_item_id)) x.delete(r.inventory_item_id); else x.add(r.inventory_item_id); return x })} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14.5px] font-semibold text-text-primary">{r.name}</p>
                      <p className="text-[12px] text-text-secondary">{[r.sku, `on hand ${q3(r.on_hand)}`, r.on_order > 0 ? `on order ${q3(r.on_order)}` : null, `reorder at ${q3(r.reorder_point)}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    <label className="text-[11px] font-medium text-text-secondary text-right">Order qty
                      <input value={qty[r.inventory_item_id] ?? ''} inputMode="decimal" onChange={e => setQty(x => ({ ...x, [r.inventory_item_id]: e.target.value }))}
                        aria-label={`Order quantity: ${r.name}`}
                        className={cn('mt-1 block w-20 h-11 px-2 rounded-xl border text-right text-[15px] bg-background', on && !(n > 0) ? 'border-error' : 'border-border')} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pl-8">
                    <span className="text-[13px]">
                      {r.best_price != null
                        ? <>{r.best_supplier_name} <b className="tabular-nums">{formatCurrency(r.best_price, 'ZAR')}</b> <span className="text-text-secondary text-[12px]">· {ago(r.price_at)}</span>{n > 0 && s.kind === 'order' ? <span className="text-text-secondary text-[12px]"> · {formatCurrency(n * r.best_price, 'ZAR')} excl. VAT</span> : null}</>
                        : <span className="text-text-secondary">No price yet</span>}
                    </span>
                    <span className={cn('text-[11px] font-semibold rounded-full px-2 py-0.5', s.kind === 'order' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>{s.label}</span>
                  </div>
                </section>
              )
            })}
            <p className="text-[12px] text-text-secondary">The order quantity brings stock back up, counting what&apos;s already on order (or the item&apos;s reorder quantity, if it has one). Prices come from every supplier price on the item, every supplier reply, PO and bill; a price older than 90 days is treated as old.</p>
          </>
        )}
      </div>
    </div>
  )
}
