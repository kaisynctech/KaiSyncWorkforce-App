'use client'

/**
 * The Order page's supply side (boards 6 and 7): purchase orders (send, receive goods, edit, cancel) and the goods
 * received (each delivery with its own bill waiting for approval; fix the delivery note or cancel).
 * Tables, always. Receive / Update price / Cancel open right under their row (no pop-ups).
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currencies'
import { companyLetterhead } from '@/lib/letterhead'
import { pdfBase64 } from '@/lib/document-pdf'
import { sendDocumentEmail } from '@/lib/money/document-email'
import { buildPoPdf } from '@/lib/money/po-pdf'
import {
  PO_STATUS, cancelDelivery, cancelPo, parseQty, readyToSend, receiveGoods, updateDelivery, updatePoLines,
  type OrderPoLine,
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
export type SupplyGrnLine = { grn_id: string; description: string | null; quantity_received: number | null }
export type SupplyBill = {
  id: string; bill_number: string | null; invoice_number: string | null; grn_id: string | null; po_id: string | null
  status: string | null; approval_status: string | null; total_amount: number | null; currency: string | null
}

const fmtDay = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—')
const q3 = (n: number) => String(Math.round(n * 1000) / 1000)
const card = 'rounded-xl border border-divider bg-surface'
const btn = 'h-9 px-3 rounded-lg border border-divider bg-surface text-[12.5px] font-semibold text-text-primary hover:border-[#2563EB]/50 disabled:opacity-50 whitespace-nowrap'
const btnP = 'h-9 px-3 rounded-lg bg-[#2563EB] text-white text-[12.5px] font-semibold hover:bg-[#1D4ED8] disabled:opacity-50 whitespace-nowrap'
const sm = 'h-7 px-2.5 rounded-md text-[12px] font-semibold whitespace-nowrap disabled:opacity-50'
const TH = 'px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-primary whitespace-nowrap'
const TD = 'px-2.5 py-2 text-[12.5px] text-text-primary align-middle'
const inp = 'h-9 w-24 px-2 rounded-lg border-2 border-[#2563EB]/60 bg-surface text-right text-[13.5px] font-semibold focus:outline-none focus:border-[#2563EB]'
const pill = 'inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap'

/** Width of a scrolling table box, so a form opened under a row fits the screen instead of the wide table. */
function useBoxWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  })
  return { ref, w }
}

/** Opens right under its row: a title, the form, and the buttons. */
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="m-2 rounded-xl border-2 border-[#2563EB]/40 bg-surface overflow-hidden" role="region" aria-label={title}>
      <header className="flex items-center gap-2 px-3 h-11 border-b border-divider">
        <h3 className="flex-1 text-[13.5px] font-semibold text-text-primary truncate">{title}</h3>
        <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary" aria-label="Close"><span className="material-icons !text-[18px]">close</span></button>
      </header>
      <div className="px-3 py-3 flex flex-col gap-3">{children}</div>
      <footer className="px-3 py-2.5 border-t border-divider flex flex-wrap gap-2 justify-end">{footer}</footer>
    </div>
  )
}

// ── Purchase orders ──────────────────────────────────────────────────────────

