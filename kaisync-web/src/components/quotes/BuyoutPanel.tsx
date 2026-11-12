'use client'

/**
 * The quote's Buyout tab: ask suppliers (or contractors, for an outsourced service) for prices on the outsourced
 * lines, then compare their replies and choose. Choosing puts that supplier's cost on the quote line straight away.
 *
 * Ask:     1 choose suppliers (or add a new one with their email) → 2 tick who quotes on what → 3 check who it goes
 *          to, then send (one email per supplier, only their items, with a "Send your prices" link).
 * Replies: each item with every supplier asked, their price, VAT, quantity and lead time; "Choose", "Enter reply"
 *          (they answered by email), or your own cost. Under it, the purchase orders the choices will make.
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

const VAT_LABEL: Record<PriceVat, string> = { excl: 'No, VAT added', incl: 'Yes, incl. VAT', none: 'Not VAT registered' }
const card = 'bg-surface-card border border-divider rounded-2xl'
const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary text-left whitespace-nowrap bg-surface-elevated/60 border-b border-divider'
const TD = 'px-3 py-2.5 text-[13px] border-b border-divider/60 align-middle'
const btn = 'h-8 px-3 rounded-lg border border-divider bg-surface text-[12.5px] font-semibold text-text-primary hover:bg-surface-elevated disabled:opacity-50'
const btnP = 'h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50'
const inp = 'h-8 w-full rounded-lg border border-divider px-2 text-[13px] bg-background text-text-primary focus:outline-none focus:border-primary/60'

function Num({ n, done }: { n: number; done?: boolean }) {
  return <span className={cn('w-6 h-6 rounded-full inline-flex items-center justify-center text-[12px] font-bold shrink-0', done ? 'bg-emerald-600 text-white' : 'bg-primary text-white')}>{done ? '✓' : n}</span>
}

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'blue'; children: React.ReactNode }) {
  const c = { green: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700', slate: 'bg-slate-100 text-slate-700', blue: 'bg-sky-50 text-sky-800' }[tone]
  return <span className={cn('inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap', c)}>{children}</span>
}

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '')

export function BuyoutPanel(props: Props) {
  const { buyout, lines, readOnly } = props
  const sent = (buyout?.recipients ?? []).some(r => r.status !== 'pending')
  const [view, setView] = useState<'ask' | 'replies'>(sent ? 'replies' : 'ask')
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-divider overflow-hidden bg-surface">
          {(['ask', 'replies'] as const).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cn('h-9 px-4 text-[13px] font-semibold', view === v ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-elevated')}>
              {v === 'ask' ? 'Ask suppliers' : `Replies and choose${buyout?.replies.length ? ` (${buyout.replies.length})` : ''}`}
            </button>
          ))}
        </div>
        {buyout?.rfqNumber && <span className="text-[12px] text-text-secondary">Request {buyout.rfqNumber}</span>}
      </div>
      {msg && <p className={cn('text-[12.5px] rounded-lg px-3 py-2', msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>{msg.text}</p>}
      {!buyout ? (
        <p className="text-[13px] text-text-secondary py-6 text-center">Getting the buyout ready…</p>
      ) : view === 'ask' ? (
        <AskView {...props} buyout={buyout} busy={busy} setBusy={setBusy} setMsg={setMsg} onSent={() => setView('replies')} />
      ) : (
        <RepliesView {...props} buyout={buyout} busy={busy || !!readOnly} setBusy={setBusy} setMsg={setMsg} />
      )}
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
    else { setMsg({ ok: true, text: `Sent to ${ready.length} ${ready.length === 1 ? 'supplier' : 'suppliers'}. Their prices show under "Replies and choose" as they come in.` }); onSent() }
  }

  return (
    <>
      {/* 1 · Suppliers */}
      <section className={cn(card, 'p-4 flex flex-col gap-3')}>
        <div className="flex items-center gap-2"><Num n={1} done={buyout.recipients.length > 0} /><h3 className="text-[14px] font-semibold text-text-primary">Who do you want prices from?</h3></div>
        <p className="text-[12.5px] text-text-secondary -mt-1">Search your suppliers, or contractors for an outsourced service. Not in KaiSync yet? Add them with their email.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2 relative">
            <input value={search} onChange={e => setSearch(e.target.value)} disabled={readOnly || busy} placeholder="Search suppliers and contractors…" aria-label="Search suppliers" className={cn(inp, 'h-9')} />
            {matches.length > 0 && (
              <div className="absolute top-10 left-0 right-0 z-20 rounded-xl border border-divider bg-surface-card shadow-lg overflow-hidden">
                {matches.map(s => (
                  <button key={s.id} type="button" onClick={() => void add(s)} className="w-full text-left px-3 py-2 hover:bg-primary/[0.05] border-b border-divider/60 last:border-0">
                    <span className="text-[13px] font-medium text-text-primary">{s.name}</span>
                    <span className="block text-[11.5px] text-text-secondary">{[s.partner_kind === 'contractor' ? 'Contractor' : 'Supplier', s.contact_person, s.email ?? 'no email yet'].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
            {search.trim() && matches.length === 0 && <p className="text-[12px] text-text-secondary">No match. Add them as a new supplier →</p>}
            <div className="flex flex-wrap gap-2">
              {buyout.recipients.map(r => (
                <span key={r.id} className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full bg-primary/10 text-primary text-[12.5px] font-semibold">
                  {r.name}
                  {r.status === 'pending' && !readOnly ? (
                    <button type="button" aria-label={`Remove ${r.name}`} disabled={busy}
                      onClick={async () => { setBusy(true); await removeRecipient(supabase, r.id); await reload(); setBusy(false) }}
                      className="w-5 h-5 rounded-full bg-primary/15 hover:bg-primary/25 text-[11px]">✕</button>
                  ) : <span className="text-[10.5px] font-medium opacity-80 pr-1">{r.status === 'responded' ? 'replied' : 'sent'}</span>}
                </span>
              ))}
              {buyout.recipients.length === 0 && <span className="text-[12px] text-text-secondary">No suppliers chosen yet.</span>}
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-divider bg-surface-elevated/40 p-3">
            {!adding ? (
              <button type="button" disabled={readOnly} onClick={() => setAdding(true)} className="text-[13px] font-semibold text-primary hover:underline">+ Add a new supplier</button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input className={inp} placeholder="Company name" aria-label="Company name" value={newSup.name} onChange={e => setNewSup(s => ({ ...s, name: e.target.value }))} />
                <input className={inp} placeholder="Contact person" aria-label="Contact person" value={newSup.contact} onChange={e => setNewSup(s => ({ ...s, contact: e.target.value }))} />
                <input className={inp} type="email" placeholder="Email address" aria-label="Email address" value={newSup.email} onChange={e => setNewSup(s => ({ ...s, email: e.target.value }))} />
                <div className="flex gap-2">
                  <button type="button" className={btn} disabled={busy} onClick={() => void addNew()}>Add and select</button>
                  <button type="button" className="text-[12px] text-text-secondary" onClick={() => setAdding(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2 · Who quotes on what */}
      {buyout.recipients.length > 0 && (
        <section className={cn(card, 'overflow-hidden')}>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2"><Num n={2} /><h3 className="text-[14px] font-semibold text-text-primary">Tick who quotes on what</h3></div>
          <p className="px-4 pb-3 text-[12.5px] text-text-secondary">Only outsourced items are listed. Each supplier gets one email with just their ticked items.</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[560px]">
              <thead><tr>
                <th className={TH}>Item</th><th className={TH}>Qty</th>
                {buyout.recipients.map(r => <th key={r.id} className={cn(TH, 'text-center')}>{r.name}</th>)}
              </tr></thead>
              <tbody>
                {buyout.lines.map(l => (
                  <tr key={l.rfqLineId}>
                    <td className={TD}><span className="font-medium text-text-primary">{l.description}</span></td>
                    <td className={TD}>{l.qty} <span className="text-text-secondary text-[11.5px]">{l.unit !== 'each' ? l.unit : ''}</span></td>
                    {buyout.recipients.map(r => (
                      <td key={r.id} className={cn(TD, 'text-center')}>
                        <input type="checkbox" className="w-[18px] h-[18px] accent-[var(--color-primary,#1E3A5F)]" checked={asks(r, l.rfqLineId)}
                          disabled={readOnly || busy || r.status !== 'pending'} aria-label={`Ask ${r.name} for ${l.description}`}
                          onChange={() => void toggle(r, l.rfqLineId)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3 · Check who it goes to */}
      {buyout.recipients.length > 0 && (
        <section className={cn(card, 'overflow-hidden')}>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2"><Num n={3} /><h3 className="text-[14px] font-semibold text-text-primary">Check who it goes to</h3></div>
          <p className="px-4 pb-3 text-[12.5px] text-text-secondary">Check the email for each supplier. A red row can&apos;t be sent until it has one.</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[720px]">
              <thead><tr><th className={TH}>Supplier</th><th className={TH}>Send to</th><th className={TH}>CC (optional)</th><th className={TH}>Items</th><th className={TH} /></tr></thead>
              <tbody>
                {buyout.recipients.map(r => {
                  const to = drafts[r.id]?.sendTo ?? sendToOf(r)
                  const ok = isEmailAddress(to)
                  const n = itemsFor(r).length
                  const done = r.status !== 'pending'
                  return (
                    <tr key={r.id} className={cn(!ok && !done && 'bg-red-50/60')}>
                      <td className={TD}><span className="font-semibold text-text-primary">{r.name}</span>{r.contact && <span className="block text-[11.5px] text-text-secondary">{r.contact}</span>}</td>
                      <td className={cn(TD, 'w-[260px]')}>
                        <input type="email" value={to} disabled={readOnly || done} placeholder="No email on file: type one" aria-label={`Email for ${r.name}`}
                          onChange={e => setDrafts(x => ({ ...x, [r.id]: { ...x[r.id], sendTo: e.target.value } }))} onBlur={() => void saveContact(r)}
                          className={cn(inp, !ok && !done && 'border-red-400')} />
                      </td>
                      <td className={cn(TD, 'w-[220px]')}>
                        <input value={drafts[r.id]?.cc ?? r.cc.join(', ')} disabled={readOnly || done} placeholder="add email" aria-label={`CC for ${r.name}`}
                          onChange={e => setDrafts(x => ({ ...x, [r.id]: { ...x[r.id], cc: e.target.value } }))} onBlur={() => void saveContact(r)} className={inp} />
                      </td>
                      <td className={TD}>{n} {n === 1 ? 'item' : 'items'}</td>
                      <td className={TD}>
                        {r.status === 'responded' ? <Pill tone="green">Replied {day(r.respondedAt)}</Pill>
                          : done ? <Pill tone="blue">Sent {day(r.sentAt)}{r.viewedAt ? ' · opened' : ''}</Pill>
                          : n === 0 ? <Pill tone="amber">No items ticked</Pill>
                          : ok ? <Pill tone="green">✓ Ready</Pill> : <Pill tone="red">Needs an email</Pill>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-surface-elevated/50 border-t border-divider flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">Reply by
              <input type="date" value={deadline} disabled={readOnly} onChange={e => void saveDeadline(e.target.value)} className={cn(inp, 'w-[150px]')} />
            </label>
            <div className="flex gap-2">
              <button type="button" className={btn} disabled={busy || !buyout.recipients.length} onClick={() => void showPreview()}>Preview</button>
              <button type="button" className={btnP} disabled={busy || readOnly || !ready.length} onClick={() => void sendAll()}>
                {busy ? 'Working…' : ready.length ? `Send ${ready.length} ${ready.length === 1 ? 'request' : 'requests'}` : 'Nothing ready to send'}
              </button>
            </div>
          </div>
        </section>
      )}

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

  // The purchase orders the choices will make: one per chosen supplier.
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
    <>
      <fieldset className={cn(card, 'px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]')} disabled={readOnly}>
        <legend className="sr-only">When I choose a supplier price</legend>
        <span className="font-semibold text-text-primary">When I choose a supplier price:</span>
        <label className="flex items-center gap-1.5"><input type="radio" name="keep" checked={keep === 'margin'} onChange={() => onKeep('margin')} /> keep my margin %</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="keep" checked={keep === 'price'} onChange={() => onKeep('price')} /> keep my selling price</label>
        <label className="flex items-center gap-1.5 text-text-secondary">Margin for lines with no price yet
          <input value={String(defaultMargin)} inputMode="decimal" aria-label="Default margin" onChange={e => onDefaultMargin(Math.min(95, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)))} className={cn(inp, 'w-[64px] text-right')} />%
        </label>
        <span className="ml-auto text-[12px] text-text-secondary">Choosing updates the quote straight away.</span>
      </fieldset>

      {buyout.lines.map(bl => {
        const ql = bl.quoteLineId ? byQuoteLine.get(bl.quoteLineId) : undefined
        const asked = buyout.recipients.filter(r => asks(r, bl.rfqLineId))
        const chosen = ql?.chosenResponseLineId ? buyout.replies.find(x => x.id === ql.chosenResponseLineId) : undefined
        const chosenR = chosen ? buyout.recipients.find(r => r.id === chosen.recipientId) : undefined
        const replied = asked.filter(r => buyout.replies.some(x => x.recipientId === r.id && x.rfqLineId === bl.rfqLineId)).length
        return (
          <section key={bl.rfqLineId} className={cn(card, 'overflow-hidden')}>
            <div className="px-4 py-3 border-b border-divider flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] font-semibold text-text-primary">{bl.description} <span className="font-normal text-text-secondary">· qty {bl.qty}</span></p>
              {!ql ? <Pill tone="slate">No longer on the quote</Pill>
                : chosenR ? <Pill tone="green">Chosen: {chosenR.name} · on the quote</Pill>
                : ql.unitCost ? <Pill tone="slate">Your own cost: {formatCurrency(ql.unitCost, currency)}</Pill>
                : <Pill tone="amber">{asked.length ? `Not chosen yet · ${replied} of ${asked.length} replied` : 'Nobody asked yet'}</Pill>}
            </div>
            {asked.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[760px]">
                  <thead><tr><th className={TH}>Supplier</th><th className={cn(TH, 'text-right')}>Unit price</th><th className={TH}>Incl. VAT?</th><th className={cn(TH, 'text-right')}>Can supply</th><th className={TH}>Lead time</th><th className={TH}>Notes</th><th className={TH} /></tr></thead>
                  <tbody>
                    {asked.map(r => {
                      const rep = buyout.replies.find(x => x.recipientId === r.id && x.rfqLineId === bl.rfqLineId)
                      const isChosen = !!rep && rep.id === ql?.chosenResponseLineId
                      const key = `${r.id}:${bl.rfqLineId}`
                      if (entering === key) {
                        return (
                          <tr key={r.id} className="bg-amber-50/60">
                            <td className={TD}><span className="font-medium">{r.name}</span><span className="block text-[11.5px] text-text-secondary">type in what they sent</span></td>
                            <td className={TD}><input className={cn(inp, 'text-right')} placeholder="Price" aria-label="Their unit price" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></td>
                            <td className={TD}>
                              <select className={inp} aria-label="Does their price include VAT" value={form.vat} onChange={e => setForm(f => ({ ...f, vat: e.target.value as PriceVat }))}>
                                {(Object.keys(VAT_LABEL) as PriceVat[]).map(k => <option key={k} value={k}>{VAT_LABEL[k]}</option>)}
                              </select>
                            </td>
                            <td className={TD}><input className={cn(inp, 'text-right')} placeholder={String(bl.qty)} aria-label="Quantity they can supply" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} /></td>
                            <td className={TD}><input className={inp} placeholder="days" aria-label="Lead time in days" value={form.lead} onChange={e => setForm(f => ({ ...f, lead: e.target.value }))} /></td>
                            <td className={TD}><button type="button" className="text-[12px] text-text-secondary" onClick={() => setEntering(null)}>Cancel</button></td>
                            <td className={cn(TD, 'text-right')}><button type="button" className={btn} disabled={busy} onClick={() => void saveEntered(r, bl.rfqLineId)}>Save reply</button></td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={r.id} className={cn(isChosen && 'bg-emerald-50/70')}>
                          <td className={TD}>
                            <span className={cn('text-text-primary', isChosen && 'font-semibold')}>{r.name}</span>
                            {r.attachmentPath && <button type="button" onClick={() => void openAttachment(r.attachmentPath!)} className="block text-[11.5px] text-primary hover:underline">Their quote (PDF)</button>}
                          </td>
                          <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap', isChosen && 'font-semibold')}>{rep ? formatCurrency(rep.unitPrice, currency) : '—'}</td>
                          <td className={TD}>{rep && r.pricesIncludeVat ? VAT_LABEL[r.pricesIncludeVat] : rep ? '—' : ''}</td>
                          <td className={cn(TD, 'text-right')}>{rep?.qty ?? (rep ? bl.qty : '')}</td>
                          <td className={TD}>{rep?.leadDays != null ? `${rep.leadDays} ${rep.leadDays === 1 ? 'day' : 'days'}` : ''}</td>
                          <td className={cn(TD, 'text-text-secondary text-[12px]')}>
                            {rep ? (rep.notes ?? r.notes ?? '') : r.status === 'pending' ? <Pill tone="slate">Not sent yet</Pill> : <Pill tone="slate">No reply yet{r.viewedAt ? ' · opened' : ''}</Pill>}
                          </td>
                          <td className={cn(TD, 'text-right whitespace-nowrap')}>
                            {isChosen ? <Pill tone="green">✓ Chosen</Pill> : rep && ql ? (
                              <button type="button" className={cn(btn, 'bg-primary text-white border-primary hover:bg-primary-dark')} disabled={busy}
                                onClick={() => onChoose(ql.id, { cost: costExVat(rep.unitPrice, r.pricesIncludeVat), supplierId: r.supplierId, responseLineId: rep.id })}>Choose</button>
                            ) : null}
                            {!readOnly && (
                              <button type="button" className="ml-2 text-[12px] text-primary hover:underline" onClick={() => startEnter(r, bl.rfqLineId, rep)}>{rep ? 'Edit' : 'Enter reply'}</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {ql && !readOnly && (
              <div className="px-4 py-2.5 bg-surface-elevated/40 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-text-secondary">Not using a supplier for this one?</span>
                <input value={ownCost[ql.id] ?? ''} onChange={e => setOwnCost(x => ({ ...x, [ql.id]: e.target.value }))} placeholder="Your own cost price" aria-label="Your own cost price" className={cn(inp, 'w-[170px]')} />
                <button type="button" className={btn} onClick={() => {
                  const n = parseFloat((ownCost[ql.id] ?? '').replace(/\s/g, '').replace(',', '.'))
                  if (!(n > 0)) { setMsg({ ok: false, text: 'Type a cost price.' }); return }
                  onChoose(ql.id, { ownCost: n }); setOwnCost(x => ({ ...x, [ql.id]: '' }))
                }}>Use my cost</button>
              </div>
            )}
          </section>
        )
      })}

      <section className={cn(card, 'overflow-hidden border-sky-200')}>
        <div className="px-4 py-3 border-b border-divider">
          <p className="text-[14px] font-semibold text-text-primary">Purchase orders to be created</p>
          <p className="text-[12px] text-text-secondary">One per chosen supplier. They are created and emailed when the client accepts and you process the order.</p>
        </div>
        {pos.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-text-secondary">Choose a supplier for an item and its purchase order shows here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[760px]">
              <thead><tr><th className={TH}>Supplier</th><th className={TH}>Items</th><th className={TH}>Send to</th><th className={cn(TH, 'text-right')}>Excl. VAT</th><th className={TH}>Supplier charges VAT?</th><th className={cn(TH, 'text-right')}>VAT</th><th className={cn(TH, 'text-right')}>Total</th></tr></thead>
              <tbody>
                {pos.map(p => {
                  const yes = p.r ? chargesVat(p.r) : true
                  const vat = yes ? Math.round(p.excl * 0.15 * 100) / 100 : 0
                  return (
                    <tr key={p.supplierId}>
                      <td className={TD}><span className="font-semibold">{p.r?.name ?? 'Supplier'}</span></td>
                      <td className={cn(TD, 'text-[12.5px]')}>{p.items.join(', ')}</td>
                      <td className={cn(TD, 'text-[12.5px] text-text-secondary')}>{p.r ? sendToOf(p.r) || '—' : '—'}</td>
                      <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap')}>{formatCurrency(p.excl, currency)}</td>
                      <td className={TD}>
                        <span className="inline-flex rounded-lg border border-divider overflow-hidden">
                          {[true, false].map(v => (
                            <button key={String(v)} type="button" disabled={readOnly || !p.r}
                              onClick={async () => { if (!p.r) return; await updateRecipient(supabase, p.r.id, { charges_vat: v }); await reload() }}
                              className={cn('h-7 px-3 text-[12px] font-semibold', yes === v ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-elevated')}>
                              {v ? 'Yes 15%' : 'No'}
                            </button>
                          ))}
                        </span>
                      </td>
                      <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap')}>{formatCurrency(vat, currency)}</td>
                      <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap font-semibold')}>{formatCurrency(p.excl + vat, currency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
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
