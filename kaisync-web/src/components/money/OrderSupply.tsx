'use client'

/**
 * The Order page's supply side (boards 6 and 7): purchase orders (send, receive goods, edit, cancel) and the goods
 * received (each delivery with its own bill waiting for approval; fix the delivery note or cancel). Phone first:
 * cards, and sheets that slide up from the bottom.
 */

import { useState } from 'react'
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
const btn = 'h-10 px-3 rounded-lg border border-divider bg-surface text-[13px] font-semibold text-text-primary hover:bg-surface-elevated disabled:opacity-50'
const btnP = 'h-10 px-3 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50'
const pill = 'inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap'

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-background w-full sm:max-w-xl max-h-[94vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[15.5px] font-semibold truncate">{title}</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close"><span className="material-icons">close</span></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 [&>*]:shrink-0">{children}</div>
        <footer className="px-4 py-3 border-t border-divider flex flex-wrap gap-2 justify-end shrink-0">{footer}</footer>
      </div>
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
  const [receiving, setReceiving] = useState<SupplyPo | null>(null)
  const [editing, setEditing] = useState<SupplyPo | null>(null)
  const [cancelling, setCancelling] = useState<SupplyPo | null>(null)
  const ready = readyToSend(pos)
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

      {[...pos].sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled')).map(p => {
        const ls = linesOf(p.id)
        const ordered = ls.reduce((s, l) => s + (Number(l.quantity_ordered) || 0), 0)
        const received = ls.reduce((s, l) => s + (Number(l.quantity_received) || 0), 0)
        const st = PO_STATUS[String(p.status)] ?? { label: String(p.status ?? '—'), cls: 'bg-slate-100 text-slate-700' }
        const open = !['cancelled', 'received', 'draft', 'pending_approval', 'rejected'].includes(String(p.status))
        const editable = !['cancelled', 'received'].includes(String(p.status))
        return (
          <section key={p.id} className={cn(card, 'p-4 flex flex-col gap-2', p.status === 'cancelled' && 'opacity-70')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/dashboard/supply/purchase-orders/${p.id}`} className="text-[15px] font-semibold text-primary hover:underline">{p.po_number ?? 'PO'}</Link>
                <p className="text-[13px] text-text-primary truncate">{p.supplier?.name ?? 'Supplier'}</p>
                <p className="text-[12px] text-text-secondary truncate">{p.status === 'approved' ? `Goes to ${emailOf(p) || 'no email yet'}` : p.sent_at ? `Sent ${fmtDay(p.sent_at)}` : `Made ${fmtDay(p.created_at)}`}{p.required_delivery_date ? ` · expected ${fmtDay(p.required_delivery_date)}` : ''}</p>
              </div>
              <span className={cn(pill, st.cls)}>{st.label}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-text-secondary">
              <span>{ls.map(l => `${l.description ?? 'Item'} × ${q3(Number(l.quantity_ordered) || 0)}`).join(', ')}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 text-[13px]">
              <span><span className="text-text-secondary">Excl. VAT </span><b className="tabular-nums">{formatCurrency(Number(p.subtotal) || 0, p.currency ?? 'ZAR')}</b></span>
              <span><span className="text-text-secondary">Received </span><b className="tabular-nums">{q3(received)} of {q3(ordered)}</b></span>
            </div>
            {p.status !== 'cancelled' && (
              <div className="flex flex-wrap gap-2 pt-1">
                {open && <button type="button" className={p.status === 'approved' ? btn : btnP} disabled={busy !== null} onClick={() => setReceiving(p)}>Receive goods</button>}
                {p.status === 'approved' && (
                  <button type="button" className={btnP} disabled={busy !== null} onClick={async () => {
                    setBusy(p.id); setMsg(null)
                    const e = await sendOne(p)
                    await onChanged(); setBusy(null)
                    setMsg(e ? { ok: false, text: e } : { ok: true, text: `${p.po_number} sent.` })
                  }}>{busy === p.id ? 'Sending…' : 'Send'}</button>
                )}
                {editable && <button type="button" className={btn} disabled={busy !== null} onClick={() => setEditing(p)}>Edit</button>}
                {editable && received === 0 && <button type="button" className={cn(btn, 'text-error')} disabled={busy !== null} onClick={() => setCancelling(p)}>Cancel</button>}
              </div>
            )}
          </section>
        )
      })}

      {receiving && (
        <ReceiveSheet po={receiving} lines={linesOf(receiving.id)} onClose={() => setReceiving(null)}
          onDone={async (text) => { setReceiving(null); setMsg({ ok: true, text }); await onChanged() }} />
      )}
      {editing && (
        <PoEditSheet po={editing} lines={linesOf(editing.id)} canEmail={!!emailOf(editing) && editing.status !== 'approved'}
          onClose={() => setEditing(null)}
          onSaved={async (email) => {
            const no = editing.po_number ?? 'PO'
            let res = { ok: true, text: `${no} saved.` }
            if (email) {
              const e = await sendOne(editing)
              res = e ? { ok: false, text: `Saved, but the email didn't go: ${e}` } : { ok: true, text: `${no} saved and the updated PO emailed.` }
            }
            setEditing(null); setMsg(res); await onChanged()
          }} />
      )}
      {cancelling && (
        <CancelPoSheet po={cancelling} email={emailOf(cancelling)} onClose={() => setCancelling(null)}
          onDone={async (text) => { setCancelling(null); setMsg({ ok: true, text }); await onChanged() }} />
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
        <input value={dn} onChange={e => setDn(e.target.value)} className="mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]" autoComplete="off" />
      </label>
      {lines.map(l => {
        const n = parseQty(qty[l.id] ?? '')
        const wrong = Number.isNaN(n) || n < 0 || n > left(l) + 1e-9
        return (
          <div key={l.id} className={cn(card, 'p-3 flex flex-col gap-2')}>
            <p className="text-[14px] font-semibold text-text-primary">{l.description}</p>
            <div className="flex items-end justify-between gap-3">
              <div className="text-[12.5px] text-text-secondary leading-5">
                <p>Ordered <b className="text-text-primary">{q3(Number(l.quantity_ordered) || 0)}</b> · already in <b className="text-text-primary">{q3(Number(l.quantity_received) || 0)}</b></p>
                <p>Still to come after this: <b className="text-text-primary">{wrong ? '—' : q3(left(l) - n)}</b></p>
              </div>
              <label className="text-[11.5px] font-medium text-text-secondary text-right">Receiving now
                <input value={qty[l.id] ?? ''} onChange={e => setQty(x => ({ ...x, [l.id]: e.target.value }))} inputMode="decimal" disabled={left(l) <= 0}
                  aria-label={`Receiving now: ${l.description}`}
                  className={cn('mt-1 block w-24 h-12 px-3 rounded-xl border-2 text-right text-[16px] font-semibold bg-background', wrong ? 'border-error' : 'border-primary')} />
              </label>
            </div>
            {wrong && <p className="text-[12px] text-error">At most {q3(left(l))}.</p>}
          </div>
        )
      })}
      <label className="text-[12.5px] font-medium text-text-secondary">Notes (optional)
        <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full h-11 px-3 bg-background border border-border rounded-xl text-[14px]" placeholder="e.g. one box damaged" />
      </label>
      <p className="text-[12.5px] text-text-secondary bg-surface-elevated rounded-lg px-3 py-2">
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
    <Sheet title={`Edit ${po.po_number ?? 'PO'} · ${po.supplier?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={btn} disabled={busy || bad} onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save'}</button>
        {canEmail && <button type="button" className={btnP} disabled={busy || bad} onClick={() => void save(true)}>Save and email the updated PO</button>}
      </>}>
      <p className="text-[12.5px] text-text-secondary">You can change a PO until all of it is received.</p>
      {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}
      {parsed.map(({ l, q }) => (
        <div key={l.id} className={cn(card, 'p-3 flex flex-col gap-2')}>
          <p className="text-[14px] font-semibold">{l.description}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11.5px] font-medium text-text-secondary">Qty
              <input value={vals[l.id]?.q ?? ''} inputMode="decimal" onChange={e => setVals(v => ({ ...v, [l.id]: { ...v[l.id], q: e.target.value } }))}
                className="mt-1 w-full h-11 px-3 rounded-xl border border-border bg-background text-right text-[15px]" />
            </label>
            <label className="text-[11.5px] font-medium text-text-secondary">Unit cost (excl. VAT)
              <input value={vals[l.id]?.p ?? ''} inputMode="decimal" onChange={e => setVals(v => ({ ...v, [l.id]: { ...v[l.id], p: e.target.value } }))}
                className="mt-1 w-full h-11 px-3 rounded-xl border border-border bg-background text-right text-[15px]" />
            </label>
          </div>
          {q < (Number(l.quantity_received) || 0) && <p className="text-[12px] text-error">{q3(Number(l.quantity_received) || 0)} have already arrived.</p>}
        </div>
      ))}
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
            <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl border border-border bg-background text-[14px]" placeholder="e.g. out of stock, found it cheaper" />
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
  const [editing, setEditing] = useState<SupplyGrn | null>(null)
  const [cancelling, setCancelling] = useState<SupplyGrn | null>(null)
  const poNo = (id: string | null) => pos.find(p => p.id === id)?.po_number ?? 'PO'

  return (
    <div className="flex flex-col gap-3">
      {msg && <p className={cn('text-[13px] rounded-lg px-3 py-2', msg.ok ? 'text-emerald-800 bg-emerald-50' : 'text-error bg-error/10')} role="status">{msg.text}</p>}
      {grns.length === 0 && <p className="text-[13px] text-text-secondary py-6 text-center">Nothing received yet. Use &ldquo;Receive goods&rdquo; on a purchase order when a delivery arrives.</p>}
      {grns.map(g => {
        const bill = bills.find(b => b.grn_id === g.id)
        const items = grnLines.filter(l => l.grn_id === g.id).map(l => `${l.description ?? 'Item'} × ${q3(Number(l.quantity_received) || 0)}`).join(', ')
        const cancelled = g.status === 'cancelled'
        const billPill = !bill ? null : bill.status === 'cancelled' ? { t: 'Bill cancelled', c: 'bg-slate-100 text-slate-700' }
          : bill.approval_status === 'approved' ? { t: `Bill approved · ${formatCurrency(Number(bill.total_amount) || 0, bill.currency ?? 'ZAR')}`, c: 'bg-emerald-50 text-emerald-800' }
          : { t: `Bill waiting for approval · ${formatCurrency(Number(bill.total_amount) || 0, bill.currency ?? 'ZAR')}`, c: 'bg-amber-50 text-amber-800' }
        return (
          <section key={g.id} className={cn(card, 'p-4 flex flex-col gap-1.5', cancelled && 'opacity-70')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-text-primary">{g.grn_number ?? 'Delivery'} <span className="text-[12.5px] font-normal text-text-secondary">· {poNo(g.po_id)}</span></p>
                <p className="text-[12.5px] text-text-secondary">{g.received_date ? new Date(g.received_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}{g.delivery_note_number ? ` · delivery note ${g.delivery_note_number}` : ''}</p>
              </div>
            </div>
            <p className="text-[13px] text-text-primary">{items || '—'}</p>
            {g.notes && <p className="text-[12.5px] text-text-secondary">{g.notes}</p>}
            {bill && billPill && (
              <Link href={`/dashboard/finance/supplier-invoices/${bill.id}`} className={cn(pill, billPill.c, 'self-start hover:underline')}>{bill.bill_number ? `${bill.bill_number} · ` : ''}{billPill.t}</Link>
            )}
            {!cancelled && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className={btn} onClick={() => setEditing(g)}>Edit</button>
                {bill?.approval_status !== 'approved' && <button type="button" className={cn(btn, 'text-error')} onClick={() => setCancelling(g)}>Cancel</button>}
              </div>
            )}
          </section>
        )
      })}
      <p className="text-[12px] text-text-secondary">Edit fixes the delivery note number. If a quantity was wrong, cancel the delivery and receive it again: cancelling takes the items back off &ldquo;received&rdquo;, takes stock items back out and cancels that delivery&apos;s bill.</p>

      {editing && <EditGrnSheet grn={editing} onClose={() => setEditing(null)} onDone={async t => { setEditing(null); setMsg({ ok: true, text: t }); await onChanged() }} />}
      {cancelling && <CancelGrnSheet grn={cancelling} onClose={() => setCancelling(null)} onDone={async t => { setCancelling(null); setMsg({ ok: true, text: t }); await onChanged() }} />}
    </div>
  )
}

function EditGrnSheet({ grn, onClose, onDone }: { grn: SupplyGrn; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const [dn, setDn] = useState(grn.delivery_note_number ?? '')
  const [notes, setNotes] = useState(grn.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={`Edit ${grn.grn_number ?? 'delivery'}`} onClose={onClose}
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
        <input value={dn} onChange={e => setDn(e.target.value)} className="mt-1 w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px]" />
      </label>
      <label className="text-[12.5px] font-medium text-text-secondary">Notes
        <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full h-11 px-3 bg-background border border-border rounded-xl text-[14px]" />
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
        <input value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full h-11 px-3 rounded-xl border border-border bg-background text-[14px]" placeholder="e.g. wrong quantity typed" />
      </label>
    </Sheet>
  )
}
