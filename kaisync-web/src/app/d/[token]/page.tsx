'use client'

/**
 * The client's online invoice or quote, opened from the private link in the email. No login.
 * Invoice: see it, download the PDF, banking details, send proof of payment.
 * Quote: see it (choosing between options), download the PDF, accept (type your name) or decline, pay the deposit
 * and send proof, ask a question and see the answer.
 */

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { letterheadFromRow, loadLetterheadLogo, bankLines } from '@/lib/letterhead'
import { currencySymbol } from '@/lib/currencies'
import {
  callPublicDocument, dayZA, fileToBase64, publicLogoUrl, quoteWithChoices, randZA,
  type PublicInvoiceView, type PublicQuoteLine, type PublicQuoteView, type PublicResult, type PublicView,
} from '@/lib/public-document'

export default function PublicDocumentPage() {
  const { token } = useParams<{ token: string }>()
  const [view, setView] = useState<PublicView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await callPublicDocument<PublicView>(token, 'view')
    if (r.ok) { setView(r as PublicView); setError(null) } else setError((r as { message: string }).message)
  }, [token])

  useEffect(() => { void load() }, [load])

  // Opened from a portal's "Download PDF": download once the document has loaded.
  const [autoPdf, setAutoPdf] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pdf') === '1')
  useEffect(() => {
    if (!autoPdf || !view) return
    const t = setTimeout(() => { setAutoPdf(false); void downloadPdf(view) }, 0)
    return () => clearTimeout(t)
  }, [autoPdf, view])

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
  const logo = publicLogoUrl(c.brand_logo_path as string | null)
  const contacts = [c.contact_phone, c.contact_email, c.website].filter(Boolean) as string[]
  return (
    <Shell>
      <header className="flex items-center gap-4 mb-5">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={String(c.name ?? '')} className="max-h-14 max-w-[180px] object-contain" />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-[#1E3A5F] text-white flex items-center justify-center text-[18px] font-bold">
            {String(c.name ?? 'C').slice(0, 1)}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-slate-900 truncate">{String(c.name ?? '')}</p>
          {contacts.length > 0 && <p className="text-[12.5px] text-slate-500 truncate">{contacts.join(' · ')}</p>}
        </div>
      </header>
      {view.kind === 'invoice' ? <InvoiceView token={token} v={view} onChange={load} /> : <QuoteView token={token} v={view} onChange={load} />}
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

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`bg-white rounded-2xl border border-slate-200 p-5 ${className}`}>{children}</section>
}

/** A quote line's discount in %, worked out from its price and its total (the total is after the discount). */
function lineDiscountPct(qty: number, price: number, total: number): number {
  const gross = qty * price
  if (!(gross > 0) || total >= gross - 0.005) return 0
  return Math.round((1 - total / gross) * 10000) / 100
}

function Lines({ rows, currency }: { rows: { description: string; qty: number; price: number; total: number }[]; currency?: string | null }) {
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((r, i) => {
        const disc = lineDiscountPct(r.qty, r.price, r.total)
        return (
        <div key={i} className="py-2.5 flex items-start justify-between gap-3 text-[13.5px]">
          <div className="min-w-0">
            <p className="text-slate-900 whitespace-pre-line">{r.description || '—'}</p>
            {(r.qty !== 1 || disc > 0) && (
              <p className="text-[12px] text-slate-500">
                {r.qty} × {randZA(r.price, currency)}{disc > 0 ? ` · less ${disc}% discount` : ''}
              </p>
            )}
          </div>
          <p className="font-medium shrink-0">{randZA(r.total, currency)}</p>
        </div>
        )
      })}
    </div>
  )
}

function Totals({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <div className="mt-3 pt-3 border-t border-slate-200 space-y-1.5 text-[13.5px]">
      {rows.map(([l, v, bold]) => (
        <div key={l} className={`flex justify-between ${bold ? 'font-semibold text-[15px]' : 'text-slate-600'}`}><span>{l}</span><span>{v}</span></div>
      ))}
    </div>
  )
}

