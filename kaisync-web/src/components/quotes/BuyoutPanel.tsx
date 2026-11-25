'use client'

/**
 * The quote's Buyout tab: ask suppliers (or contractors, for an outsourced service) for prices on the outsourced
 * lines, then compare their replies and choose. Choosing puts that supplier's cost on the quote line straight away.
 *
 * Three small steps, one table each:
 * Ask:     items down the side, suppliers across the top: tick who quotes on what, check their email, send (one email
 *          per supplier, only their items, with a "Send your prices" link).
 * Compare: every item against every supplier's price (cheapest outlined); tap a price to use it, type a reply that came
 *          by email, or use your own cost.
 * Orders:  the purchase orders the choices will make.
 */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currencies'
import { createSupplier } from '@/lib/suppliers'
import { previewDocumentEmail, sendDocumentEmail } from '@/lib/money/document-email'
import {
  addSupplier, asks, chargesVat, costExVat, isEmailAddress, removeRecipient, saveReply, sendToOf, updateRecipient,
  type Buyout, type BuyoutRecipient, type BuyoutReply, type PriceVat,
} from '@/lib/money/buyout'
import { cn } from '@/lib/utils'

export type BuyoutQuoteLine = {
  id: string; description: string; qty: number; unit: string
  unitCost: number | null; supplierId: string | null; chosenResponseLineId: string | null
}
export type BuyoutChoice = { cost: number; supplierId: string; responseLineId: string } | { ownCost: number }

type Supplier = { id: string; name: string; contact_person: string | null; email: string | null; partner_kind: string | null; is_vat_registered: boolean | null }

type Props = {
  companyId: string
  buyout: Buyout | null
  lines: BuyoutQuoteLine[]
  currency: string
  readOnly?: boolean
  /** Saves the quote and makes / updates the buyout. */
  ensure: () => Promise<string | null>
  reload: () => Promise<void>
  onChoose: (quoteLineId: string, choice: BuyoutChoice) => void
  keep: 'margin' | 'price'
  onKeep: (k: 'margin' | 'price') => void
  defaultMargin: number
  onDefaultMargin: (n: number) => void
}

type View = 'ask' | 'compare' | 'orders'
const VAT_LABEL: Record<PriceVat, string> = { excl: 'No, VAT added', incl: 'Yes, incl. VAT', none: 'Not VAT registered' }
const card = 'bg-surface border border-divider rounded-[12px]'
const TH = 'px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-secondary text-left whitespace-nowrap bg-surface-elevated/60 border-b border-divider'
const TD = 'px-3 py-2 text-[12.5px] border-b border-divider/60 align-middle'
const btn = 'h-8 px-3 rounded-lg border border-divider bg-surface text-[12.5px] font-semibold text-text-primary hover:bg-surface-elevated disabled:opacity-50'
const btnP = 'h-8 px-3.5 rounded-lg bg-[#2563EB] text-white text-[12.5px] font-semibold hover:bg-[#1D4ED8] disabled:opacity-50'
const inp = 'h-8 w-full rounded-md border border-divider px-2 text-[13px] bg-background text-text-primary focus:outline-none focus:border-primary/60'

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'blue'; children: React.ReactNode }) {
  const c = { green: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700', slate: 'bg-slate-100 text-slate-700', blue: 'bg-sky-50 text-sky-800' }[tone]
  return <span className={cn('inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap', c)}>{children}</span>
}

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '')