export function PurchaseOrdersPanel({ companyId, pos, poLines, sendTo, toSource, canProcess, processing, onProcess, onChanged, quoteId }: {
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
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [panel, setPanel] = useState<{ id: string; kind: 'receive' | 'edit' | 'cancel' } | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const ready = readyToSend(pos)
  const cancelledCount = pos.filter(p => p.status === 'cancelled').length
  const shown = pos.filter(p => showCancelled || p.status !== 'cancelled')
  const box = useBoxWidth()
  const linesOf = (id: string) => poLines.filter(l => l.po_id === id)
  const emailOf = (p: SupplyPo) => (p.supplier_id ? sendTo.get(p.supplier_id) : undefined) ?? p.supplier?.email ?? ''

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
    <div className="flex flex-col gap-3">
      {msg && <p className={cn('text-[13px] rounded-lg px-3 py-2', msg.ok ? 'text-emerald-800 bg-emerald-50' : 'text-error bg-error/10')} role="status">{msg.text}</p>}

      {canProcess && (
        <div className={cn(card, 'px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-primary/30')}>
          <p className="text-[13.5px] text-text-primary">Items with a chosen supplier aren&apos;t on a purchase order yet.</p>
          <button type="button" className={btnP} disabled={processing} onClick={onProcess}>{processing ? 'Creating…' : 'Process order'}</button>
        </div>
      )}
      {toSource > 0 && (
        <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {toSource} item{toSource === 1 ? ' still needs' : 's still need'} a supplier. <Link href={`/dashboard/money/quotes/${quoteId}`} className="underline font-medium">Choose on the quote&apos;s Buyout tab</Link>, then Process order again.
        </p>
      )}
      {ready.length > 0 && (
        <div className={cn(card, 'px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-amber-50/60 border-amber-200')}>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary">{ready.length} purchase order{ready.length === 1 ? ' is' : 's are'} ready to send</p>
            <p className="text-[12.5px] text-text-secondary">Check who each goes to below. Each supplier gets their own email with the PO attached.</p>
          </div>
          <button type="button" className={btnP} disabled={busy !== null} onClick={() => void sendAll()}>{busy === 'send' ? 'Sending…' : `Send all (${ready.length})`}</button>
        </div>
      )}

      {pos.length === 0 && !canProcess && <p className="text-[13px] text-text-secondary py-6 text-center">No purchase orders for this order.</p>}

      {shown.length > 0 && (
        <div className={cn(card, 'overflow-hidden')}>
          <div ref={box.ref} className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 760 }}>
              <thead><tr className="border-b border-divider">
                <th className={TH}>PO</th><th className={TH}>Supplier</th><th className={cn(TH, 'w-full min-w-[220px]')}>Items</th>
                <th className={cn(TH, '!text-right')}>Amount excl. VAT</th><th className={cn(TH, '!text-right')}>Received</th><th className={TH}>Status</th><th className={TH} />
              </tr></thead>
              <tbody>
                {shown.map(p => {
                  const ls = linesOf(p.id)
                  const ordered = ls.reduce((s, l) => s + (Number(l.quantity_ordered) || 0), 0)
                  const received = ls.reduce((s, l) => s + (Number(l.quantity_received) || 0), 0)
                  const st = PO_STATUS[String(p.status)] ?? { label: String(p.status ?? '—'), cls: 'bg-slate-100 text-slate-700' }
                  const open = !['cancelled', 'received', 'draft', 'pending_approval', 'rejected'].includes(String(p.status))
                  const editable = !['cancelled', 'received'].includes(String(p.status))
                  const items = ls.map(l => `${l.description ?? 'Item'} × ${q3(Number(l.quantity_ordered) || 0)}`)
                  const isOpen = panel?.id === p.id
                  return (
                    <Fragment key={p.id}>
                      <tr className={cn('border-b border-divider', isOpen && 'bg-[#2563EB]/[0.04]')}>
                        <td className={cn(TD, 'whitespace-nowrap')}><Link href={`/dashboard/supply/purchase-orders/${p.id}`} className="font-semibold text-[#2563EB] hover:underline">{p.po_number ?? 'PO'}</Link></td>
                        <td className={cn(TD, 'whitespace-nowrap')}>{p.supplier?.name ?? 'Supplier'}
                          <span className="block text-[11px] text-text-secondary">{p.status === 'approved' ? `To ${emailOf(p) || 'no email yet'}` : p.sent_at ? `Sent ${fmtDay(p.sent_at)}` : `Made ${fmtDay(p.created_at)}`}{p.required_delivery_date ? ` · due ${fmtDay(p.required_delivery_date)}` : ''}</span></td>
                        <td className={TD} title={items.join(', ')}>{items[0] ?? '—'}{items.length > 1 && <span className="text-text-secondary"> +{items.length - 1} more</span>}</td>
                        <td className={cn(TD, 'text-right tabular-nums font-semibold whitespace-nowrap')}>{formatCurrency(Number(p.subtotal) || 0, p.currency ?? 'ZAR')}</td>
                        <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap')}><b>{q3(received)}</b> of {q3(ordered)}</td>
                        <td className={TD}><span className={cn(pill, st.cls)}>{st.label}</span></td>
                        <td className={cn(TD, 'whitespace-nowrap text-right')}>
                          {p.status !== 'cancelled' && <span className="inline-flex gap-1.5">
                            {p.status === 'approved' && (
                              <button type="button" className={cn(sm, 'bg-[#2563EB] text-white')} disabled={busy !== null} onClick={async () => {
                                setBusy(p.id); setMsg(null)
                                const e = await sendOne(p)
                                await onChanged(); setBusy(null)
                                setMsg(e ? { ok: false, text: e } : { ok: true, text: `${p.po_number} sent.` })
                              }}>{busy === p.id ? 'Sending…' : 'Send'}</button>
                            )}
                            {open && <button type="button" className={cn(sm, p.status === 'approved' ? 'border border-divider text-text-primary' : 'bg-emerald-600 text-white')} disabled={busy !== null} onClick={() => setPanel(isOpen && panel?.kind === 'receive' ? null : { id: p.id, kind: 'receive' })}>Receive</button>}
                            {editable && <button type="button" className={cn(sm, 'border border-divider text-text-primary')} disabled={busy !== null} onClick={() => setPanel(isOpen && panel?.kind === 'edit' ? null : { id: p.id, kind: 'edit' })}>Update price</button>}
                            {editable && received === 0 && <button type="button" className={cn(sm, 'text-error')} disabled={busy !== null} onClick={() => setPanel(isOpen && panel?.kind === 'cancel' ? null : { id: p.id, kind: 'cancel' })}>Cancel</button>}
                          </span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-divider"><td colSpan={7} className="p-0"><div className="sticky left-0" style={{ width: box.w ?? undefined }}>
                          {panel!.kind === 'receive' && <ReceiveSheet po={p} lines={ls} onClose={() => setPanel(null)}
                            onDone={async (text) => { setPanel(null); setMsg({ ok: true, text }); await onChanged() }} />}
                          {panel!.kind === 'edit' && <PoEditSheet po={p} lines={ls} canEmail={!!emailOf(p) && p.status !== 'approved'}
                            onClose={() => setPanel(null)}
                            onSaved={async (email) => {
                              let res: { ok: boolean; text: string } = { ok: true, text: `${p.po_number} updated.` }
                              if (email) {
                                const e = await sendOne(p)
                                res = e ? { ok: false, text: `Saved, but the email didn't go: ${e}` } : { ok: true, text: `${p.po_number} updated and emailed to ${emailOf(p)}.` }
                              }
                              setPanel(null); setMsg(res); await onChanged()
                            }} />}
                          {panel!.kind === 'cancel' && <CancelPoSheet po={p} email={emailOf(p)} onClose={() => setPanel(null)}
                            onDone={async (text) => { setPanel(null); setMsg({ ok: true, text }); await onChanged() }} />}
                        </div></td></tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {cancelledCount > 0 && (
        <button type="button" onClick={() => setShowCancelled(v => !v)} className="self-start text-[12px] font-semibold text-[#2563EB] hover:underline">
          {showCancelled ? 'Hide cancelled' : `Show cancelled (${cancelledCount})`}
        </button>
      )}
    </div>
  )
}

function ReceiveSheet({ po, lines, onClose, onDone }: { po: SupplyPo; lines: OrderPoLine[]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const left = (l: OrderPoLine) => Math.max(0, (Number(l.quantity_ordered) || 0) - (Number(l.quantity_received) || 0))
  const [dn, setDn] = useState('')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.id, q3(left(l))])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cur = po.currency ?? 'ZAR'
  const now = lines.map(l => ({ l, n: parseQty(qty[l.id] ?? '') }))
  const bad = now.some(x => Number.isNaN(x.n) || x.n < 0 || x.n > left(x.l) + 1e-9)
  const value = now.reduce((s, x) => s + (Number.isNaN(x.n) ? 0 : x.n * (Number(x.l.unit_price) || 0)), 0)
  const any = now.some(x => x.n > 0)

  async function record() {
    setBusy(true); setError(null)
    const r = await receiveGoods(createClient(), po.id, dn, now.map(x => ({ po_line_id: x.l.id, qty: x.n })), notes)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    await onDone(`${r.grn_number} recorded${r.fully_received ? `: ${po.po_number} is fully received` : ''}. Its bill is waiting for approval.`)
  }

  return (
    <Sheet title={`Receive goods · ${po.po_number ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btnP} disabled={busy || bad || !any} onClick={() => void record()}>{busy ? 'Recording…' : 'Record delivery'}</button>
      </>}>
      <p className="text-[13px] text-text-secondary">{po.supplier?.name ?? 'Supplier'} · type what arrived now. Anything still to come stays open on the PO.</p>
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
      <label className="text-[12.5px] font-medium text-text-secondary">Supplier delivery note no.
        <input value={dn} onChange={e => setDn(e.target.value)} className="mt-1 w-full max-w-xs h-10 px-3 bg-surface border border-divider rounded-lg text-[14px] block" autoComplete="off" />
      </label>
      <div className="overflow-x-auto rounded-lg border border-divider">
        <table className="w-full" style={{ minWidth: 520 }}>
          <thead><tr className="border-b border-divider">
            <th className={cn(TH, 'w-full')}>Item</th><th className={cn(TH, '!text-right')}>Ordered</th><th className={cn(TH, '!text-right')}>Already in</th>
            <th className={cn(TH, '!text-right')}>Arrived now</th><th className={cn(TH, '!text-right')}>Still to come</th>
          </tr></thead>
          <tbody>
            {lines.map(l => {
              const n = parseQty(qty[l.id] ?? '')
              const wrong = Number.isNaN(n) || n < 0 || n > left(l) + 1e-9
              return (
                <tr key={l.id} className="border-b border-divider last:border-0">
                  <td className={cn(TD, 'font-medium')}>{l.description}{wrong && <span className="block text-[11.5px] text-error">At most {q3(left(l))}.</span>}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{q3(Number(l.quantity_ordered) || 0)}</td>
                  <td className={cn(TD, 'text-right tabular-nums')}>{q3(Number(l.quantity_received) || 0)}</td>
                  <td className={cn(TD, 'text-right')}>
                    <input value={qty[l.id] ?? ''} onChange={e => setQty(x => ({ ...x, [l.id]: e.target.value }))} inputMode="decimal" disabled={left(l) <= 0}
                      aria-label={`Arrived now: ${l.description}`} className={cn(inp, wrong && '!border-error')} />
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums font-semibold')}>{wrong ? '—' : q3(left(l) - n)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <label className="text-[12.5px] font-medium text-text-secondary">Notes (optional)
        <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full h-10 px-3 bg-surface border border-divider rounded-lg text-[14px] block" placeholder="e.g. one box damaged" />
      </label>
      <p className="text-[12.5px] text-text-secondary">
        Recording this adds stock items to stock and makes a bill for this delivery ({formatCurrency(value, cur)} excl. VAT), waiting for your approval. Once approved it goes to Xero.
      </p>
    </Sheet>
  )
}

function PoEditSheet({ po, lines, canEmail, onClose, onSaved }: { po: SupplyPo; lines: OrderPoLine[]; canEmail: boolean; onClose: () => void; onSaved: (email: boolean) => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, { q: string; p: string }>>(() => Object.fromEntries(lines.map(l => [l.id, { q: q3(Number(l.quantity_ordered) || 0), p: String(Number(l.unit_price) || 0) }])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = lines.map(l => ({ l, q: parseQty(vals[l.id]?.q ?? ''), p: parseQty(vals[l.id]?.p ?? '') }))
  const bad = parsed.some(x => !(x.q > 0) || Number.isNaN(x.p) || x.p < 0 || x.q < (Number(x.l.quantity_received) || 0))
  const total = parsed.reduce((s, x) => s + (bad ? 0 : x.q * x.p), 0)

  async function save(email: boolean) {
    setBusy(true); setError(null)
    const r = await updatePoLines(createClient(), po.id, parsed.map(x => ({ id: x.l.id, quantity: x.q, unit_price: x.p })))
    if (!r.ok) { setBusy(false); setError(r.message); return }
    await onSaved(email)
    setBusy(false)
  }

  return (
    <Sheet title={`Update price · ${po.po_number ?? 'PO'} · ${po.supplier?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btn} disabled={busy || bad} onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save'}</button>
        {canEmail && <button type="button" className={btnP} disabled={busy || bad} onClick={() => void save(true)}>Save and email the updated PO</button>}
      </>}>
      <p className="text-[12.5px] text-text-secondary">Supplier changed the price? Type the new price. You can change a PO until all of it is received.</p>
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-divider">
        <table className="w-full" style={{ minWidth: 480 }}>
          <thead><tr className="border-b border-divider">
            <th className={cn(TH, 'w-full')}>Item</th><th className={cn(TH, '!text-right')}>Qty</th><th className={cn(TH, '!text-right')}>Supplier price (excl. VAT)</th><th className={cn(TH, '!text-right')}>Line total</th>
          </tr></thead>
          <tbody>
            {parsed.map(({ l, q, p }) => (
              <tr key={l.id} className="border-b border-divider last:border-0">
                <td className={cn(TD, 'font-medium')}>{l.description}
                  {q < (Number(l.quantity_received) || 0) && <span className="block text-[11.5px] text-error">{q3(Number(l.quantity_received) || 0)} have already arrived.</span>}
                  {Math.abs(p - (Number(l.unit_price) || 0)) > 0.004 && !Number.isNaN(p) && <span className="block text-[11.5px] text-amber-700 dark:text-amber-300">Was {formatCurrency(Number(l.unit_price) || 0, po.currency ?? 'ZAR')}</span>}
                </td>
                <td className={cn(TD, 'text-right')}><input value={vals[l.id]?.q ?? ''} inputMode="decimal" aria-label={`Qty: ${l.description}`} onChange={e => setVals(v => ({ ...v, [l.id]: { ...v[l.id], q: e.target.value } }))} className={cn(inp, '!w-20')} /></td>
                <td className={cn(TD, 'text-right')}><input value={vals[l.id]?.p ?? ''} inputMode="decimal" aria-label={`Supplier price: ${l.description}`} onChange={e => setVals(v => ({ ...v, [l.id]: { ...v[l.id], p: e.target.value } }))} className={cn(inp, '!w-28')} /></td>
                <td className={cn(TD, 'text-right tabular-nums font-semibold whitespace-nowrap')}>{Number.isNaN(p) || !(q > 0) ? '—' : formatCurrency(q * p, po.currency ?? 'ZAR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-right">New total excl. VAT: <b className="tabular-nums">{formatCurrency(total, po.currency ?? 'ZAR')}</b></p>
      <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        If the supplier&apos;s price changes, the order&apos;s profit changes too (team only). The client&apos;s price stays as quoted unless you also change the quote.
      </p>
    </Sheet>
  )
}

function CancelPoSheet({ po, email, onClose, onDone }: { po: SupplyPo; email: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const wasSent = !!po.sent_at
  const mail = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Cancelled: purchase order ${po.po_number ?? ''}`)}&body=${encodeURIComponent(`Hi,\n\nPlease cancel our purchase order ${po.po_number ?? ''}.${reason.trim() ? `\n\nReason: ${reason.trim()}` : ''}\n\nThank you.`)}`

  return (
    <Sheet title={`Cancel ${po.po_number ?? 'PO'}?`} onClose={onClose}
      footer={done ? <button type="button" className={btnP} onClick={() => void onDone(`${po.po_number} cancelled. Its items are back to "Ready for PO".`)}>Done</button> : <>
        <button type="button" className={btn} onClick={onClose}>Keep it</button>
        <button type="button" className={cn(btnP, 'bg-error hover:bg-error/90')} disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await cancelPo(createClient(), po.id, reason)
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          if (wasSent && email) setDone(true)
          else await onDone(`${po.po_number} cancelled. Its items are back to "Ready for PO".`)
        }}>{busy ? 'Cancelling…' : 'Cancel the PO'}</button>
      </>}>
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
      {!done ? (
        <>
          <p className="text-[13.5px]">{po.supplier?.name ?? 'The supplier'} {wasSent ? 'already has this PO.' : 'hasn’t been sent this PO yet.'} Its items go back to &ldquo;Ready for PO&rdquo;, so you can choose another supplier or Process order again.</p>
          <label className="text-[12.5px] font-medium text-text-secondary">Reason (optional)
            <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-divider bg-surface text-[14px] block" placeholder="e.g. out of stock, found it cheaper" />
          </label>
        </>
      ) : (
        <>
          <p className="text-[13.5px]">Cancelled. Let {po.supplier?.name ?? 'the supplier'} know:</p>
          <a href={mail} className={cn(btnP, 'inline-flex items-center justify-center')}>Email the supplier the cancellation</a>
        </>
      )}
    </Sheet>
  )
}

// ── Goods received ───────────────────────────────────────────────────────────

export function GoodsReceivedPanel({ grns, grnLines, bills, pos, onChanged }: {
  grns: SupplyGrn[]; grnLines: SupplyGrnLine[]; bills: SupplyBill[]; pos: SupplyPo[]; onChanged: () => Promise<void>
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [panel, setPanel] = useState<{ id: string; kind: 'edit' | 'cancel' } | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const poNo = (id: string | null) => pos.find(p => p.id === id)?.po_number ?? 'PO'
  const supplierOf = (id: string | null) => pos.find(p => p.id === id)?.supplier?.name ?? '—'
  const cancelledCount = grns.filter(g => g.status === 'cancelled').length
  const shown = grns.filter(g => showCancelled || g.status !== 'cancelled')
  const box = useBoxWidth()
  const done = async (t: string) => { setPanel(null); setMsg({ ok: true, text: t }); await onChanged() }

  return (
    <div className="flex flex-col gap-3">
      {msg && <p className={cn('text-[13px] rounded-lg px-3 py-2', msg.ok ? 'text-emerald-800 bg-emerald-50' : 'text-error bg-error/10')} role="status">{msg.text}</p>}
      {shown.length === 0 && <p className="text-[13px] text-text-secondary py-6 text-center">Nothing received yet. When a delivery arrives, press Receive on its purchase order.</p>}
      {shown.length > 0 && (
        <div className={cn(card, 'overflow-hidden')}>
          <div ref={box.ref} className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 760 }}>
              <thead><tr className="border-b border-divider">
                <th className={TH}>Delivery</th><th className={TH}>Date</th><th className={TH}>Supplier · PO</th><th className={TH}>Delivery note</th>
                <th className={cn(TH, 'w-full min-w-[220px]')}>What arrived</th><th className={TH}>Supplier bill</th><th className={TH} />
              </tr></thead>
              <tbody>
                {shown.map(g => {
                  const bill = bills.find(b => b.grn_id === g.id)
                  const items = grnLines.filter(l => l.grn_id === g.id).map(l => `${l.description ?? 'Item'} × ${q3(Number(l.quantity_received) || 0)}`)
                  const cancelled = g.status === 'cancelled'
                  const billPill = !bill ? null : bill.status === 'cancelled' ? { t: 'Cancelled', c: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' }
                    : bill.approval_status === 'approved' ? { t: `Approved · ${formatCurrency(Number(bill.total_amount) || 0, bill.currency ?? 'ZAR')}`, c: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' }
                    : { t: `To approve · ${formatCurrency(Number(bill.total_amount) || 0, bill.currency ?? 'ZAR')}`, c: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' }
                  const isOpen = panel?.id === g.id
                  return (
                    <Fragment key={g.id}>
                      <tr className={cn('border-b border-divider', isOpen && 'bg-[#2563EB]/[0.04]')}>
                        <td className={cn(TD, 'whitespace-nowrap font-semibold')}>{g.grn_number ?? 'Delivery'}{cancelled && <span className={cn(pill, 'ml-1.5 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300')}>Cancelled</span>}</td>
                        <td className={cn(TD, 'whitespace-nowrap')}>{fmtDay(g.received_date)}</td>
                        <td className={cn(TD, 'whitespace-nowrap')}>{supplierOf(g.po_id)} · <span className="font-semibold">{poNo(g.po_id)}</span></td>
                        <td className={cn(TD, 'whitespace-nowrap')}>{g.delivery_note_number || '—'}</td>
                        <td className={TD} title={items.join(', ')}>{items[0] ?? '—'}{items.length > 1 && <span className="text-text-secondary"> +{items.length - 1} more</span>}{g.notes && <span className="block text-[11.5px] text-text-secondary">{g.notes}</span>}</td>
                        <td className={cn(TD, 'whitespace-nowrap')}>{bill && billPill ? <Link href={`/dashboard/finance/supplier-invoices/${bill.id}`} className={cn(pill, billPill.c, 'hover:underline')}>{bill.bill_number ? `${bill.bill_number} · ` : ''}{billPill.t}</Link> : '—'}</td>
                        <td className={cn(TD, 'whitespace-nowrap text-right')}>
                          {!cancelled && <span className="inline-flex gap-1.5">
                            <button type="button" className={cn(sm, 'border border-divider text-text-primary')} onClick={() => setPanel(isOpen && panel?.kind === 'edit' ? null : { id: g.id, kind: 'edit' })}>Fix note</button>
                            {bill?.approval_status !== 'approved' && <button type="button" className={cn(sm, 'text-error')} onClick={() => setPanel(isOpen && panel?.kind === 'cancel' ? null : { id: g.id, kind: 'cancel' })}>Cancel</button>}
                          </span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-divider"><td colSpan={7} className="p-0"><div className="sticky left-0" style={{ width: box.w ?? undefined }}>
                          {panel!.kind === 'edit' && <EditGrnSheet grn={g} onClose={() => setPanel(null)} onDone={done} />}
                          {panel!.kind === 'cancel' && <CancelGrnSheet grn={g} onClose={() => setPanel(null)} onDone={done} />}
                        </div></td></tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {cancelledCount > 0 && (
        <button type="button" onClick={() => setShowCancelled(v => !v)} className="self-start text-[12px] font-semibold text-[#2563EB] hover:underline">
          {showCancelled ? 'Hide cancelled' : `Show cancelled (${cancelledCount})`}
        </button>
      )}
      <p className="text-[12px] text-text-secondary">Wrong quantity? Cancel the delivery and receive it again: the items go back to &ldquo;still to come&rdquo; and its bill is cancelled.</p>
    </div>
  )
}

function EditGrnSheet({ grn, onClose, onDone }: { grn: SupplyGrn; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [dn, setDn] = useState(grn.delivery_note_number ?? '')
  const [notes, setNotes] = useState(grn.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={`Fix the delivery note · ${grn.grn_number ?? 'delivery'}`} onClose={onClose}
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
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
      <label className="text-[12.5px] font-medium text-text-secondary">Supplier delivery note no.
        <input value={dn} onChange={e => setDn(e.target.value)} className="mt-1 w-full max-w-xs h-10 px-3 bg-surface border border-divider rounded-lg text-[14px] block" />
      </label>
      <label className="text-[12.5px] font-medium text-text-secondary">Notes
        <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full h-10 px-3 bg-surface border border-divider rounded-lg text-[14px] block" />
      </label>
    </Sheet>
  )
}

function CancelGrnSheet({ grn, onClose, onDone }: { grn: SupplyGrn; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={`Cancel ${grn.grn_number ?? 'this delivery'}?`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Keep it</button>
        <button type="button" className={cn(btnP, 'bg-error hover:bg-error/90')} disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await cancelDelivery(createClient(), grn.id, reason)
          setBusy(false)
          if (!r.ok) { setError(r.message); return }
          await onDone(`${grn.grn_number} cancelled. The items are back to "still to come" and its bill is cancelled.`)
        }}>{busy ? 'Cancelling…' : 'Cancel the delivery'}</button>
      </>}>
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
      <p className="text-[13.5px]">The items go back to &ldquo;still to come&rdquo; on the PO, stock items are taken back out of stock, and this delivery&apos;s bill is cancelled.</p>
      <label className="text-[12.5px] font-medium text-text-secondary">Reason (optional)
        <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full h-10 px-3 rounded-lg border border-divider bg-surface text-[14px] block" placeholder="e.g. wrong quantity typed" />
      </label>
    </Sheet>
  )
}