async function downloadPdf(v: PublicView, choices: Record<string, string> = {}) {
  const lh = await loadLetterheadLogo(createClient(), letterheadFromRow(v.company))
  const client = v.client ?? {}
  if (v.kind === 'invoice') {
    const { buildInvoicePdf } = await import('@/lib/invoice-pdf')
    const doc = buildInvoicePdf({
      invoice_number: v.doc.number, status: v.doc.status, issue_date: v.doc.issue_date, due_date: v.doc.due_date, notes: v.doc.notes,
      client_name: client.name ?? null, client_email: client.email ?? null, client_legal_name: client.legal_name ?? null,
      client_address: client.billing_address?.trim() || client.address?.trim() || null, client_vat_number: client.vat_number ?? null,
      company_name: lh.name, letterhead: lh,
      lines: v.lines.map(l => ({ description: l.description, qty: Number(l.quantity), unit_price: Number(l.unit_price), vat_amount: Number(l.vat_amount), total: Number(l.total_amount) })),
      subtotal: Number(v.doc.subtotal), vat: Number(v.doc.vat), total: Number(v.doc.total), amount_paid: Number(v.doc.paid), balance_due: Number(v.doc.balance), currency: v.doc.currency,
    })
    doc.save(`Invoice_${(v.doc.number ?? 'invoice').replace(/[^\w.-]+/g, '_')}.pdf`)
  } else {
    const { buildQuotePdf } = await import('@/lib/quote-pdf')
    const q = quoteWithChoices(v, choices)
    const doc = buildQuotePdf({
      quote_number: v.doc.number, title: v.doc.title, status: v.doc.status, valid_until: v.doc.valid_until, notes: v.doc.notes,
      client_name: client.name ?? null, client_email: client.email ?? null, company_name: lh.name, letterhead: lh,
      lines: q.lines.map(l => ({ description: l.description, qty: Number(l.quantity), unit: l.unit ?? 'each', unit_price: Number(l.unit_sell_price), total: Number(l.subtotal_sell), discount_pct: lineDiscountPct(Number(l.quantity), Number(l.unit_sell_price), Number(l.subtotal_sell)), section: l.section ?? null, extra: l.extra, recurring: l.recurring_period ?? null })),
      subtotal: q.subtotal, vat: q.vat, total: q.total,
      vatRate: q.subtotal > 0 ? q.vat / q.subtotal : 0, currency: v.doc.currency,
      ...(v.columns?.length ? {
        columns: v.columns, header_fields: v.doc.header_fields ?? [],
        deposit: q.deposit > 0 && v.doc.deposit ? { pct: v.doc.deposit.pct, amount: q.deposit } : null,
        recurring: (Object.entries(q.recurring) as ['week' | 'month' | 'year', number][]).map(([period, amount]) => ({ period, amount })),
        terms: v.doc.terms,
      } : {}),
    })
    doc.save(`Quote_${(v.doc.number ?? 'quote').replace(/[^\w.-]+/g, '_')}.pdf`)
  }
}

function PdfButton({ v, choices }: { v: PublicView; choices?: Record<string, string> }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await downloadPdf(v, choices) } finally { setBusy(false) } }}
      className="h-11 px-4 rounded-xl border border-slate-300 bg-white text-[14px] font-medium text-slate-800 hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-60">
      <span className="material-icons text-[18px]">download</span>{busy ? 'Preparing…' : 'Download PDF'}
    </button>
  )
}

// ── Invoice ────────────────────────────────────────────────────────────────────

