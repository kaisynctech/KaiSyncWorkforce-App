'use client'

/**
 * A supplier's private "Send your prices" page, opened from the request-for-quotation email. No login.
 * They see who is asking and the items they were asked for, and fill in their price, the quantity they can supply
 * and the lead time per item, whether their prices include VAT, until when the price holds, notes, and optionally
 * attach their own quote (PDF). They can come back and change their prices until the request closes.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { dayZA, fileToBase64, publicLogoUrl } from '@/lib/public-document'

type Line = { id: string; description: string; quantity: number; unit: string | null; specifications: string | null }
type View = {
  ok: true
  company: { name: string; brand_logo_path: string | null; contact_phone: string | null; contact_email: string | null; website: string | null }
  supplier: { name: string | null; contact_person: string | null; is_vat_registered: boolean | null }
  rfq: { number: string | null; required_by: string | null; reply_by: string | null; delivery_address: string | null }
  lines: Line[]
  reply: {
    sent: boolean; prices_include_vat: 'excl' | 'incl' | 'none' | null; valid_until: string | null; notes: string | null; has_attachment: boolean
    lines: { rfq_line_id: string; unit_price: number; quantity: number | null; lead_time_days: number | null; notes: string | null }[]
  }
  can_reply: boolean
}
type Row = { price: string; qty: string; lead: string }

async function call<T>(token: string, action: string, extra: Record<string, unknown> = {}): Promise<T | { ok: false; message: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  try {
    const res = await fetch(`${base}/functions/v1/rfq_reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ token, action, ...extra }),
    })
    return (await res.json().catch(() => ({ ok: false, message: 'Could not reach the server. Please try again.' }))) as T
  } catch {
    return { ok: false, message: 'Could not reach the server. Please check your connection and try again.' }
  }
}

const input = 'h-10 w-full rounded-lg border border-slate-300 px-3 text-[14px] text-slate-900 bg-white focus:outline-none focus:border-[#1E3A5F]'

export default function SupplierPricesPage() {
  const { token } = useParams<{ token: string }>()
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [vat, setVat] = useState<'excl' | 'incl' | 'none' | ''>('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    if (token === 'preview') { setError('This is where the supplier sends their prices.'); return }
    const r = await call<View>(token, 'view')
    if (!r.ok) { setError((r as { message: string }).message); return }
    const v = r as View
    setView(v)
    const next: Record<string, Row> = {}
    for (const l of v.lines) {
      const m = v.reply.lines.find(x => x.rfq_line_id === l.id)
      next[l.id] = { price: m ? String(m.unit_price) : '', qty: m?.quantity != null ? String(m.quantity) : '', lead: m?.lead_time_days != null ? String(m.lead_time_days) : '' }
    }
    setRows(next)
    setVat(v.reply.prices_include_vat ?? '')
    setValidUntil(v.reply.valid_until ?? '')
    setNotes(v.reply.notes ?? '')
  }, [token])

  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  async function submit() {
    if (!view) return
    setMsg(null)
    const lines = view.lines.map(l => {
      const r = rows[l.id] ?? { price: '', qty: '', lead: '' }
      return {
        rfq_line_id: l.id,
        unit_price: parseFloat(r.price.replace(/\s/g, '').replace(',', '.')),
        quantity: r.qty.trim() ? Number(r.qty.replace(',', '.')) : null,
        lead_time_days: r.lead.trim() ? Number(r.lead) : null,
      }
    }).filter(x => x.unit_price > 0)
    if (!lines.length) { setMsg({ ok: false, text: 'Enter a price for at least one item.' }); return }
    if (!vat) { setMsg({ ok: false, text: 'Please say whether your prices include VAT.' }); return }
    if (file && file.type !== 'application/pdf') { setMsg({ ok: false, text: 'Please attach your quote as a PDF.' }); return }
    setBusy(true)
    const extra: Record<string, unknown> = { lines, prices_include_vat: vat, valid_until: validUntil || null, notes }
    if (file) { extra.file_base64 = await fileToBase64(file); extra.mime = file.type; extra.filename = file.name }
    const r = await call<{ ok: boolean; message: string }>(token, 'submit', extra)
    setBusy(false)
    setMsg({ ok: !!r.ok, text: r.message })
    if (r.ok) { setFile(null); void load() }
  }

  if (error) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <span className="material-icons text-[40px] text-slate-400">link_off</span>
          <p className="mt-2 text-[15px] font-semibold text-slate-900">{error}</p>
          <p className="mt-1 text-[13px] text-slate-500">If you think this is a mistake, reply to the email you received.</p>
        </div>
      </Shell>
    )
  }
  if (!view) return <Shell><p className="text-center text-[14px] text-slate-500 py-16">Loading…</p></Shell>

  const c = view.company
  const logo = publicLogoUrl(c.brand_logo_path)
  const contacts = [c.contact_phone, c.contact_email, c.website].filter(Boolean) as string[]
  return (
    <Shell>
      <header className="flex items-center gap-4 mb-5">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={c.name} className="max-h-14 max-w-[180px] object-contain" />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-[#1E3A5F] text-white flex items-center justify-center text-[18px] font-bold">{c.name.slice(0, 1)}</div>
        )}
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-slate-900 truncate">{c.name}</p>
          {contacts.length > 0 && <p className="text-[12.5px] text-slate-500 truncate">{contacts.join(' · ')}</p>}
        </div>
      </header>

      <section className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Request for quotation{view.rfq.number ? ` ${view.rfq.number}` : ''}</h1>
          <p className="text-[13px] text-slate-600 mt-1">
            {view.supplier.contact_person || view.supplier.name ? `Hello ${view.supplier.contact_person || view.supplier.name}. ` : ''}
            Fill in what you can supply. Leave an item empty if you can&apos;t.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-slate-600">
            {view.rfq.required_by && <span>Needed by <b className="text-slate-900">{dayZA(view.rfq.required_by)}</b></span>}
            {view.rfq.reply_by && <span>Reply by <b className="text-slate-900">{dayZA(view.rfq.reply_by)}</b></span>}
            {view.rfq.delivery_address && <span>Deliver to <b className="text-slate-900">{view.rfq.delivery_address}</b></span>}
          </div>
        </div>

        {view.reply.sent && (
          <p className="rounded-lg bg-emerald-50 text-emerald-800 text-[13px] px-3 py-2">We have your prices. You can change them below and send again{view.can_reply ? '' : ' (this request is now closed)'}.</p>
        )}

        <div className="flex flex-col gap-3">
          {view.lines.map(l => {
            const r = rows[l.id] ?? { price: '', qty: '', lead: '' }
            const set = (patch: Partial<Row>) => setRows(x => ({ ...x, [l.id]: { ...r, ...patch } }))
            return (
              <div key={l.id} className="rounded-xl border border-slate-200 p-3">
                <p className="text-[14px] font-semibold text-slate-900">{l.description}</p>
                <p className="text-[12.5px] text-slate-500">Quantity {l.quantity}{l.unit && l.unit !== 'each' ? ` ${l.unit}` : ''}{l.specifications ? ` · ${l.specifications}` : ''}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="text-[11.5px] text-slate-600 flex flex-col gap-1">Unit price (R)
                    <input className={input} inputMode="decimal" value={r.price} disabled={!view.can_reply} onChange={e => set({ price: e.target.value })} placeholder="0.00" />
                  </label>
                  <label className="text-[11.5px] text-slate-600 flex flex-col gap-1">Qty you can supply
                    <input className={input} inputMode="decimal" value={r.qty} disabled={!view.can_reply} onChange={e => set({ qty: e.target.value })} placeholder={String(l.quantity)} />
                  </label>
                  <label className="text-[11.5px] text-slate-600 flex flex-col gap-1">Lead time (days)
                    <input className={input} inputMode="numeric" value={r.lead} disabled={!view.can_reply} onChange={e => set({ lead: e.target.value })} placeholder="e.g. 3" />
                  </label>
                </div>
              </div>
            )
          })}
        </div>

        <fieldset className="rounded-xl border border-slate-200 p-3" disabled={!view.can_reply}>
          <legend className="px-1 text-[12.5px] font-semibold text-slate-700">Do your prices include VAT?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13.5px]">
            {([['excl', 'No, VAT is added'], ['incl', 'Yes, VAT included'], ['none', 'Not VAT registered']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2"><input type="radio" name="vat" checked={vat === k} onChange={() => setVat(k)} className="w-4 h-4" />{label}</label>
            ))}
          </div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[12.5px] text-slate-600 flex flex-col gap-1">Prices valid until
            <input type="date" className={input} value={validUntil} disabled={!view.can_reply} onChange={e => setValidUntil(e.target.value)} />
          </label>
          <label className="text-[12.5px] text-slate-600 flex flex-col gap-1">Your quote (PDF, optional){view.reply.has_attachment ? ' · one attached already' : ''}
            <input type="file" accept="application/pdf" disabled={!view.can_reply} onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-[13px] py-2" />
          </label>
        </div>
        <label className="text-[12.5px] text-slate-600 flex flex-col gap-1">Notes
          <textarea rows={3} value={notes} disabled={!view.can_reply} onChange={e => setNotes(e.target.value)} placeholder="Anything we should know: brand, stock, delivery…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] text-slate-900 focus:outline-none focus:border-[#1E3A5F]" />
        </label>

        {msg && <p className={`text-[13px] rounded-lg px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
        {view.can_reply && (
          <button type="button" onClick={() => void submit()} disabled={busy}
            className="h-12 rounded-xl bg-[#1E3A5F] text-white text-[15px] font-semibold hover:bg-[#16304f] disabled:opacity-60">
            {busy ? 'Sending…' : view.reply.sent ? 'Send updated prices' : 'Send prices'}
          </button>
        )}
      </section>
      <p className="text-center text-[11px] text-slate-400 mt-8">This page is private to you. Please don&apos;t share the link.</p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" style={{ colorScheme: 'light' }}>
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">{children}</div>
    </div>
  )
}