export function BuyoutPanel(props: Props) {
  const { buyout, lines, readOnly } = props
  const sent = (buyout?.recipients ?? []).some(r => r.status !== 'pending')
  const [view, setView] = useState<View>(sent ? 'compare' : 'ask')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Make sure the buyout exists and matches the quote's outsourced lines whenever the tab opens.
  useEffect(() => {
    let live = true
    void (async () => {
      const err = await props.ensure()
      if (live && err) setMsg({ ok: false, text: err })
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!lines.length) {
    return (
      <div className={cn(card, 'px-5 py-10 text-center')}>
        <span className="material-icons text-[36px] text-text-disabled">local_shipping</span>
        <p className="mt-2 text-[14px] font-semibold text-text-primary">Nothing to buy in on this quote</p>
        <p className="mt-1 text-[12.5px] text-text-secondary">Set a line to <b>Outsource</b> on the Items tab, and it appears here to ask suppliers for prices.</p>
      </div>
    )
  }

  const steps: [View, string][] = [['ask', 'Ask'], ['compare', 'Compare'], ['orders', 'Orders']]
  const chosenCount = lines.filter(l => l.chosenResponseLineId || (l.unitCost ?? 0) > 0).length
  return (
    <div className="flex flex-col gap-2.5">
      <nav aria-label="Buyout steps" className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {steps.map(([v, lab], i) => {
          const now = view === v
          const done = (v === 'ask' && sent) || (v === 'compare' && lines.length > 0 && chosenCount === lines.length)
          return (
            <button key={v} type="button" aria-current={now ? 'step' : undefined} onClick={() => setView(v)}
              className={cn('h-9 rounded-[10px] px-2.5 flex items-center justify-center sm:justify-start gap-2 border text-[12.5px] sm:text-[13px] text-text-primary',
                now ? 'border-[#2563EB] bg-[#EEF4FF] font-semibold dark:bg-[#16264A]' : 'border-divider bg-surface font-medium hover:bg-surface-elevated')}>
              <span className={cn('w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0',
                now ? 'bg-[#2563EB] text-white' : done ? 'bg-[#15803D] text-white' : 'bg-[#EEF1F6] text-text-secondary')}>{done && !now ? '✓' : i + 1}</span>
              {lab}{v === 'compare' && buyout?.replies.length ? <span className="text-text-secondary font-normal">({buyout.replies.length})</span> : null}
            </button>
          )
        })}
      </nav>
      {msg && <p className={cn('text-[12.5px] rounded-lg px-3 py-2', msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>{msg.text}</p>}
      {!buyout ? (
        <p className="text-[13px] text-text-secondary py-6 text-center">Getting the buyout ready…</p>
      ) : view === 'ask' ? (
        <AskView {...props} buyout={buyout} busy={busy} setBusy={setBusy} setMsg={setMsg} onSent={() => setView('compare')} />
      ) : view === 'compare' ? (
        <RepliesView {...props} buyout={buyout} busy={busy || !!readOnly} setBusy={setBusy} setMsg={setMsg} />
      ) : (
        <OrdersView {...props} buyout={buyout} busy={busy} setBusy={setBusy} setMsg={setMsg} />
      )}
      {buyout?.rfqNumber && <span className="text-[11.5px] text-text-secondary text-right">Request {buyout.rfqNumber}</span>}
    </div>
  )
}

// ── Ask suppliers ────────────────────────────────────────────────────────────

type ViewProps = Props & { buyout: Buyout; busy: boolean; setBusy: (b: boolean) => void; setMsg: (m: { ok: boolean; text: string } | null) => void }

function AskView({ companyId, buyout, busy, setBusy, setMsg, reload, readOnly, onSent }: ViewProps & { onSent: () => void }) {
  const supabase = createClient()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [newSup, setNewSup] = useState({ name: '', contact: '', email: '' })
  const [deadline, setDeadline] = useState('')
  const [preview, setPreview] = useState<{ name: string; subject: string; html: string } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { sendTo?: string; cc?: string }>>({})

  useEffect(() => {
    void supabase.from('contractors').select('id, name, contact_person, email, partner_kind, is_vat_registered')
      .eq('company_id', companyId).eq('is_active', true).order('name').limit(1000)
      .then(({ data }) => setSuppliers((data ?? []) as Supplier[]))
    void supabase.from('rfqs').select('response_deadline').eq('id', buyout.rfqId).maybeSingle()
      .then(({ data }) => setDeadline(String((data as { response_deadline?: string | null } | null)?.response_deadline ?? '')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, buyout.rfqId])

  const onList = new Set(buyout.recipients.map(r => r.supplierId))
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return suppliers.filter(s => !onList.has(s.id) && [s.name, s.contact_person, s.email].some(v => (v ?? '').toLowerCase().includes(q))).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, suppliers, buyout.recipients])

  async function add(s: Pick<Supplier, 'id' | 'email'>) {
    setBusy(true); setMsg(null)
    const r = await addSupplier(supabase, { companyId, rfqId: buyout.rfqId, supplierId: s.id, email: s.email, lineIds: null })
    if ('error' in r) setMsg({ ok: false, text: r.error })
    setSearch('')
    await reload()
    setBusy(false)
  }

  async function addNew() {
    if (!newSup.name.trim()) { setMsg({ ok: false, text: 'Type the supplier’s name.' }); return }
    if (newSup.email.trim() && !isEmailAddress(newSup.email)) { setMsg({ ok: false, text: 'That email address doesn’t look right.' }); return }
    setBusy(true); setMsg(null)
    const c = await createSupplier(supabase, { companyId, name: newSup.name.trim(), contactPerson: newSup.contact.trim() || null, email: newSup.email.trim() || null, partnerKind: 'supplier' })
    if (!c.ok) { setMsg({ ok: false, text: c.message }); setBusy(false); return }
    setSuppliers(list => [...list, { id: c.data.id, name: newSup.name.trim(), contact_person: newSup.contact.trim() || null, email: newSup.email.trim() || null, partner_kind: 'supplier', is_vat_registered: null }])
    setNewSup({ name: '', contact: '', email: '' }); setAdding(false)
    await add({ id: c.data.id, email: newSup.email.trim() || null })
  }

  async function toggle(r: BuyoutRecipient, rfqLineId: string) {
    const all = buyout.lines.map(l => l.rfqLineId)
    const cur = new Set(r.lineIds ?? all)
    if (cur.has(rfqLineId)) cur.delete(rfqLineId); else cur.add(rfqLineId)
    const next = all.filter(id => cur.has(id))
    await updateRecipient(supabase, r.id, { line_ids: next.length === all.length ? null : next })
    await reload()
  }

  async function saveContact(r: BuyoutRecipient) {
    const d = drafts[r.id]
    if (!d) return
    const patch: Record<string, unknown> = {}
    if (d.sendTo != null) {
      const v = d.sendTo.trim()
      if (v && !isEmailAddress(v)) { setMsg({ ok: false, text: `${r.name}: that email address doesn’t look right.` }); return }
      patch.send_to = v || null
      // A supplier with no email on file keeps this one for next time.
      if (v && !r.supplierEmail) await supabase.from('contractors').update({ email: v }).eq('id', r.supplierId)
    }
    if (d.cc != null) {
      const list = d.cc.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
      const bad = list.find(x => !isEmailAddress(x))
      if (bad) { setMsg({ ok: false, text: `${r.name}: "${bad}" isn’t an email address.` }); return }
      patch.cc = list
    }
    await updateRecipient(supabase, r.id, patch)
    setDrafts(x => { const n = { ...x }; delete n[r.id]; return n })
    await reload()
  }

  const itemsFor = (r: BuyoutRecipient) => buyout.lines.filter(l => asks(r, l.rfqLineId))
  const ready = buyout.recipients.filter(r => r.status === 'pending' && isEmailAddress(sendToOf(r)) && itemsFor(r).length > 0)

  async function saveDeadline(v: string) {
    setDeadline(v)
    await supabase.from('rfqs').update({ response_deadline: v || null }).eq('id', buyout.rfqId)
  }

  async function showPreview() {
    const r = ready[0] ?? buyout.recipients[0]
    if (!r) return
    setBusy(true)
    const p = await previewDocumentEmail(supabase, { kind: 'rfq', docId: r.id, recipient: sendToOf(r), cc: r.cc })
    setBusy(false)
    if ('error' in p) { setMsg({ ok: false, text: p.error }); return }
    setPreview({ name: r.name, subject: p.subject, html: p.html })
  }

  async function sendAll() {
    if (!ready.length) return
    setBusy(true); setMsg(null)
    const failed: string[] = []
    for (const r of ready) {
      const res = await sendDocumentEmail(supabase, { kind: 'rfq', docId: r.id, recipient: sendToOf(r), cc: r.cc })
      if (!res.ok) failed.push(`${r.name}: ${res.message}`)
    }
    await reload()
    setBusy(false)
    if (failed.length) setMsg({ ok: false, text: `Not sent — ${failed.join(' · ')}` })
    else { setMsg({ ok: true, text: `Sent to ${ready.length} ${ready.length === 1 ? 'supplier' : 'suppliers'}. Their prices show under Compare as they come in.` }); onSent() }
  }

  const recips = buyout.recipients
  return (
    <>
      <section className={cn(card, 'overflow-hidden')}>
        {/* Who to ask: search your suppliers (or contractors), or add a new one */}
        <div className="px-3 py-2.5 border-b border-divider flex flex-wrap items-center gap-2">
          <div className="relative flex-[1_1_220px] max-w-[340px]">
            <span className="material-icons !text-[16px] text-text-secondary absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
            <input value={search} onChange={e => setSearch(e.target.value)} disabled={readOnly || busy} placeholder="Add a supplier to ask…" aria-label="Search suppliers" className={cn(inp, 'pl-8')} />
            {matches.length > 0 && (
              <div className="absolute top-9 left-0 right-0 z-30 rounded-xl border border-divider bg-surface shadow-lg overflow-hidden">
                {matches.map(s => (
                  <button key={s.id} type="button" onClick={() => void add(s)} className="w-full text-left px-3 py-2 hover:bg-primary/[0.05] border-b border-divider/60 last:border-0">
                    <span className="text-[13px] font-medium text-text-primary">{s.name}</span>
                    <span className="block text-[11.5px] text-text-secondary">{[s.partner_kind === 'contractor' ? 'Contractor' : 'Supplier', s.contact_person, s.email ?? 'no email yet'].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!readOnly && !adding && <button type="button" onClick={() => { setAdding(true); setNewSup(n => ({ ...n, name: search.trim() })) }} className="text-[12.5px] font-semibold text-[#2563EB]">+ New supplier</button>}
          {search.trim() && matches.length === 0 && !adding && <span className="text-[12px] text-text-secondary">No match: add them as new</span>}
        </div>
        {adding && (
          <div className="px-3 py-2.5 border-b border-divider bg-surface-elevated/40 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-center">
            <input className={inp} placeholder="Company name" aria-label="Company name" value={newSup.name} onChange={e => setNewSup(s => ({ ...s, name: e.target.value }))} />
            <input className={inp} placeholder="Contact person" aria-label="Contact person" value={newSup.contact} onChange={e => setNewSup(s => ({ ...s, contact: e.target.value }))} />
            <input className={inp} type="email" placeholder="Email address" aria-label="Email address" value={newSup.email} onChange={e => setNewSup(s => ({ ...s, email: e.target.value }))} />
            <span className="flex gap-2 items-center">
              <button type="button" className={btn} disabled={busy} onClick={() => void addNew()}>Add</button>
              <button type="button" className="text-[12px] text-text-secondary" onClick={() => setAdding(false)}>Cancel</button>
            </span>
          </div>
        )}

        {/* Items down the side, suppliers across the top: tick who quotes on what */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 300 + recips.length * 170 }}>
            <thead><tr>
              <th className={TH}>Item</th><th className={cn(TH, 'text-right')}>Qty</th>
              {recips.map(r => (
                <th key={r.id} className={cn(TH, 'text-center normal-case tracking-normal')}>
                  <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full bg-[#EEF4FF] text-[#2563EB] dark:bg-[#16264A] dark:text-[#7AA7FF] text-[12px] font-semibold">
                    {r.name}
                    {r.status === 'pending' && !readOnly ? (
                      <button type="button" aria-label={`Remove ${r.name}`} disabled={busy}
                        onClick={async () => { setBusy(true); await removeRecipient(supabase, r.id); await reload(); setBusy(false) }}
                        className="w-[18px] h-[18px] rounded-full hover:bg-[#2563EB]/15 text-[10px]">✕</button>
                    ) : <span className="text-[10.5px] font-medium opacity-80 pr-1">{r.status === 'responded' ? 'replied' : 'sent'}</span>}
                  </span>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {buyout.lines.map(l => (
                <tr key={l.rfqLineId}>
                  <td className={TD}><span className="font-medium text-text-primary">{l.description}</span></td>
                  <td className={cn(TD, 'text-right whitespace-nowrap')}>{l.qty} <span className="text-text-secondary text-[11.5px]">{l.unit !== 'each' ? l.unit : ''}</span></td>
                  {recips.map(r => (
                    <td key={r.id} className={cn(TD, 'text-center')}>
                      <input type="checkbox" className="w-4 h-4 accent-[#2563EB]" checked={asks(r, l.rfqLineId)}
                        disabled={readOnly || busy || r.status !== 'pending'} aria-label={`Ask ${r.name} for ${l.description}`}
                        onChange={() => void toggle(r, l.rfqLineId)} />
                    </td>
                  ))}
                </tr>
              ))}
              {recips.length > 0 && (
                <tr className="bg-surface-elevated/30">
                  <td className={cn(TD, 'text-text-secondary text-[12px]')} colSpan={2}>Sends to</td>
                  {recips.map(r => {
                    const to = drafts[r.id]?.sendTo ?? sendToOf(r)
                    const ok = isEmailAddress(to)
                    const n = itemsFor(r).length
                    const done = r.status !== 'pending'
                    return (
                      <td key={r.id} className={cn(TD, 'text-center align-top')}>
                        <div className="flex flex-col gap-1 items-center">
                          <input type="email" value={to} disabled={readOnly || done} placeholder="type their email" aria-label={`Email for ${r.name}`}
                            onChange={e => setDrafts(x => ({ ...x, [r.id]: { ...x[r.id], sendTo: e.target.value } }))} onBlur={() => void saveContact(r)}
                            className={cn(inp, 'h-7 text-[12px] text-center', !ok && !done && 'border-red-400')} />
                          {!done && (
                            <input value={drafts[r.id]?.cc ?? r.cc.join(', ')} disabled={readOnly} placeholder="cc (optional)" aria-label={`CC for ${r.name}`}
                              onChange={e => setDrafts(x => ({ ...x, [r.id]: { ...x[r.id], cc: e.target.value } }))} onBlur={() => void saveContact(r)} className={cn(inp, 'h-7 text-[11.5px] text-center')} />
                          )}
                          {r.status === 'responded' ? <Pill tone="green">Replied {day(r.respondedAt)}</Pill>
                            : done ? <Pill tone="blue">Sent {day(r.sentAt)}{r.viewedAt ? ' · opened' : ''}</Pill>
                            : n === 0 ? <Pill tone="amber">Tick an item</Pill>
                            : ok ? <Pill tone="green">Ready · {n} {n === 1 ? 'item' : 'items'}</Pill> : <Pill tone="red">Needs an email</Pill>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {recips.length === 0 && <p className="px-3 py-3 text-[12.5px] text-text-secondary">Add a supplier above, then tick what they should price.</p>}
        <div className="px-3 py-2.5 bg-surface-elevated/50 border-t border-divider flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">Reply by
            <input type="date" value={deadline} disabled={readOnly} onChange={e => void saveDeadline(e.target.value)} className={cn(inp, 'w-[140px] h-7')} />
            <span className="hidden md:inline">· each supplier gets one email with only their ticked items</span>
          </label>
          <div className="flex gap-1.5">
            <button type="button" className={btn} disabled={busy || !recips.length} onClick={() => void showPreview()}>Preview</button>
            <button type="button" className={btnP} disabled={busy || readOnly || !ready.length} onClick={() => void sendAll()}>
              {busy ? 'Working…' : ready.length ? `Send ${ready.length} ${ready.length === 1 ? 'request' : 'requests'}` : 'Nothing to send'}
            </button>
          </div>
        </div>
      </section>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Email preview">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-divider flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-[12px] text-text-secondary">What {preview.name} gets</p><p className="text-[14px] font-semibold text-text-primary truncate">{preview.subject}</p></div>
              <button type="button" className={btn} onClick={() => setPreview(null)}>Close</button>
            </div>
            <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="flex-1 min-h-[480px] w-full bg-white" />
          </div>
        </div>
      )}
    </>
  )
}

// ── Replies and choose ──────────────────────────────────────────────────────

function RepliesView({ companyId, buyout, lines, currency, busy, setBusy, setMsg, reload, onChoose, keep, onKeep, defaultMargin, onDefaultMargin, readOnly }: ViewProps) {
  const supabase = createClient()
  const [entering, setEntering] = useState<string | null>(null)   // `${recipientId}:${rfqLineId}`
  const [form, setForm] = useState({ price: '', vat: 'excl' as PriceVat, qty: '', lead: '' })
  const [ownCost, setOwnCost] = useState<Record<string, string>>({})
  const [ownOpen, setOwnOpen] = useState<string | null>(null)
  const byQuoteLine = new Map(lines.map(l => [l.id, l]))

  async function openAttachment(path: string) {
    const { data, error } = await supabase.storage.from('workforce-media').createSignedUrl(path, 300)
    if (error || !data?.signedUrl) { setMsg({ ok: false, text: 'Could not open their PDF.' }); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  function startEnter(r: BuyoutRecipient, rfqLineId: string, existing?: BuyoutReply) {
    setEntering(`${r.id}:${rfqLineId}`)
    setForm({ price: existing ? String(existing.unitPrice) : '', vat: r.pricesIncludeVat ?? 'excl', qty: existing?.qty != null ? String(existing.qty) : '', lead: existing?.leadDays != null ? String(existing.leadDays) : '' })
  }

  async function saveEntered(r: BuyoutRecipient, rfqLineId: string) {
    const price = parseFloat(form.price.replace(/\s/g, '').replace(',', '.'))
    if (!(price > 0)) { setMsg({ ok: false, text: 'Enter their price.' }); return }
    setBusy(true)
    const res = await saveReply(supabase, {
      companyId, rfqId: buyout.rfqId, recipientId: r.id, vat: form.vat,
      rows: [{ rfqLineId, unitPrice: price, qty: form.qty ? Number(form.qty.replace(',', '.')) : null, askedQty: buyout.lines.find(l => l.rfqLineId === rfqLineId)?.qty ?? 1, leadDays: form.lead ? Math.round(Number(form.lead)) : null }],
    })
    if ('error' in res) setMsg({ ok: false, text: res.error }); else setEntering(null)
    await reload()
    setBusy(false)
  }

  const recips = buyout.recipients
  return (
    <section className={cn(card, 'overflow-hidden')}>
      <fieldset className="px-3 py-2 border-b border-divider flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]" disabled={readOnly}>
        <legend className="sr-only">When I choose a supplier price</legend>
        <label className="flex items-center gap-1.5 rounded-md px-2 py-1 bg-[#FFF6E0] text-[#7A4F00] dark:bg-[#2B2312] dark:text-[#F2C46B] font-semibold">
          When I choose a price
          <select value={keep} onChange={e => onKeep(e.target.value as 'margin' | 'price')} aria-label="When I choose a supplier price" className="bg-transparent font-semibold outline-none">
            <option value="margin">keep my margin</option>
            <option value="price">keep my selling price</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-text-secondary">Margin if no price yet
          <input value={String(defaultMargin)} inputMode="decimal" aria-label="Default margin" onChange={e => onDefaultMargin(Math.min(95, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)))} className={cn(inp, 'w-[52px] h-7 text-right')} />%
        </label>
        <span className="ml-auto text-text-secondary hidden sm:inline">Tap a price to use it · prices excl. VAT</span>
      </fieldset>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 380 + recips.length * 150 }}>
          <thead><tr>
            <th className={TH}>Item</th><th className={cn(TH, 'text-right')}>Qty</th>
            {recips.map(r => (
              <th key={r.id} className={cn(TH, 'text-center normal-case tracking-normal text-[12px] text-text-primary')}>
                {r.name}
                {r.attachmentPath && <button type="button" onClick={() => void openAttachment(r.attachmentPath!)} className="block mx-auto text-[11px] font-medium text-[#2563EB] hover:underline">their PDF</button>}
              </th>
            ))}
            <th className={cn(TH, 'text-center')}>My own cost</th>
          </tr></thead>
          <tbody>
            {buyout.lines.map(bl => {
              const ql = bl.quoteLineId ? byQuoteLine.get(bl.quoteLineId) : undefined
              const reps = recips.map(r => ({ r, rep: buyout.replies.find(x => x.recipientId === r.id && x.rfqLineId === bl.rfqLineId) }))
              const costs = reps.filter(x => x.rep).map(x => costExVat(x.rep!.unitPrice, x.r.pricesIncludeVat))
              const best = costs.length > 1 ? Math.min(...costs) : null
              const ownChosen = !!ql && !ql.chosenResponseLineId && (ql.unitCost ?? 0) > 0
              return (
                <tr key={bl.rfqLineId}>
                  <td className={TD}>
                    <span className="font-medium text-text-primary">{bl.description}</span>
                    {!ql && <span className="block"><Pill tone="slate">No longer on the quote</Pill></span>}
                  </td>
                  <td className={cn(TD, 'text-right')}>{bl.qty}</td>
                  {reps.map(({ r, rep }) => {
                    const key = `${r.id}:${bl.rfqLineId}`
                    if (entering === key) {
                      return (
                        <td key={r.id} className={cn(TD, 'bg-amber-50/60 dark:bg-amber-950/20')}>
                          <div className="flex flex-col gap-1 min-w-[130px]">
                            <input className={cn(inp, 'h-7 text-right')} placeholder="Their price" aria-label="Their unit price" autoFocus value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
                            <select className={cn(inp, 'h-7 text-[11.5px]')} aria-label="Does their price include VAT" value={form.vat} onChange={e => setForm(f => ({ ...f, vat: e.target.value as PriceVat }))}>
                              {(Object.keys(VAT_LABEL) as PriceVat[]).map(k => <option key={k} value={k}>{VAT_LABEL[k]}</option>)}
                            </select>
                            <span className="flex gap-1.5 justify-center">
                              <button type="button" className={cn(btn, 'h-7 px-2')} disabled={busy} onClick={() => void saveEntered(r, bl.rfqLineId)}>Save</button>
                              <button type="button" className="text-[11.5px] text-text-secondary" onClick={() => setEntering(null)}>Cancel</button>
                            </span>
                          </div>
                        </td>
                      )
                    }
                    if (!asks(r, bl.rfqLineId)) return <td key={r.id} className={cn(TD, 'text-center text-text-secondary text-[12px]')}>not asked</td>
                    if (!rep) {
                      return (
                        <td key={r.id} className={cn(TD, 'text-center')}>
                          {r.status === 'pending' ? <Pill tone="slate">Not sent</Pill> : <Pill tone="amber">Waiting{r.viewedAt ? ' · opened' : ''}</Pill>}
                          {!readOnly && <button type="button" className="block mx-auto mt-0.5 text-[11px] text-[#2563EB] hover:underline" onClick={() => startEnter(r, bl.rfqLineId)}>type their price</button>}
                        </td>
                      )
                    }
                    const cost = costExVat(rep.unitPrice, r.pricesIncludeVat)
                    const isChosen = rep.id === ql?.chosenResponseLineId
                    const tip = [rep.qty != null && rep.qty !== bl.qty ? `can supply ${rep.qty}` : null, rep.leadDays != null ? `${rep.leadDays} days` : null, rep.notes ?? r.notes].filter(Boolean).join(' · ')
                    return (
                      <td key={r.id} className={cn(TD, 'text-center')}>
                        <button type="button" disabled={busy || !ql || isChosen} title={tip || undefined}
                          onClick={() => ql && onChoose(ql.id, { cost, supplierId: r.supplierId, responseLineId: rep.id })}
                          className={cn('h-7 px-2.5 rounded-md border text-[12.5px] font-semibold tabular-nums whitespace-nowrap inline-flex items-center gap-1',
                            isChosen ? 'border-[#2563EB] bg-[#EEF4FF] text-[#2563EB] dark:bg-[#16264A] dark:text-[#7AA7FF]'
                              : best != null && cost === best ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300'
                              : 'border-divider bg-surface text-text-primary hover:bg-surface-elevated')}>
                          {formatCurrency(cost, currency)}{isChosen && <span className="material-icons !text-[14px]">check</span>}
                        </button>
                        {tip && <span className="block text-[10.5px] text-text-secondary mt-0.5 max-w-[150px] mx-auto truncate">{tip}</span>}
                        {!readOnly && <button type="button" className="block mx-auto text-[10.5px] text-text-secondary hover:text-[#2563EB]" onClick={() => startEnter(r, bl.rfqLineId, rep)}>edit</button>}
                      </td>
                    )
                  })}
                  <td className={cn(TD, 'text-center')}>
                    {ownChosen ? (
                      <span className="h-7 px-2.5 rounded-md border border-[#2563EB] bg-[#EEF4FF] text-[#2563EB] dark:bg-[#16264A] dark:text-[#7AA7FF] text-[12.5px] font-semibold inline-flex items-center gap-1">{formatCurrency(ql!.unitCost!, currency)}<span className="material-icons !text-[14px]">check</span></span>
                    ) : ql && !readOnly ? (
                      ownOpen === ql.id ? (
                        <span className="inline-flex gap-1 items-center">
                          <input value={ownCost[ql.id] ?? ''} autoFocus onChange={e => setOwnCost(x => ({ ...x, [ql.id]: e.target.value }))} placeholder="cost" aria-label="Your own cost price" className={cn(inp, 'w-[80px] h-7 text-right')} />
                          <button type="button" className={cn(btn, 'h-7 px-2')} onClick={() => {
                            const n = parseFloat((ownCost[ql.id] ?? '').replace(/\s/g, '').replace(',', '.'))
                            if (!(n > 0)) { setMsg({ ok: false, text: 'Type a cost price.' }); return }
                            onChoose(ql.id, { ownCost: n }); setOwnCost(x => ({ ...x, [ql.id]: '' })); setOwnOpen(null)
                          }}>Use</button>
                        </span>
                      ) : <button type="button" className="text-[12.5px] font-semibold text-[#2563EB]" onClick={() => setOwnOpen(ql.id)}>+ add</button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 bg-surface-elevated/50 border-t border-divider flex flex-wrap justify-between gap-2 text-[12px] text-text-secondary">
        <span>The cheapest reply is outlined green · choosing updates the quote straight away</span>
        <span>{lines.filter(l => l.chosenResponseLineId || (l.unitCost ?? 0) > 0).length} of {lines.length} items have a cost</span>
      </div>
    </section>
  )
}

// ── Orders: the purchase orders the choices will make ───────────────────────

function OrdersView({ buyout, lines, currency, reload, readOnly }: ViewProps) {
  const supabase = createClient()
  const pos = useMemo(() => {
    const m = new Map<string, { r: BuyoutRecipient | undefined; supplierId: string; items: string[]; excl: number }>()
    for (const l of lines) {
      if (!l.supplierId) continue
      const r = buyout.recipients.find(x => x.supplierId === l.supplierId)
      const cur = m.get(l.supplierId) ?? { r, supplierId: l.supplierId, items: [], excl: 0 }
      cur.items.push(`${l.description} × ${l.qty}`)
      cur.excl += Math.round((Number(l.unitCost) || 0) * l.qty * 100) / 100
      m.set(l.supplierId, cur)
    }
    return [...m.values()]
  }, [lines, buyout.recipients])

  return (
    <section className={cn(card, 'overflow-hidden')}>
      <div className="px-3 py-2.5 border-b border-divider">
        <p className="text-[13.5px] font-semibold text-text-primary">Purchase orders when the client accepts</p>
        <p className="text-[12px] text-text-secondary">One per chosen supplier, made and emailed when you process the order.</p>
      </div>
      {pos.length === 0 ? (
        <p className="px-3 py-4 text-[12.5px] text-text-secondary">Choose a supplier&apos;s price under Compare and its purchase order shows here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead><tr><th className={TH}>Supplier</th><th className={TH}>Items</th><th className={cn(TH, 'text-right')}>Excl. VAT</th><th className={TH}>They charge VAT?</th><th className={cn(TH, 'text-right')}>Total</th></tr></thead>
            <tbody>
              {pos.map(p => {
                const yes = p.r ? chargesVat(p.r) : true
                const vat = yes ? Math.round(p.excl * 0.15 * 100) / 100 : 0
                return (
                  <tr key={p.supplierId}>
                    <td className={TD}><span className="font-semibold">{p.r?.name ?? 'Supplier'}</span><span className="block text-[11.5px] text-text-secondary">{p.r ? sendToOf(p.r) || 'no email yet' : ''}</span></td>
                    <td className={cn(TD, 'text-[12.5px]')}>{p.items.join(', ')}</td>
                    <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap')}>{formatCurrency(p.excl, currency)}</td>
                    <td className={TD}>
                      <span className="inline-flex rounded-md border border-divider overflow-hidden">
                        {[true, false].map(v => (
                          <button key={String(v)} type="button" disabled={readOnly || !p.r}
                            onClick={async () => { if (!p.r) return; await updateRecipient(supabase, p.r.id, { charges_vat: v }); await reload() }}
                            className={cn('h-7 px-2.5 text-[12px] font-semibold', yes === v ? 'bg-[#2563EB] text-white' : 'bg-surface text-text-secondary hover:bg-surface-elevated')}>
                            {v ? 'Yes 15%' : 'No'}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap font-semibold')}>{formatCurrency(p.excl + vat, currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── The Supply pill on a quote line ─────────────────────────────────────────

/** Under an outsourced line: who supplies it; click to see everyone asked and their prices. */
export function SupplyPill({ line, buyout, currency, onOpenBuyout }: { line: BuyoutQuoteLine; buyout: Buyout | null; currency: string; onOpenBuyout: () => void }) {
  const [open, setOpen] = useState(false)
  const bl = buyout?.lines.find(l => l.quoteLineId === line.id)
  const asked = bl ? buyout!.recipients.filter(r => asks(r, bl.rfqLineId) && r.status !== 'pending') : []
  const replies = bl ? buyout!.replies.filter(x => x.rfqLineId === bl.rfqLineId) : []
  const chosen = line.chosenResponseLineId ? replies.find(x => x.id === line.chosenResponseLineId) : undefined
  const chosenR = chosen ? buyout!.recipients.find(r => r.id === chosen.recipientId) : undefined

  const ownCost = !chosenR && (line.unitCost ?? 0) > 0
  const label = chosenR ? `${chosenR.name}${chosen?.leadDays != null ? ` · ${chosen.leadDays} days` : ''}`
    : ownCost ? 'Own cost price'
    : asked.length ? `Waiting · ${replies.length} of ${asked.length} replied` : 'No supplier yet'
  const tone = chosenR ? 'bg-emerald-50 text-emerald-800' : ownCost ? 'bg-slate-100 text-slate-700' : asked.length ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={cn('inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold', tone)}>
        <span className="material-icons !text-[13px]">local_shipping</span>{label}<span className="material-icons !text-[14px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && <button type="button" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-20 cursor-default" />}
      {open && (
        <div className="absolute left-0 top-7 z-30 w-[300px] rounded-xl border border-divider bg-surface-card shadow-xl p-3">
          <p className="text-[12px] font-semibold text-text-primary mb-1.5">Everyone asked for this item</p>
          {asked.length === 0 && <p className="text-[12px] text-text-secondary">Nobody asked yet.</p>}
          {asked.map(r => {
            const rep = replies.find(x => x.recipientId === r.id)
            return (
              <div key={r.id} className="flex justify-between gap-2 py-1.5 border-b border-divider/60 last:border-0 text-[12.5px]">
                <span className={cn(rep && rep.id === chosen?.id && 'font-semibold')}>{r.name}{rep?.leadDays != null ? <span className="text-text-secondary"> · {rep.leadDays}d</span> : null}</span>
                <span className="tabular-nums">{rep ? <>{formatCurrency(rep.unitPrice, currency)}{rep.id === chosen?.id ? ' ✓' : ''}</> : <span className="text-text-secondary">waiting</span>}</span>
              </div>
            )
          })}
          <button type="button" onClick={() => { setOpen(false); onOpenBuyout() }} className="mt-2 text-[12px] font-semibold text-primary hover:underline">Open Buyout →</button>
        </div>
      )}
    </span>
  )
}