function InvoiceView({ token, v, onChange }: { token: string; v: PublicInvoiceView; onChange: () => Promise<void> }) {
  const d = v.doc
  const vatShown = Math.abs(Number(d.vat) || 0) > 0.004
  const bank = bankLines(letterheadFromRow(v.company).bank)
  const overdue = !v.fully_paid && !v.closed && d.due_date && new Date(`${d.due_date}T23:59:59`) < new Date()
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[12px] uppercase tracking-wide text-slate-500">{vatShown ? 'Tax invoice' : 'Invoice'} {d.number}</p>
        {v.closed ? (
          <p className="mt-1 text-[22px] font-semibold text-slate-500">Cancelled</p>
        ) : v.fully_paid ? (
          <p className="mt-1 text-[22px] font-semibold text-emerald-700 flex items-center gap-2"><span className="material-icons">check_circle</span>Paid in full — thank you</p>
        ) : (
          <>
            <p className="mt-1 text-[28px] font-bold">{randZA(d.balance, d.currency)}</p>
            <p className={`text-[13.5px] ${overdue ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
              {overdue ? 'Overdue — was due ' : 'Due '}{dayZA(d.due_date)}
            </p>
          </>
        )}
        <p className="mt-2 text-[12.5px] text-slate-500">For {v.client?.name ?? '—'} · Issued {dayZA(d.issue_date)}</p>
        <div className="mt-4 flex flex-wrap gap-2"><PdfButton v={v} /></div>
      </Card>

      {v.can_pay && bank.length > 0 && (
        <Card>
          <p className="text-[14px] font-semibold mb-2">How to pay</p>
          <dl className="text-[13.5px] grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {bank.map(([k, val]) => <FragmentRow key={k} k={k} v={val} />)}
            <FragmentRow k="Reference" v={d.number ?? ''} strong />
          </dl>
        </Card>
      )}

      {v.can_pay && <ProofForm token={token} balance={Number(d.balance)} currency={d.currency} onDone={onChange} proofs={v.proofs} />}

      <Card>
        <p className="text-[14px] font-semibold mb-1">Details</p>
        <Lines rows={v.lines.map(l => ({ description: l.description, qty: Number(l.quantity), price: Number(l.unit_price), total: Number(l.total_amount) }))} currency={d.currency} />
        <Totals rows={[
          ...(vatShown ? [['Total excl. VAT', randZA(d.subtotal, d.currency)], ['VAT', randZA(d.vat, d.currency)]] as [string, string][] : []),
          [vatShown ? 'Total incl. VAT' : 'Total', randZA(d.total, d.currency), true],
          ...(Number(d.paid) > 0 ? [['Paid', randZA(d.paid, d.currency)], ['Balance due', randZA(d.balance, d.currency), true]] as [string, string, boolean?][] : []),
        ]} />
        {d.notes && <p className="mt-3 text-[12.5px] text-slate-500 whitespace-pre-line">{d.notes}</p>}
      </Card>
    </div>
  )
}

function FragmentRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={`${strong ? 'font-semibold' : ''} flex items-center gap-2`}>
        <span className="break-all">{v}</span>
        <button type="button" title="Copy" onClick={() => void navigator.clipboard?.writeText(v)} className="text-slate-400 hover:text-slate-700">
          <span className="material-icons text-[15px]">content_copy</span>
        </button>
      </dd>
    </>
  )
}

function ProofForm({ token, balance, currency, onDone, proofs }: { token: string; balance: number; currency?: string | null; onDone: () => Promise<void>; proofs: PublicInvoiceView['proofs'] }) {
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : '')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PublicResult | null>(null)
  const waiting = proofs.filter(p => p.status === 'submitted').length

  async function send() {
    if (!file) { setResult({ ok: false, message: 'Choose your proof of payment (PDF or photo).' }); return }
    if (file.size > 8 * 1024 * 1024) { setResult({ ok: false, message: 'The file is too big. Please keep it under 8 MB.' }); return }
    setBusy(true); setResult(null)
    try {
      const file_base64 = await fileToBase64(file)
      const r = await callPublicDocument(token, 'proof', { file_base64, filename: file.name, mime: file.type, amount: amount || null, reference })
      setResult(r)
      if (r.ok) { setFile(null); await onDone() }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' })
    }
    setBusy(false)
  }

  return (
    <Card>
      <p className="text-[14px] font-semibold">Already paid? Send us your proof of payment</p>
      <p className="text-[12.5px] text-slate-500 mt-0.5">A PDF or a photo of the bank confirmation. We&apos;ll check it and confirm.</p>
      {waiting > 0 && <p className="mt-2 text-[12.5px] text-emerald-700">We have {waiting} proof{waiting === 1 ? '' : 's'} from you waiting to be checked.</p>}
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-[12.5px] font-medium text-slate-600">File</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-[13px] file:mr-3 file:h-10 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-800 file:font-medium" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12.5px] font-medium text-slate-600">Amount paid ({currencySymbol(currency ?? 'ZAR')})</span>
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 text-[14px] bg-white" />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-medium text-slate-600">Your reference (optional)</span>
            <input value={reference} onChange={e => setReference(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 text-[14px] bg-white" />
          </label>
        </div>
        {result && <p className={`text-[13px] ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message}</p>}
        <button type="button" disabled={busy} onClick={() => void send()}
          className="w-full h-12 rounded-xl bg-[#1E3A5F] text-white text-[14.5px] font-semibold hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2">
          <span className="material-icons text-[18px]">upload</span>{busy ? 'Sending…' : 'Send proof of payment'}
        </button>
      </div>
    </Card>
  )
}

