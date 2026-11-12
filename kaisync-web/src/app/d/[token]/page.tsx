'use client'

/**
 * The client's online invoice or quote, opened from the private link in the email. No login.
 * Invoice: see it, download the PDF, banking details, send proof of payment.
 * Quote: see it, download the PDF, accept (type your name) or decline.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { letterheadFromRow, loadLetterheadLogo, bankLines } from '@/lib/letterhead'
import {
  callPublicDocument, dayZA, fileToBase64, publicLogoUrl, randZA,
  type PublicInvoiceView, type PublicQuoteView, type PublicResult, type PublicView,
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

async function downloadPdf(v: PublicView) {
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
    const doc = buildQuotePdf({
      quote_number: v.doc.number, title: v.doc.title, status: v.doc.status, valid_until: v.doc.valid_until, notes: v.doc.notes,
      client_name: client.name ?? null, client_email: client.email ?? null, company_name: lh.name, letterhead: lh,
      lines: v.lines.map(l => ({ description: l.description, qty: Number(l.quantity), unit: l.unit ?? 'each', unit_price: Number(l.unit_sell_price), total: Number(l.subtotal_sell), discount_pct: lineDiscountPct(Number(l.quantity), Number(l.unit_sell_price), Number(l.subtotal_sell)) })),
      subtotal: Number(v.doc.subtotal), vat: Number(v.doc.vat), total: Number(v.doc.total),
      vatRate: Number(v.doc.subtotal) > 0 ? Number(v.doc.vat) / Number(v.doc.subtotal) : 0, currency: v.doc.currency,
    })
    doc.save(`Quote_${(v.doc.number ?? 'quote').replace(/[^\w.-]+/g, '_')}.pdf`)
  }
}

function PdfButton({ v }: { v: PublicView }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await downloadPdf(v) } finally { setBusy(false) } }}
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

      {v.can_pay && <ProofForm token={token} balance={Number(d.balance)} onDone={onChange} proofs={v.proofs} />}

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

function ProofForm({ token, balance, onDone, proofs }: { token: string; balance: number; onDone: () => Promise<void>; proofs: PublicInvoiceView['proofs'] }) {
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
            <span className="text-[12.5px] font-medium text-slate-600">Amount paid (R)</span>
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
  const vatShown = Math.abs(Number(d.vat) || 0) > 0.004
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [result, setResult] = useState<PublicResult | null>(null)

  async function respond(action: 'accept' | 'decline') {
    setBusy(action); setResult(null)
    const r = await callPublicDocument(token, action, action === 'accept' ? { name } : { reason })
    setResult(r)
    setBusy(null)
    if (r.ok) await onChange()
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[12px] uppercase tracking-wide text-slate-500">Quotation {d.number}</p>
        <p className="mt-1 text-[18px] font-semibold">{d.title}</p>
        <p className="mt-1 text-[28px] font-bold">{randZA(d.total, d.currency)}</p>
        <p className="text-[13px] text-slate-600">
          For {v.client?.name ?? '—'}{d.valid_until ? ` · Valid until ${dayZA(d.valid_until)}` : ''}
        </p>
        {d.status === 'accepted' && <p className="mt-3 text-[14px] font-semibold text-emerald-700 flex items-center gap-2"><span className="material-icons">check_circle</span>Accepted{d.accepted_at ? ` on ${dayZA(d.accepted_at)}` : ''} — thank you</p>}
        {d.status === 'declined' && <p className="mt-3 text-[14px] font-semibold text-slate-600">Declined{d.declined_at ? ` on ${dayZA(d.declined_at)}` : ''}</p>}
        {d.expired && d.status !== 'accepted' && d.status !== 'declined' && <p className="mt-3 text-[13.5px] font-medium text-amber-700">This quote has expired. Please contact us for an updated one.</p>}
        <div className="mt-4 flex flex-wrap gap-2"><PdfButton v={v} /></div>
      </Card>

      {v.can_respond && (
        <Card>
          {!declining ? (
            <>
              <p className="text-[14px] font-semibold">Happy with the quote?</p>
              <label className="block mt-3">
                <span className="text-[12.5px] font-medium text-slate-600">Your full name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Thandi Mokoena"
                  className="mt-1 w-full h-11 rounded-xl border border-slate-300 px-3 text-[14px] bg-white" />
              </label>
              <p className="mt-2 text-[12px] text-slate-500">By accepting, you agree to the quote and its terms.</p>
              {result && <p className={`mt-2 text-[13px] ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.message}</p>}
              <button type="button" disabled={busy !== null || name.trim().length < 2} onClick={() => void respond('accept')}
                className="mt-3 w-full h-12 rounded-xl bg-emerald-600 text-white text-[15px] font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
                <span className="material-icons text-[19px]">check</span>{busy === 'accept' ? 'Accepting…' : 'Accept quote'}
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

      <Card>
        <p className="text-[14px] font-semibold mb-1">What&apos;s included</p>
        <Lines rows={v.lines.map(l => ({ description: l.description, qty: Number(l.quantity), price: Number(l.unit_sell_price), total: Number(l.subtotal_sell) }))} currency={d.currency} />
        <Totals rows={[
          ...(vatShown ? [['Total excl. VAT', randZA(d.subtotal, d.currency)], ['VAT', randZA(d.vat, d.currency)]] as [string, string][] : []),
          [vatShown ? 'Total incl. VAT' : 'Total', randZA(d.total, d.currency), true],
        ]} />
        {d.notes && <p className="mt-3 text-[12.5px] text-slate-600 whitespace-pre-line">{d.notes}</p>}
        {d.terms && <p className="mt-3 text-[12px] text-slate-500 whitespace-pre-line">{d.terms}</p>}
      </Card>
    </div>
  )
}
