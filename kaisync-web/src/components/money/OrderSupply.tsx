'use client'

/**
 * The Order page's Buying in: two tabs.
 *  Purchase orders — the supplier side: price changes, the supplier's bill (one per PO) and paying it
 *    (full, deposit, part payments; each payment goes to Xero), "can't deliver" (cancel and order elsewhere),
 *    and the refund when a cancelled PO had been paid.
 *  Goods received — what physically arrived: part deliveries, and items sent back (damaged, wrong item …),
 *    which stay "still to come".
 * Small tables, one line per row; the actions open small pop-ups.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currencies'
import { companyLetterhead } from '@/lib/letterhead'
import { pdfBase64 } from '@/lib/document-pdf'
import { sendDocumentEmail } from '@/lib/money/document-email'
import { buildPoPdf } from '@/lib/money/po-pdf'
import {
  PO_STATUS, cancelDelivery, cancelPo, parseQty, paySupplier, processOrder, readyToSend, receiveGoods, recordSupplierRefund,
  updateDelivery, updatePoLines, type OrderPoLine,
} from '@/lib/money/order-supply'
import { cn } from '@/lib/utils'

export type SupplyPo = {
  id: string; po_number: string | null; status: string | null; currency: string | null; subtotal: number | null
  vat_amount: number | null; total_amount: number | null; required_delivery_date: string | null; created_at: string
  approved_at: string | null; sent_at: string | null; delivery_address: string | null; notes: string | null
  terms_and_conditions: string | null; supplier_id: string | null
  supplier?: { name: string; email: string | null } | null
}
export type SupplyGrn = {
  id: string; grn_number: string | null; po_id: string | null; status: string | null; received_date: string | null
  created_at?: string | null; delivery_note_number: string | null; notes: string | null
}
export type SupplyGrnLine = {
  grn_id: string; description: string | null; quantity_received: number | null
  po_line_id?: string | null; quantity_rejected?: number | null; reject_reason?: string | null
}
export type SupplyBill = {
  id: string; bill_number: string | null; invoice_number: string | null; grn_id: string | null; po_id: string | null
  status: string | null; approval_status: string | null; total_amount: number | null; currency: string | null
  amount_paid?: number | null; balance_due?: number | null; amount_refunded?: number | null
}
/** A payment to a supplier (finance_transactions on the bill). */
export type SupplyPay = { id: string; source_id: string; amount: number | null; transaction_date: string | null; payment_method: string | null; reference_number: string | null; transaction_type?: string | null }

const fmtDay = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—')
const q3 = (n: number) => String(Math.round(n * 1000) / 1000)
const n0 = (v: number | null | undefined) => Number(v) || 0
const today = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10)
const money = (v: number, c?: string | null) => formatCurrency(v, c ?? 'ZAR')

const card = 'rounded-xl border border-divider bg-surface'
const TH = 'px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-text-primary whitespace-nowrap'
const TD = 'px-2 py-1.5 text-[11.5px] text-text-primary whitespace-nowrap align-middle'
const pill = 'inline-block text-[10px] font-semibold rounded-full px-1.5 py-px whitespace-nowrap'
const xs = 'h-6 px-2 rounded-md text-[10.5px] font-semibold whitespace-nowrap disabled:opacity-50'
const xsO = cn(xs, 'border border-divider bg-surface text-text-primary hover:border-[#2563EB]/60')
const btn = 'h-8 px-3 rounded-lg border border-divider bg-surface text-[12px] font-semibold text-text-primary hover:border-[#2563EB]/60 disabled:opacity-50'
const btnP = 'h-8 px-3.5 rounded-lg bg-[#2563EB] text-white text-[12px] font-semibold hover:bg-[#1D4ED8] disabled:opacity-50'
const inp = 'h-8 px-2 rounded-lg border-[1.5px] border-divider bg-surface text-[12.5px] font-semibold text-text-primary focus:outline-none focus:border-[#2563EB]'
const qIn = 'h-8 w-16 px-2 rounded-lg border-[1.5px] border-[#2563EB]/60 bg-surface text-right text-[12.5px] font-semibold focus:outline-none focus:border-[#2563EB]'
const lab = 'flex flex-col gap-1 text-[11px] font-semibold text-text-primary'
const P = {
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
}
const REASONS = ['Damaged', 'Wrong item', 'Wrong size', 'Other']
const METHODS: [string, string][] = [['eft', 'EFT'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']]

/** A small pop-up: title, body, buttons. Esc or ✕ closes it. */
function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={cn('bg-surface w-full rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')} onClick={e => e.stopPropagation()}>
        <header className="flex items-center gap-2 px-4 h-12 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[13.5px] font-semibold text-text-primary truncate">{title}</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary" aria-label="Close"><span className="material-icons !text-[18px]">close</span></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">{children}</div>
        <footer className="px-4 py-2.5 border-t border-divider flex flex-wrap gap-2 justify-end shrink-0">{footer}</footer>
      </div>
    </div>
  )
}

function Err({ text }: { text: string | null }) {
  return text ? <p className="text-[12px] text-error bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2" role="alert">{text}</p> : null
}

/** Money on a PO: its bill (one per PO), or the old per-delivery bills added up. */
export function poMoney(po: SupplyPo, bills: SupplyBill[]) {
  const live = bills.filter(b => b.po_id === po.id && b.status !== 'cancelled')
  const own = live.find(b => !b.grn_id) ?? null
  const old = live.filter(b => !!b.grn_id)
  const total = own ? n0(own.total_amount) : old.length ? old.reduce((s, b) => s + n0(b.total_amount), 0) : n0(po.total_amount)
  const paid = (own ? [own] : old).reduce((s, b) => s + n0(b.amount_paid), 0)
  const refunded = own ? n0(own.amount_refunded) : 0
  const owing = Math.max(0, Math.round((total - paid) * 100) / 100)
  return { own, old, total, paid, refunded, owing, toRefund: Math.max(0, Math.round((paid - refunded) * 100) / 100) }
}

// ── Purchase orders ──────────────────────────────────────────────────────────