// ── Quote ──────────────────────────────────────────────────────────────────────

function QuoteView({ token, v, onChange }: { token: string; v: PublicQuoteView; onChange: () => Promise<void> }) {
  const d = v.doc
  const cur = d.currency
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [result, setResult] = useState<PublicResult | null>(null)
  const q = quoteWithChoices(v, choices)
  const vatShown = Math.abs(q.vat) > 0.004
  const options = v.options ?? []
  const optionsFor = (id?: string) => options.filter(o => o.option_of === id)
  const di = v.deposit_invoice ?? null
  const bank = bankLines(letterheadFromRow(v.company).bank)
  const cols = v.columns ?? []

  async function respond(action: 'accept' | 'decline') {
    setBusy(action); setResult(null)
    const r = await callPublicDocument(token, action, action === 'accept' ? { name, choices: Object.values(choices) } : { reason })
    setResult(r)
    setBusy(null)
    if (r.ok) await onChange()
  }

  // Lines by section (template quotations with phases), in order.
  const groups: { section: string | null; lines: PublicQuoteLine[] }[] = []
  for (const l of q.lines) {
    const s = l.is_contingency ? null : (l.section ?? null)
    let g = groups.find(x => x.section === s)
    if (!g) { g = { section: s, lines: [] }; groups.push(g) }
    g.lines.push(l)
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[12px] uppercase tracking-wide text-slate-500">Quotation {d.number}</p>
        <p className="mt-1 text-[18px] font-semibold">{d.title && d.title !== 'Untitled Quote' ? d.title : `For ${v.client?.name ?? 'you'}`}</p>
        <p className="mt-1 text-[28px] font-bold">{randZA(q.total, cur)}</p>
        {q.deposit > 0 && d.status !== 'accepted' && <p className="text-[14px] text-slate-700">Deposit to accept: <b>{randZA(q.deposit, cur)}</b> ({d.deposit?.pct}%)</p>}
        <p className="text-[13px] text-slate-600">
          For {v.client?.name ?? '—'}{d.valid_until ? ` · Valid until ${dayZA(d.valid_until)}` : ''}
        </p>
        {(d.header_fields ?? []).length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {(d.header_fields ?? []).map(h => <Fragment key={h.label}><dt className="text-slate-500">{h.label}</dt><dd className="text-slate-900">{h.value}</dd></Fragment>)}
          </dl>
        )}
        {d.status === 'accepted' && <p className="mt-3 text-[14px] font-semibold text-emerald-700 flex items-center gap-2"><span className="material-icons">check_circle</span>Accepted{d.accepted_at ? ` on ${dayZA(d.accepted_at)}` : ''} — thank you</p>}
        {d.status === 'declined' && <p className="mt-3 text-[14px] font-semibold text-slate-600">Declined{d.declined_at ? ` on ${dayZA(d.declined_at)}` : ''}</p>}
        {d.expired && d.status !== 'accepted' && d.status !== 'declined' && <p className="mt-3 text-[13.5px] font-medium text-amber-700">This quote has expired. Please contact us for an updated one.</p>}
        <div className="mt-4 flex flex-wrap gap-2"><PdfButton v={v} choices={choices} /></div>
      </Card>

      {/* The deposit after accepting: how to pay, then proof. */}
      {di && Number(di.balance) > 0.004 && (
        <>
          <Card className="border-emerald-300">
            <p className="text-[14px] font-semibold">Pay the deposit to confirm</p>
            <p className="mt-1 text-[26px] font-bold">{randZA(di.balance, cur)}</p>
            <p className="text-[12.5px] text-slate-500">Invoice {di.number}{di.due_date ? ` · please pay by ${dayZA(di.due_date)}` : ''}</p>
            {bank.length > 0 ? (
              <dl className="mt-3 text-[13.5px] grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {bank.map(([k, val]) => <FragmentRow key={k} k={k} v={val} />)}
                <FragmentRow k="Reference" v={di.number ?? d.number ?? ''} strong />
              </dl>
            ) : <p className="mt-2 text-[13px] text-slate-600">Please contact us for our banking details.</p>}
          </Card>
          <ProofForm token={token} balance={Number(di.balance)} currency={cur} onDone={onChange} proofs={di.proofs} />
        </>
      )}
      {di && Number(di.balance) <= 0.004 && <Card><p className="text-[14px] font-semibold text-emerald-700 flex items-center gap-2"><span className="material-icons">check_circle</span>Deposit received — thank you</p></Card>}

      <Card>
        <p className="text-[14px] font-semibold mb-1">What&apos;s included</p>
        {options.length > 0 && v.can_respond && <p className="text-[12.5px] text-slate-500 mb-1">Some items have choices. Tap the one you want; the total updates.</p>}
        {groups.map(g => (
          <div key={g.section ?? '_'} className={g.section ? 'mt-3' : ''}>
            {g.section && (
              <div className="flex justify-between text-[12.5px] font-semibold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
                <span>{g.section}</span><span>{randZA(g.lines.reduce((s, l) => s + Number(l.subtotal_sell || 0), 0), cur)}</span>
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {g.lines.map(l => {
                const mainId = l.option_of ?? l.id
                const alts = v.can_respond ? optionsFor(mainId) : []
                if (!alts.length) return <QuoteLineRow key={l.id ?? l.description} l={l} cols={cols} cur={cur} />
                const main = v.lines.find(x => x.id === mainId) ?? l
                const picked = choices[mainId ?? ''] ?? mainId
                return (
                  <div key={mainId} className="py-2.5">
                    <p className="text-[12px] font-medium text-slate-500 mb-1.5">Choose one</p>
                    <div className="space-y-2">
                      {[main, ...alts].map(c => {
                        const on = picked === c.id
                        return (
                          <button key={c.id} type="button" aria-pressed={on}
                            onClick={() => setChoices(prev => {
                              const n = { ...prev }
                              if (c.id === mainId) delete n[mainId ?? '']; else n[mainId ?? ''] = c.id ?? ''
                              return n
                            })}
                            className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-start gap-3 ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                            <span className={`material-icons text-[22px] ${on ? 'text-emerald-600' : 'text-slate-300'}`}>{on ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
                            <span className="flex-1 min-w-0"><QuoteLineText l={c} cols={cols} cur={cur} /></span>
                            <span className="font-medium shrink-0 text-[13.5px]">{randZA(c.subtotal_sell, cur)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <Totals rows={[
          ...(vatShown ? [['Total excl. VAT', randZA(q.subtotal, cur)], ['VAT', randZA(q.vat, cur)]] as [string, string][] : []),
          [vatShown ? 'Total incl. VAT' : 'Total', randZA(q.total, cur), true],
          ...(q.deposit > 0 ? [[`Deposit to accept (${d.deposit?.pct}%)`, randZA(q.deposit, cur), true]] as [string, string, boolean][] : []),
          ...(Object.entries(q.recurring) as [string, number][]).map(([p, a]) => [`Then every ${p} (excl. VAT)`, randZA(a, cur)] as [string, string]),
        ]} />
        {d.notes && <p className="mt-3 text-[12.5px] text-slate-600 whitespace-pre-line">{d.notes}</p>}
        {d.terms && <p className="mt-3 text-[12px] text-slate-500 whitespace-pre-line">{d.terms}</p>}
      </Card>

      {v.can_respond && (
        <Card>
          {!declining ? (
            <>
              <p className="text-[14px] font-semibold">Happy with the quote?</p>
              {q.changed && <p className="mt-1 text-[12.5px] text-emerald-700">With your choices: {randZA(q.total, cur)}</p>}
              <label className="block mt-3">
                <span className="text-[12.5px] font-medium text-slate-600">Your full name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Thandi Mokoena" autoComplete="name"
                  className="mt-1 w-full h-12 rounded-xl border border-slate-300 px-3 text-[15px] bg-white" />
              </label>
              <p className="mt-2 text-[12px] text-slate-500">By accepting, you agree to the quote{q.deposit > 0 ? `, its terms and paying the ${randZA(q.deposit, cur)} deposit` : ' and its terms'}.</p>
              {result && <p className={`mt-2 text-[13px] ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message}</p>}
              <button type="button" disabled={busy !== null || name.trim().length < 2} onClick={() => void respond('accept')}
                className="mt-3 w-full h-12 rounded-xl bg-emerald-600 text-white text-[15px] font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
                <span className="material-icons text-[19px]">check</span>{busy === 'accept' ? 'Accepting…' : q.deposit > 0 ? 'Accept and pay deposit' : 'Accept quote'}
              </button>
              <button type="button" onClick={() => { setDeclining(true); setResult(null) }} className="mt-2 w-full h-10 text-[13.5px] text-slate-600 hover:text-slate-900">
                Decline this quote
              </button>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold">Decline the quote</p>
              <label className="block mt-3">
                <span className="text-[12.5px] font-medium text-slate-600">Tell us why (optional)</span>
                <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-[14px] bg-white resize-none" />
              </label>
              {result && <p className={`mt-2 text-[13px] ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setDeclining(false)} className="flex-1 h-11 rounded-xl border border-slate-300 text-[14px]">Back</button>
                <button type="button" disabled={busy !== null} onClick={() => void respond('decline')}
                  className="flex-1 h-11 rounded-xl bg-slate-800 text-white text-[14px] font-semibold disabled:opacity-50">
                  {busy === 'decline' ? 'Sending…' : 'Decline'}
                </button>
              </div>
            </>
          )}
        </Card>
      )}
      {!v.can_respond && result?.ok && <Card><p className="text-[14px] text-emerald-700">{result.message}</p></Card>}

      <QuestionsCard token={token} messages={v.messages ?? []} clientName={v.client?.name ?? ''} onSent={onChange} />
    </div>
  )
}

function QuoteLineText({ l, cols, cur }: { l: PublicQuoteLine; cols: { key: string; label: string }[]; cur?: string | null }) {
  const details = cols.filter(c => !['item', 'qty', 'price', 'rate', 'total', 'unit', 'days'].includes(c.key) && l.extra?.[c.key]).map(c => l.extra![c.key])
  const days = Number(l.extra?.days) || 0
  const units = days ? Math.round((Number(l.quantity) / days) * 100) / 100 : Number(l.quantity)
  const disc = lineDiscountPct(Number(l.quantity), Number(l.unit_sell_price), Number(l.subtotal_sell))
  return (
    <>
      <span className="block text-slate-900 text-[13.5px] whitespace-pre-line">{l.description || '—'}{l.recurring_period ? <span className="text-emerald-700"> · every {l.recurring_period}</span> : null}</span>
      {details.length > 0 && <span className="block text-[12px] text-slate-500">{details.join(' · ')}</span>}
      {(units !== 1 || days > 0 || disc > 0) && !l.is_contingency && (
        <span className="block text-[12px] text-slate-500">
          {units}{days ? ` × ${days} days` : ''} × {randZA(l.unit_sell_price, cur)}{l.unit && l.unit !== 'each' ? ` per ${l.unit}` : ''}{disc > 0 ? ` · less ${disc}% discount` : ''}
        </span>
      )}
      {l.extra?.note && <span className="block text-[12px] text-slate-500 italic">{l.extra.note}</span>}
    </>
  )
}

function QuoteLineRow({ l, cols, cur }: { l: PublicQuoteLine; cols: { key: string; label: string }[]; cur?: string | null }) {
  return (
    <div className="py-2.5 flex items-start justify-between gap-3">
      <div className="min-w-0"><QuoteLineText l={l} cols={cols} cur={cur} /></div>
      <p className="font-medium shrink-0 text-[13.5px]">{randZA(l.subtotal_sell, cur)}</p>
    </div>
  )
}

function QuestionsCard({ token, messages, clientName, onSent }: {
  token: string; messages: NonNullable<PublicQuoteView['messages']>; clientName: string; onSent: () => Promise<void>
}) {
  const [open, setOpen] = useState(messages.length > 0)
  const [text, setText] = useState('')
  const [who, setWho] = useState(clientName)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PublicResult | null>(null)
  async function send() {
    setBusy(true); setResult(null)
    const r = await callPublicDocument(token, 'ask', { body: text, name: who })
    setResult(r)
    setBusy(false)
    if (r.ok) { setText(''); await onSent() }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full h-12 rounded-2xl border border-slate-300 bg-white text-[14.5px] font-medium text-slate-800 flex items-center justify-center gap-2">
        <span className="material-icons text-[19px]">chat_bubble_outline</span>Ask a question
      </button>
    )
  }
  return (
    <Card>
      <p className="text-[14px] font-semibold">Questions</p>
      {messages.length > 0 && (
        <ul className="mt-3 space-y-2">
          {messages.map((m, i) => (
            <li key={i} className={`rounded-2xl px-3 py-2 text-[13.5px] max-w-[88%] ${m.from_client ? 'bg-slate-100 ml-auto' : 'bg-emerald-50 border border-emerald-200'}`}>
              <p className="text-[11px] text-slate-500">{m.from_client ? (m.author_name || 'You') : (m.author_name || 'Reply')} · {new Date(m.created_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              <p className="whitespace-pre-line text-slate-900">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <label className="block mt-3">
        <span className="text-[12.5px] font-medium text-slate-600">Your question</span>
        <textarea rows={3} value={text} maxLength={2000} onChange={e => setText(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-[14px] bg-white resize-none" />
      </label>
      <label className="block mt-2">
        <span className="text-[12.5px] font-medium text-slate-600">Your name</span>
        <input value={who} onChange={e => setWho(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 text-[14px] bg-white" />
      </label>
      {result && <p className={`mt-2 text-[13px] ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message}</p>}
      <button type="button" disabled={busy || text.trim().length < 2} onClick={() => void send()}
        className="mt-3 w-full h-12 rounded-xl bg-[#1E3A5F] text-white text-[14.5px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
        <span className="material-icons text-[18px]">send</span>{busy ? 'Sending…' : 'Send question'}
      </button>
    </Card>
  )
}