export function PurchaseOrdersPanel({ companyId, pos, poLines, sendTo, toSource, canProcess, processing, onProcess, onChanged, quoteId, bills = [], pays = [] }: {
  companyId: string
  pos: SupplyPo[]
  poLines: OrderPoLine[]
  /** Where each supplier's PO goes (the Buyout's "send to", else the supplier's email). */
  sendTo: Map<string, string>
  toSource: number
  canProcess: boolean
  processing: boolean
  onProcess: () => void
  onChanged: () => Promise<void>
  quoteId: string
  bills?: SupplyBill[]
  pays?: SupplyPay[]
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; kind: 'pay' | 'price' | 'cant' | 'refund' } | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const ready = readyToSend(pos)
  const linesOf = (id: string) => poLines.filter(l => l.po_id === id)
  const emailOf = (p: SupplyPo) => (p.supplier_id ? sendTo.get(p.supplier_id) : undefined) ?? p.supplier?.email ?? ''
  // A cancelled PO stays in the list while money paid on it is still to be refunded.
  const isOpenMoney = (p: SupplyPo) => p.status === 'cancelled' && poMoney(p, bills).toRefund > 0.004
  const cancelledCount = pos.filter(p => p.status === 'cancelled' && !isOpenMoney(p)).length
  const shown = pos.filter(p => showCancelled || p.status !== 'cancelled' || isOpenMoney(p))
  const done = async (text: string, ok = true) => { setOpen(null); setMsg({ ok, text }); await onChanged() }
  const current = open ? pos.find(p => p.id === open.id) ?? null : null

  /** Emails one PO with its PDF; marks it sent. */
  async function sendOne(p: SupplyPo, lh?: Awaited<ReturnType<typeof companyLetterhead>>): Promise<string | null> {
    const supabase = createClient()
    const to = emailOf(p)
    if (!to) return `${p.po_number}: ${p.supplier?.name ?? 'the supplier'} has no email address. Add one on the supplier.`
    const letterhead = lh ?? await companyLetterhead(supabase, companyId)
    // Read the PO again so an edit just saved is what the supplier gets.
    const [{ data: fresh }, { data: freshLines }] = await Promise.all([
      supabase.from('purchase_orders').select('po_number, currency, approved_at, created_at, required_delivery_date, vat_amount, subtotal, total_amount, delivery_address, notes, terms_and_conditions').eq('id', p.id).maybeSingle(),
      supabase.from('purchase_order_lines').select('description, unit, quantity_ordered, unit_price').eq('po_id', p.id).order('sort_order'),
    ])
    const { doc, filename } = buildPoPdf({ letterhead, po: (fresh as SupplyPo | null) ?? p, supplier: { name: p.supplier?.name ?? null, email: to }, lines: (freshLines as OrderPoLine[] | null) ?? linesOf(p.id) })
    const r = await sendDocumentEmail(supabase, { kind: 'purchase_order', docId: p.id, recipient: to, pdfBase64: pdfBase64(doc), filename })
    if (!r.ok) return `${p.po_number}: ${r.message}`
    if (p.status === 'approved') {
      const now = new Date().toISOString()
      await supabase.from('purchase_orders').update({ status: 'sent', sent_at: now, updated_at: now }).eq('id', p.id)
    }
    return null
  }

  async function sendAll() {
    setBusy('send'); setMsg(null)
    const lh = await companyLetterhead(createClient(), companyId)
    const errors: string[] = []
    for (const p of ready) { const e = await sendOne(p, lh); if (e) errors.push(e) }
    await onChanged()
    setBusy(null)
    setMsg(errors.length ? { ok: false, text: errors.join(' ') } : { ok: true, text: `Sent ${ready.length} purchase order${ready.length === 1 ? '' : 's'}.` })
  }

  return (
    <div className="flex flex-col gap-2.5">
      {msg && <p className={cn('text-[12.5px] rounded-lg px-3 py-2', msg.ok ? 'text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200' : 'text-error bg-red-50 dark:bg-red-950/40')} role="status">{msg.text}</p>}

      {canProcess && (
        <div className={cn(card, 'px-3 py-2 flex flex-wrap items-center justify-between gap-2')}>
          <p className="text-[12.5px] text-text-primary">Items with a chosen supplier aren&apos;t on a purchase order yet.</p>
          <button type="button" className={btnP} disabled={processing} onClick={onProcess}>{processing ? 'Creating…' : 'Process order'}</button>
        </div>
      )}
      {toSource > 0 && quoteId && (
        <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
          {toSource} item{toSource === 1 ? ' still needs' : 's still need'} a supplier. <Link href={`/dashboard/money/quotes/${quoteId}?view=quote&step=2`} className="underline font-medium">Choose on the quote&apos;s Buyout tab</Link>, then Process order again.
        </p>
      )}
      {ready.length > 0 && (
        <div className={cn(card, 'px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-amber-300')}>
          <p className="text-[12.5px] text-text-primary"><b>{ready.length} purchase order{ready.length === 1 ? ' is' : 's are'} ready to send.</b> Each supplier gets their own email with the PO attached.</p>
          <button type="button" className={btnP} disabled={busy !== null} onClick={() => void sendAll()}>{busy === 'send' ? 'Sending…' : `Send all (${ready.length})`}</button>
        </div>
      )}

      {pos.length === 0 && !canProcess && <p className="text-[12.5px] text-text-secondary py-6 text-center">No purchase orders for this order.</p>}

      {shown.length > 0 && (
        <div className={cn(card, 'overflow-x-auto')}>
          <table className="w-full">
            <thead><tr className="border-b border-divider">
              <th className={TH}>PO</th><th className={TH}>Supplier</th><th className={cn(TH, 'w-full')}>Items</th>
              <th className={cn(TH, '!text-right')}>Amount</th><th className={cn(TH, '!text-right')}>Paid</th><th className={cn(TH, '!text-right')}>Still to pay</th>
              <th className={TH}>Payment</th><th className={TH}>Delivery</th><th className={TH} />
            </tr></thead>
            <tbody>
              {shown.map(p => {
                const ls = linesOf(p.id)
                const ordered = ls.reduce((s, l) => s + n0(l.quantity_ordered), 0)
                const received = ls.reduce((s, l) => s + n0(l.quantity_received), 0)
                const m = poMoney(p, bills)
                const cancelled = p.status === 'cancelled'
                const items = ls.map(l => `${l.description ?? 'Item'} × ${q3(n0(l.quantity_ordered))}`)
                const payPill = cancelled ? (m.toRefund > 0.004 ? { t: `${money(m.toRefund, p.currency)} to be refunded`, c: P.red } : { t: 'Cancelled', c: P.red })
                  : m.paid <= 0.004 ? { t: 'Not paid', c: P.amber }
                  : m.owing <= 0.004 ? { t: 'Paid', c: P.green }
                  : { t: `Part paid · ${Math.round((m.paid / (m.total || 1)) * 100)}%`, c: P.amber }
                const delPill = cancelled ? null
                  : p.status === 'approved' ? { t: 'Not sent yet', c: P.amber }
                  : received <= 0 ? { t: 'Waiting', c: P.violet }
                  : received >= ordered ? { t: 'All in', c: P.green }
                  : { t: `${q3(received)} of ${q3(ordered)} in`, c: P.blue }
                const editable = !['cancelled', 'received'].includes(String(p.status))
                const canPay = !cancelled && !['draft', 'pending_approval', 'rejected'].includes(String(p.status)) && m.owing > 0.004 && m.old.length === 0
                return (
                  <tr key={p.id} className="border-b border-divider last:border-0">
                    <td className={TD}><Link href={`/dashboard/supply/purchase-orders/${p.id}`} className="font-semibold text-[#2563EB] hover:underline">{p.po_number ?? 'PO'}</Link></td>
                    <td className={TD}>{p.supplier?.name ?? 'Supplier'}</td>
                    <td className={cn(TD, 'max-w-[260px] truncate')} title={items.join(', ')}>{items[0] ?? '—'}{items.length > 1 && <span className="text-text-secondary"> +{items.length - 1}</span>}</td>
                    <td className={cn(TD, 'text-right tabular-nums font-semibold')}>{money(m.total, p.currency)}</td>
                    <td className={cn(TD, 'text-right tabular-nums')}>{money(m.paid, p.currency)}</td>
                    <td className={cn(TD, 'text-right tabular-nums font-semibold', m.owing > 0.004 && !cancelled ? 'text-text-primary' : 'text-text-secondary')}>{cancelled ? '—' : money(m.owing, p.currency)}</td>
                    <td className={TD}><span className={cn(pill, payPill.c)}>{payPill.t}</span></td>
                    <td className={TD}>{delPill ? <span className={cn(pill, delPill.c)}>{delPill.t}</span> : '—'}</td>
                    <td className={cn(TD, 'text-right')}>
                      <span className="inline-flex gap-1">
                        {p.status === 'approved' && (
                          <button type="button" className={cn(xs, 'bg-[#2563EB] text-white')} disabled={busy !== null} onClick={async () => {
                            setBusy(p.id); setMsg(null)
                            const e = await sendOne(p)
                            await onChanged(); setBusy(null)
                            setMsg(e ? { ok: false, text: e } : { ok: true, text: `${p.po_number} sent to ${emailOf(p)}.` })
                          }}>{busy === p.id ? 'Sending…' : 'Send'}</button>
                        )}
                        {canPay && <button type="button" className={cn(xs, 'bg-[#2563EB] text-white')} onClick={() => setOpen({ id: p.id, kind: 'pay' })}>Pay</button>}
                        {editable && <button type="button" className={xsO} onClick={() => setOpen({ id: p.id, kind: 'price' })}>Price</button>}
                        {editable && received === 0 && <button type="button" className={cn(xs, 'text-error hover:underline')} onClick={() => setOpen({ id: p.id, kind: 'cant' })}>Can&apos;t deliver</button>}
                        {cancelled && m.toRefund > 0.004 && <button type="button" className={xsO} onClick={() => setOpen({ id: p.id, kind: 'refund' })}>Refund received</button>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {cancelledCount > 0 && (
        <button type="button" onClick={() => setShowCancelled(v => !v)} className="self-start text-[11.5px] font-semibold text-[#2563EB] hover:underline">
          {showCancelled ? 'Hide cancelled' : `Show cancelled (${cancelledCount})`}
        </button>
      )}
      {shown.length > 0 && <p className="text-[11px] text-text-secondary">Amounts include VAT. Each purchase order has one supplier bill, set up when the order is sent. Every payment you record goes to Xero.</p>}

      {current && open?.kind === 'pay' && <PayModal po={current} bills={bills} pays={pays} onClose={() => setOpen(null)} onDone={done} />}
      {current && open?.kind === 'price' && (
        <PriceModal po={current} lines={linesOf(current.id)} canEmail={!!emailOf(current) && current.status !== 'approved'} supplierEmail={emailOf(current)}
          onClose={() => setOpen(null)}
          onSaved={async (email) => {
            let res = { ok: true, text: `${current.po_number} updated.` }
            if (email) {
              const e = await sendOne(current)
              res = e ? { ok: false, text: `Saved, but the email didn't go: ${e}` } : { ok: true, text: `${current.po_number} updated and emailed to ${emailOf(current)}.` }
            }
            await done(res.text, res.ok)
          }} />
      )}
      {current && open?.kind === 'cant' && (
        <CantDeliverModal po={current} companyId={companyId} quoteId={quoteId} lines={linesOf(current.id)} paid={poMoney(current, bills).paid} email={emailOf(current)}
          onClose={() => setOpen(null)} onDone={done} />
      )}
      {current && open?.kind === 'refund' && <RefundModal po={current} toRefund={poMoney(current, bills).toRefund} onClose={() => setOpen(null)} onDone={done} />}
    </div>
  )
}

function PayModal({ po, bills, pays, onClose, onDone }: { po: SupplyPo; bills: SupplyBill[]; pays: SupplyPay[]; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const m = poMoney(po, bills)
  const cur = po.currency ?? 'ZAR'
  const history = m.own ? pays.filter(x => x.source_id === m.own!.id && (x.transaction_type ?? 'supplier_payment') === 'supplier_payment') : []
  const [amount, setAmount] = useState(String(m.owing.toFixed(2)))
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('eft')
  const [ref, setRef] = useState(`${history.length ? 'Payment' : 'Deposit'} ${po.po_number ?? ''}`.trim())
  const [inv, setInv] = useState(m.own?.invoice_number ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amt = parseQty(amount)
  const bad = Number.isNaN(amt) || amt <= 0 || amt > m.owing + 0.005
  return (
    <Modal title={`Pay ${po.supplier?.name ?? 'the supplier'} · ${po.po_number ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnP} disabled={busy || bad} onClick={async () => {
          setBusy(true); setError(null)
          const r = await paySupplier(createClient(), po.id, { amount: amt, date, method, reference: ref, supplierInvoiceNo: inv })
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          const left = Math.max(0, m.owing - amt)
          await onDone(`${money(amt, cur)} paid to ${po.supplier?.name ?? 'the supplier'} for ${po.po_number}.${left > 0.004 ? ` ${money(left, cur)} still to pay.` : ' Paid in full.'} It goes to Xero within a minute.`)
        }}>{busy ? 'Saving…' : 'Record payment'}</button>
      </>}>
      <Err text={error} />
      <div className="flex flex-wrap gap-4 rounded-lg border border-divider px-3 py-2">
        <div><b className="block text-[14px] tabular-nums">{money(m.total, cur)}</b><span className="text-[10.5px] text-text-secondary">Bill total</span></div>
        <div><b className="block text-[14px] tabular-nums">{money(m.paid, cur)}</b><span className="text-[10.5px] text-text-secondary">Paid so far</span></div>
        <div><b className="block text-[14px] tabular-nums text-error">{money(m.owing, cur)}</b><span className="text-[10.5px] text-text-secondary">Still to pay</span></div>
      </div>
      {history.length > 0 && (
        <table className="w-full">
          <thead><tr className="border-b border-divider"><th className={TH}>Date</th><th className={TH}>How</th><th className={cn(TH, 'w-full')}>Reference</th><th className={cn(TH, '!text-right')}>Amount</th></tr></thead>
          <tbody>{history.map(h => (
            <tr key={h.id} className="border-b border-divider last:border-0">
              <td className={TD}>{fmtDay(h.transaction_date)}</td><td className={TD}>{(METHODS.find(x => x[0] === h.payment_method)?.[1]) ?? h.payment_method ?? '—'}</td>
              <td className={TD}>{h.reference_number ?? '—'}</td><td className={cn(TD, 'text-right tabular-nums')}>{money(n0(h.amount), cur)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={lab}>Amount<input className={cn(inp, bad && amount !== '' && '!border-error')} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className={lab}>Date<input className={inp} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className={lab}>How<select className={inp} value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className={lab}>Reference<input className={inp} value={ref} onChange={e => setRef(e.target.value)} /></label>
      </div>
      <label className={cn(lab, 'max-w-[240px]')}>Supplier&apos;s invoice no. (optional)<input className={inp} value={inv} onChange={e => setInv(e.target.value)} placeholder="From their invoice" /></label>
      <p className="text-[11px] text-text-secondary">Paying a deposit or part? Type that amount. You can pay the rest later, as many times as needed.</p>
    </Modal>
  )
}

function PriceModal({ po, lines, canEmail, supplierEmail, onClose, onSaved }: { po: SupplyPo; lines: OrderPoLine[]; canEmail: boolean; supplierEmail: string; onClose: () => void; onSaved: (email: boolean) => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, { q: string; p: string }>>(() => Object.fromEntries(lines.map(l => [l.id, { q: q3(n0(l.quantity_ordered)), p: String(n0(l.unit_price)) }])))
  const [email, setEmail] = useState(canEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cur = po.currency ?? 'ZAR'
  const parsed = lines.map(l => ({ l, q: parseQty(vals[l.id]?.q ?? ''), p: parseQty(vals[l.id]?.p ?? '') }))
  const bad = parsed.some(x => !(x.q > 0) || Number.isNaN(x.p) || x.p < 0 || x.q < n0(x.l.quantity_received))
  const total = parsed.reduce((s, x) => s + (bad ? 0 : x.q * x.p), 0)
  return (
    <Modal wide title={`Change price · ${po.po_number ?? 'PO'} · ${po.supplier?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnP} disabled={busy || bad} onClick={async () => {
          setBusy(true); setError(null)
          const r = await updatePoLines(createClient(), po.id, parsed.map(x => ({ id: x.l.id, quantity: x.q, unit_price: x.p })))
          if (!r.ok) { setBusy(false); setError(r.message); return }
          await onSaved(email && canEmail)
          setBusy(false)
        }}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <Err text={error} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-divider"><th className={cn(TH, 'w-full')}>Item</th><th className={cn(TH, '!text-right')}>Qty</th><th className={cn(TH, '!text-right')}>Was</th><th className={cn(TH, '!text-right')}>New price (excl. VAT)</th><th className={cn(TH, '!text-right')}>Line total</th></tr></thead>
          <tbody>{parsed.map(({ l, q, p }) => (
            <tr key={l.id} className="border-b border-divider last:border-0">
              <td className={cn(TD, '!whitespace-normal')}>{l.description}{q < n0(l.quantity_received) && <span className="block text-[11px] text-error">{q3(n0(l.quantity_received))} already arrived.</span>}</td>
              <td className={cn(TD, 'text-right')}><input className={qIn} inputMode="decimal" aria-label={`Qty: ${l.description}`} value={vals[l.id]?.q ?? ''} onChange={e => setVals(v => ({ ...v, [l.id]: { ...v[l.id], q: e.target.value } }))} /></td>
              <td className={cn(TD, 'text-right tabular-nums text-text-secondary')}>{money(n0(l.unit_price), cur)}</td>
              <td className={cn(TD, 'text-right')}><input className={cn(qIn, '!w-24')} inputMode="decimal" aria-label={`New price: ${l.description}`} value={vals[l.id]?.p ?? ''} onChange={e => setVals(v => ({ ...v, [l.id]: { ...v[l.id], p: e.target.value } }))} /></td>
              <td className={cn(TD, 'text-right tabular-nums font-semibold')}>{Number.isNaN(p) || !(q > 0) ? '—' : money(q * p, cur)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-[12px] text-right">New total excl. VAT: <b className="tabular-nums">{money(total, cur)}</b></p>
      <p className="text-[11.5px] text-text-secondary">The supplier&apos;s bill and &ldquo;still to pay&rdquo; update. Your profit on the order changes (only your team sees it). The client&apos;s price stays as quoted.</p>
      {canEmail && <label className="flex items-center gap-2 text-[12px] font-medium"><input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} className="w-4 h-4 accent-[#2563EB]" />Email {supplierEmail} the updated purchase order</label>}
    </Modal>
  )
}

type Supplier = { id: string; name: string; email: string | null }

function CantDeliverModal({ po, companyId, quoteId, lines, paid, email, onClose, onDone }: {
  po: SupplyPo; companyId: string; quoteId: string; lines: OrderPoLine[]; paid: number; email: string; onClose: () => void; onDone: (t: string, ok?: boolean) => Promise<void>
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Supplier | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.id, String(n0(l.unit_price))])))
  const [reason, setReason] = useState('')
  const [tell, setTell] = useState(!!po.sent_at && !!email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cur = po.currency ?? 'ZAR'
  const reorder = !!quoteId && lines.some(l => l.quote_line_id)
  useEffect(() => {
    if (!reorder) return
    void createClient().from('contractors').select('id, name, email').eq('company_id', companyId).eq('is_active', true).order('name').limit(1000)
      .then(({ data }) => setSuppliers(((data ?? []) as Supplier[]).filter(s => s.id !== po.supplier_id)))
  }, [companyId, po.supplier_id, reorder])
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (t ? suppliers.filter(s => s.name.toLowerCase().includes(t)) : suppliers).slice(0, 6)
  }, [q, suppliers])
  const badPrice = lines.some(l => { const v = parseQty(prices[l.id] ?? ''); return Number.isNaN(v) || v < 0 })

  async function go() {
    setBusy(true); setError(null)
    const supabase = createClient()
    const r = await cancelPo(supabase, po.id, reason || 'Supplier could not deliver')
    if (!r.ok) { setBusy(false); setError(r.message); return }
    let text = `${po.po_number} cancelled.`
    if (pick && reorder) {
      // The items go to the new supplier at the new price, then Process order makes their PO (ready to send).
      for (const l of lines) {
        if (!l.quote_line_id) continue
        await supabase.from('commercial_quote_lines').update({ supplier_id: pick.id, cost_price: parseQty(prices[l.id] ?? '0'), supply_mode: 'outsource' }).eq('id', l.quote_line_id)
      }
      const p = await processOrder(supabase, quoteId)
      text += p.ok && p.created.length ? ` New ${p.created.map(c => c.po_number).join(', ')} for ${pick.name} is ready to send.` : p.ok ? '' : ` The new PO wasn't made: ${p.message}`
    } else if (reorder) {
      text += ' Its items are back to "Ready for PO".'
    }
    if (paid > 0.004) text += ` ${money(paid, cur)} was paid to ${po.supplier?.name ?? 'them'}: it shows as "to be refunded" until you record the refund.`
    if (tell && email) {
      const body = `Hi,\n\nPlease cancel our purchase order ${po.po_number ?? ''}.${reason.trim() ? `\n\nReason: ${reason.trim()}` : ''}${paid > 0.004 ? `\n\nWe paid ${money(paid, cur)} on this order: please refund it.` : ''}\n\nThank you.`
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Cancelled: purchase order ${po.po_number ?? ''}`)}&body=${encodeURIComponent(body)}`
    }
    setBusy(false)
    await onDone(text)
  }

  return (
    <Modal wide title={`${po.po_number ?? 'PO'} · ${po.supplier?.name ?? 'Supplier'} can't deliver`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Back</button>
        <button type="button" className={cn(btnP, !pick && 'bg-error hover:bg-error/90')} disabled={busy || (!!pick && badPrice)} onClick={() => void go()}>
          {busy ? 'Working…' : pick ? `Cancel it and order from ${pick.name}` : 'Cancel the purchase order'}
        </button>
      </>}>
      <Err text={error} />
      <p className="text-[12.5px] text-text-primary">{po.po_number} will be cancelled.{paid > 0.004 ? ` You paid ${money(paid, cur)} on it: it will show as "to be refunded".` : ''}</p>
      <label className={lab}>Why? (optional)<input className={inp} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. out of stock" /></label>
      {reorder && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold">Order the items from someone else (optional)</p>
          {pick ? (
            <div className="flex items-center gap-2 rounded-lg border-[1.5px] border-[#2563EB] px-3 py-2 text-[12.5px]">
              <span className="material-icons !text-[16px] text-[#2563EB]">check_circle</span><b className="flex-1">{pick.name}</b>
              <button type="button" className="text-[11.5px] text-[#2563EB] font-semibold hover:underline" onClick={() => setPick(null)}>Change</button>
            </div>
          ) : (
            <>
              <input className={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="Search your suppliers…" aria-label="Search suppliers" />
              <div className="flex flex-wrap gap-1.5">
                {matches.map(s => <button key={s.id} type="button" onClick={() => setPick(s)} className="h-7 px-2.5 rounded-full border border-divider text-[11.5px] font-semibold hover:border-[#2563EB]">{s.name}</button>)}
                {matches.length === 0 && <span className="text-[11.5px] text-text-secondary">No supplier found. Add them under Suppliers first.</span>}
              </div>
            </>
          )}
          {pick && (
            <table className="w-full">
              <thead><tr className="border-b border-divider"><th className={cn(TH, 'w-full')}>Item</th><th className={cn(TH, '!text-right')}>Qty</th><th className={cn(TH, '!text-right')}>{pick.name}&apos;s price (excl. VAT)</th></tr></thead>
              <tbody>{lines.map(l => (
                <tr key={l.id} className="border-b border-divider last:border-0">
                  <td className={cn(TD, '!whitespace-normal')}>{l.description}</td><td className={cn(TD, 'text-right')}>{q3(n0(l.quantity_ordered))}</td>
                  <td className={cn(TD, 'text-right')}><input className={cn(qIn, '!w-24')} inputMode="decimal" aria-label={`Price: ${l.description}`} value={prices[l.id] ?? ''} onChange={e => setPrices(v => ({ ...v, [l.id]: e.target.value }))} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
      {email && <label className="flex items-center gap-2 text-[12px] font-medium"><input type="checkbox" checked={tell} onChange={e => setTell(e.target.checked)} className="w-4 h-4 accent-[#2563EB]" />Email {po.supplier?.name ?? 'the supplier'} that it&apos;s cancelled</label>}
    </Modal>
  )
}

function RefundModal({ po, toRefund, onClose, onDone }: { po: SupplyPo; toRefund: number; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [amount, setAmount] = useState(toRefund.toFixed(2))
  const [date, setDate] = useState(today())
  const [ref, setRef] = useState(`Refund ${po.po_number ?? ''}`.trim())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amt = parseQty(amount)
  const bad = Number.isNaN(amt) || amt <= 0 || amt > toRefund + 0.005
  const cur = po.currency ?? 'ZAR'
  return (
    <Modal title={`Refund from ${po.supplier?.name ?? 'the supplier'} · ${po.po_number ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnP} disabled={busy || bad} onClick={async () => {
          setBusy(true); setError(null)
          const r = await recordSupplierRefund(createClient(), po.id, { amount: amt, date, reference: ref })
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          await onDone(`Refund of ${money(amt, cur)} from ${po.supplier?.name ?? 'the supplier'} recorded. Record it in Xero too (as a refund on their bill).`)
        }}>{busy ? 'Saving…' : 'Record refund'}</button>
      </>}>
      <Err text={error} />
      <p className="text-[12.5px]">{money(toRefund, cur)} paid on the cancelled {po.po_number} is still to come back.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className={lab}>Amount refunded<input className={inp} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className={lab}>Date<input className={inp} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <label className={lab}>Reference<input className={inp} value={ref} onChange={e => setRef(e.target.value)} /></label>
    </Modal>
  )
}

// ── Goods received ───────────────────────────────────────────────────────────

export function GoodsReceivedPanel({ grns, grnLines, bills, pos, poLines = [], onChanged }: {
  grns: SupplyGrn[]; grnLines: SupplyGrnLine[]; bills: SupplyBill[]; pos: SupplyPo[]; poLines?: OrderPoLine[]; onChanged: () => Promise<void>
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState<{ id: string; kind: 'receive' | 'note' | 'cancel' } | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const poOf = (id: string | null | undefined) => pos.find(p => p.id === id) ?? null
  const liveGrnIds = new Set(grns.filter(g => g.status !== 'cancelled').map(g => g.id))
  const sentBack = (poLineId: string) => grnLines.filter(l => l.po_line_id === poLineId && liveGrnIds.has(l.grn_id)).reduce((s, l) => s + n0(l.quantity_rejected), 0)
  const openPos = pos.filter(p => !['cancelled', 'draft', 'pending_approval', 'rejected'].includes(String(p.status)))
  const waiting = openPos.flatMap(p => poLines.filter(l => l.po_id === p.id).map(l => ({ p, l })))
  const shownGrns = grns.filter(g => showCancelled || g.status !== 'cancelled')
  const cancelledCount = grns.filter(g => g.status === 'cancelled').length
  const done = async (t: string) => { setOpen(null); setMsg({ ok: true, text: t }); await onChanged() }
  const currentPo = open?.kind === 'receive' ? poOf(open.id) : null
  const currentGrn = open && open.kind !== 'receive' ? grns.find(g => g.id === open.id) ?? null : null

  return (
    <div className="flex flex-col gap-2.5">
      {msg && <p className={cn('text-[12.5px] rounded-lg px-3 py-2', msg.ok ? 'text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-200' : 'text-error bg-red-50')} role="status">{msg.text}</p>}

      <p className="text-[11.5px] font-semibold text-text-secondary px-0.5">What you&apos;re waiting for, item by item</p>
      {waiting.length === 0 ? <p className="text-[12.5px] text-text-secondary py-4 text-center">No open purchase orders.</p> : (
        <div className={cn(card, 'overflow-x-auto')}>
          <table className="w-full">
            <thead><tr className="border-b border-divider">
              <th className={TH}>PO</th><th className={TH}>Supplier</th><th className={cn(TH, 'w-full')}>Item</th>
              <th className={cn(TH, '!text-right')}>Ordered</th><th className={cn(TH, '!text-right')}>Received</th><th className={cn(TH, '!text-right')}>Sent back</th>
              <th className={cn(TH, '!text-right')}>Still to come</th><th className={TH}>Paid?</th><th className={TH} />
            </tr></thead>
            <tbody>
              {waiting.map(({ p, l }, i) => {
                const left = Math.max(0, n0(l.quantity_ordered) - n0(l.quantity_received))
                const back = sentBack(l.id)
                const m = poMoney(p, bills)
                const paid = m.paid <= 0.004 ? { t: 'Not paid', c: P.amber } : m.owing <= 0.004 ? { t: 'Paid', c: P.green } : { t: 'Part paid', c: P.amber }
                const firstOfPo = i === 0 || waiting[i - 1].p.id !== p.id
                const poLeft = poLines.filter(x => x.po_id === p.id).some(x => n0(x.quantity_received) < n0(x.quantity_ordered))
                return (
                  <tr key={l.id} className="border-b border-divider last:border-0">
                    <td className={TD}>{firstOfPo ? <Link href={`/dashboard/supply/purchase-orders/${p.id}`} className="font-semibold text-[#2563EB] hover:underline">{p.po_number}</Link> : ''}</td>
                    <td className={TD}>{firstOfPo ? p.supplier?.name ?? '—' : ''}</td>
                    <td className={cn(TD, 'max-w-[260px] truncate')} title={l.description ?? ''}>{l.description}</td>
                    <td className={cn(TD, 'text-right tabular-nums')}>{q3(n0(l.quantity_ordered))}</td>
                    <td className={cn(TD, 'text-right tabular-nums')}>{q3(n0(l.quantity_received))}</td>
                    <td className={cn(TD, 'text-right tabular-nums', back > 0 && 'text-error font-semibold')}>{q3(back)}</td>
                    <td className={cn(TD, 'text-right tabular-nums font-bold')}>{left > 0 ? q3(left) : <span className={cn(pill, P.green)}>All in</span>}</td>
                    <td className={TD}>{firstOfPo ? <span className={cn(pill, paid.c)}>{paid.t}</span> : ''}</td>
                    <td className={cn(TD, 'text-right')}>{firstOfPo && poLeft && <button type="button" className={cn(xs, 'bg-emerald-600 text-white hover:bg-emerald-700')} onClick={() => setOpen({ id: p.id, kind: 'receive' })}>Receive</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11.5px] font-semibold text-text-secondary px-0.5 mt-1">Every delivery, as it came</p>
      {shownGrns.length === 0 ? <p className="text-[12.5px] text-text-secondary py-4 text-center">Nothing received yet. When a delivery arrives, press Receive above.</p> : (
        <div className={cn(card, 'overflow-x-auto')}>
          <table className="w-full">
            <thead><tr className="border-b border-divider">
              <th className={TH}>Delivery</th><th className={TH}>Date</th><th className={TH}>PO</th><th className={TH}>Delivery note</th>
              <th className={cn(TH, 'w-full')}>Item</th><th className={cn(TH, '!text-right')}>Arrived</th><th className={cn(TH, '!text-right')}>Kept</th>
              <th className={cn(TH, '!text-right')}>Sent back</th><th className={TH}>Why sent back</th><th className={TH} />
            </tr></thead>
            <tbody>
              {shownGrns.map(g => {
                const ls = grnLines.filter(l => l.grn_id === g.id)
                const cancelled = g.status === 'cancelled'
                const bill = bills.find(b => b.grn_id === g.id)
                return (
                  <Fragment key={g.id}>
                    {(ls.length ? ls : [null]).map((l, j) => {
                      const kept = n0(l?.quantity_received)
                      const back = n0(l?.quantity_rejected)
                      return (
                        <tr key={`${g.id}-${j}`} className={cn('border-b border-divider', cancelled && 'opacity-60')}>
                          <td className={cn(TD, 'font-semibold')}>{j === 0 ? <>{g.grn_number ?? 'Delivery'}{cancelled && <span className={cn(pill, P.red, 'ml-1')}>Cancelled</span>}</> : ''}</td>
                          <td className={TD}>{j === 0 ? fmtDay(g.received_date) : ''}</td>
                          <td className={TD}>{j === 0 ? <span className="font-semibold text-[#2563EB]">{poOf(g.po_id)?.po_number ?? 'PO'}</span> : ''}</td>
                          <td className={TD}>{j === 0 ? g.delivery_note_number || '—' : ''}</td>
                          <td className={cn(TD, 'max-w-[240px] truncate')} title={l?.description ?? ''}>{l?.description ?? '—'}</td>
                          <td className={cn(TD, 'text-right tabular-nums')}>{q3(kept + back)}</td>
                          <td className={cn(TD, 'text-right tabular-nums')}>{q3(kept)}</td>
                          <td className={cn(TD, 'text-right tabular-nums', back > 0 && 'text-error font-semibold')}>{q3(back)}</td>
                          <td className={TD}>{back > 0 ? <span className={cn(pill, P.red)}>{l?.reject_reason ?? 'Sent back'}</span> : j === 0 && g.notes ? <span className="text-text-secondary">{g.notes}</span> : ''}</td>
                          <td className={cn(TD, 'text-right')}>
                            {j === 0 && !cancelled && (
                              <span className="inline-flex gap-1">
                                <button type="button" className={xsO} onClick={() => setOpen({ id: g.id, kind: 'note' })}>Fix note</button>
                                {!(bill && (bill.approval_status === 'approved' || n0(bill.amount_paid) > 0)) && <button type="button" className={cn(xs, 'text-error hover:underline')} onClick={() => setOpen({ id: g.id, kind: 'cancel' })}>Undo</button>}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {cancelledCount > 0 && (
        <button type="button" onClick={() => setShowCancelled(v => !v)} className="self-start text-[11.5px] font-semibold text-[#2563EB] hover:underline">
          {showCancelled ? 'Hide cancelled' : `Show cancelled (${cancelledCount})`}
        </button>
      )}
      <p className="text-[11px] text-text-secondary">Receiving is never blocked by payment. Items kept go into stock. Anything sent back stays &ldquo;still to come&rdquo; until the right item arrives. Typed a delivery wrong? Undo it and receive it again.</p>

      {currentPo && <ReceiveModal po={currentPo} lines={poLines.filter(l => l.po_id === currentPo.id)} bills={bills} onClose={() => setOpen(null)} onDone={done} />}
      {currentGrn && open?.kind === 'note' && <EditGrnModal grn={currentGrn} onClose={() => setOpen(null)} onDone={done} />}
      {currentGrn && open?.kind === 'cancel' && <CancelGrnModal grn={currentGrn} onClose={() => setOpen(null)} onDone={done} />}
    </div>
  )
}

function ReceiveModal({ po, lines, bills, onClose, onDone }: { po: SupplyPo; lines: OrderPoLine[]; bills: SupplyBill[]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const left = (l: OrderPoLine) => Math.max(0, n0(l.quantity_ordered) - n0(l.quantity_received))
  const [dn, setDn] = useState('')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.id, q3(left(l))])))
  const [back, setBack] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.id, '0'])))
  const [why, setWhy] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.id, REASONS[0]])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const m = poMoney(po, bills)
  const rows = lines.map(l => {
    const a = parseQty(qty[l.id] ?? '')
    const b = parseQty(back[l.id] ?? '')
    const wrong = Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || b > a || a - b > left(l) + 1e-9
    return { l, a, b, wrong }
  })
  const bad = rows.some(r => r.wrong)
  const any = rows.some(r => r.a > 0)
  const kept = rows.reduce((s, r) => s + (r.wrong ? 0 : r.a - r.b), 0)
  const sent = rows.reduce((s, r) => s + (r.wrong ? 0 : r.b), 0)
  const still = rows.reduce((s, r) => s + (r.wrong ? left(r.l) : left(r.l) - (r.a - r.b)), 0)
  return (
    <Modal wide title={`Receive goods · ${po.po_number ?? ''} · ${po.supplier?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnP} disabled={busy || bad || !any} onClick={async () => {
          setBusy(true); setError(null)
          const r = await receiveGoods(createClient(), po.id, dn, rows.map(x => ({ po_line_id: x.l.id, qty: x.a, rejected: x.b, reason: x.b > 0 ? why[x.l.id] : null })), notes)
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          await onDone(`${r.grn_number} recorded: ${q3(kept)} kept${sent > 0 ? `, ${q3(sent)} sent back` : ''}.${r.fully_received ? ` ${po.po_number} is fully received.` : ''}`)
        }}>{busy ? 'Saving…' : 'Record delivery'}</button>
      </>}>
      <Err text={error} />
      <div className="flex flex-wrap items-end gap-2">
        <label className={lab}>Supplier&apos;s delivery note no.<input className={cn(inp, 'w-40')} value={dn} onChange={e => setDn(e.target.value)} autoComplete="off" /></label>
        <span className={cn(pill, '!text-[11px] !px-2 !py-0.5 mb-1', m.owing <= 0.004 && m.paid > 0 ? P.green : P.amber)}>
          {m.owing <= 0.004 && m.paid > 0 ? '✓ Supplier paid in full' : m.paid > 0 ? `Part paid · ${money(m.owing, po.currency)} still owed` : `Not paid yet · ${money(m.owing, po.currency)} owed`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-divider">
            <th className={cn(TH, 'w-full')}>Item</th><th className={cn(TH, '!text-right')}>Still to come</th><th className={cn(TH, '!text-right')}>Arrived now</th>
            <th className={cn(TH, '!text-right')}>Sent back</th><th className={TH}>Why</th>
          </tr></thead>
          <tbody>{rows.map(({ l, b, wrong }) => (
            <tr key={l.id} className="border-b border-divider last:border-0">
              <td className={cn(TD, '!whitespace-normal font-medium')}>{l.description}{wrong && <span className="block text-[11px] text-error">Kept can be at most {q3(left(l))}; sent back can&apos;t be more than arrived.</span>}</td>
              <td className={cn(TD, 'text-right tabular-nums')}>{q3(left(l))}</td>
              <td className={cn(TD, 'text-right')}><input className={cn(qIn, wrong && '!border-error')} inputMode="decimal" disabled={left(l) <= 0} aria-label={`Arrived now: ${l.description}`} value={qty[l.id] ?? ''} onChange={e => setQty(x => ({ ...x, [l.id]: e.target.value }))} /></td>
              <td className={cn(TD, 'text-right')}><input className={cn(qIn, wrong && '!border-error')} inputMode="decimal" disabled={left(l) <= 0} aria-label={`Sent back: ${l.description}`} value={back[l.id] ?? ''} onChange={e => setBack(x => ({ ...x, [l.id]: e.target.value }))} /></td>
              <td className={TD}><select className={cn(inp, 'w-32', !(b > 0) && 'opacity-50')} disabled={!(b > 0)} aria-label={`Why sent back: ${l.description}`} value={why[l.id]} onChange={e => setWhy(x => ({ ...x, [l.id]: e.target.value }))}>{REASONS.map(r => <option key={r}>{r}</option>)}</select></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <label className={lab}>Note (optional)<input className={inp} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. wrong length delivered, driver took it back" /></label>
      {!bad && any && (
        <p className="text-[12px]"><b>{q3(kept)} kept</b> go into stock.{sent > 0 && <> <b className="text-error">{q3(sent)} sent back</b> stay still to come.</>} After this, <b>{q3(still)}</b> {still === 1 ? 'is' : 'are'} still to come from {po.supplier?.name ?? 'the supplier'}.</p>
      )}
    </Modal>
  )
}

function EditGrnModal({ grn, onClose, onDone }: { grn: SupplyGrn; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [dn, setDn] = useState(grn.delivery_note_number ?? '')
  const [notes, setNotes] = useState(grn.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={`Fix the delivery note · ${grn.grn_number ?? 'delivery'}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnP} disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await updateDelivery(createClient(), grn.id, dn, notes)
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          await onDone(`${grn.grn_number} saved.`)
        }}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <Err text={error} />
      <label className={lab}>Supplier&apos;s delivery note no.<input className={inp} value={dn} onChange={e => setDn(e.target.value)} /></label>
      <label className={lab}>Note<input className={inp} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </Modal>
  )
}

function CancelGrnModal({ grn, onClose, onDone }: { grn: SupplyGrn; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={`Undo ${grn.grn_number ?? 'this delivery'}?`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Keep it</button>
        <button type="button" className={cn(btnP, 'bg-error hover:bg-error/90')} disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await cancelDelivery(createClient(), grn.id, reason)
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          await onDone(`${grn.grn_number} undone. The items are back to "still to come".`)
        }}>{busy ? 'Undoing…' : 'Undo the delivery'}</button>
      </>}>
      <Err text={error} />
      <p className="text-[12.5px]">The items go back to &ldquo;still to come&rdquo; and stock items come back out of stock. Then receive it again with the right numbers.</p>
      <label className={lab}>Why? (optional)<input className={inp} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. wrong quantity typed" /></label>
    </Modal>
  )
}
