/**
 * The quotation and pro forma invoice PDF (client-side jsPDF). One design for both, in the company's colours
 * (picked from its logo, lib/brand-colours.ts): logo and company details, the document facts, who it's for and
 * where to deliver, the lines by section, totals with the deposit, then terms and the sign-off (quotation) or the
 * banking details (pro forma). The quotation screen's preview (QuoteDocumentPreview) draws the same layout.
 */

import { jsPDF } from 'jspdf'
import { formatCurrency } from '@/lib/currencies'
import { localISODate } from '@/lib/utils'
import { bankLines, letterheadFromRow, type Letterhead } from '@/lib/letterhead'
import { vatPercentLabel } from '@/lib/quote-vat'
import { DEFAULT_BRAND, rgbOf, type BrandColours } from '@/lib/brand-colours'

export type QuotePdfLine = {
  description: string
  qty: number
  unit: string
  unit_price: number
  /** Total for the line, after any discount. */
  total: number
  /** Discount on the line in % (a "Disc." column is printed when any line has one). */
  discount_pct?: number | null
  /** Template quotations (piece 7). */
  section?: string | null
  extra?: Record<string, string>
  /** An option the client can choose instead of the line before it: printed, not counted. */
  is_option?: boolean
  recurring?: 'week' | 'month' | 'year' | null
}

/** A column the client sees (team-only columns are never passed in). */
export type QuotePdfColumn = { key: string; label: string }

export type QuotePdfInput = {
  quote_number: string | null
  title: string
  status: string
  valid_until: string | null
  notes: string | null
  client_name: string | null
  client_email: string | null
  company_name: string
  company_code?: string | null
  lines: QuotePdfLine[]
  subtotal: number
  vat: number
  total: number
  /** Fraction, for example 0.15. Zero means the quote has no VAT. */
  vatRate?: number
  /** Company letterhead (logo, details, banking). Falls back to the company name only. */
  letterhead?: Letterhead | null
  /** The quote's currency (ISO code). Amounts print with the narrow symbol ("$500,00"). */
  currency?: string | null
  /** Template quotations: the columns to print, in order (no team-only ones). Without it the classic table prints. */
  columns?: QuotePdfColumn[] | null
  /** Fields at the top (vehicle, event date, site address, …), already labelled. */
  header_fields?: { label: string; value: string }[]
  deposit?: { pct: number; amount: number } | null
  recurring?: { period: 'week' | 'month' | 'year'; amount: number }[]
  terms?: string | null
  /** 'proforma' prints the pro forma invoice (number, amount due now, banking details). Default 'quote'. */
  kind?: 'quote' | 'proforma'
  /** The date on the document (yyyy-mm-dd); today when missing. */
  issue_date?: string | null
  /** The client's own reference (their order number); the quote number when empty. */
  reference?: string | null
  sales_rep?: string | null
  /** Who the quote goes to at the client. */
  contact?: { name?: string | null; email?: string | null; phone?: string | null } | null
  client_address?: string | null
  client_vat?: string | null
  /** Where and how to deliver. Printed in its own box. */
  delivery?: string | null
  /** Exchange rate note for a foreign currency, e.g. "R 19,15 per €". */
  rate_note?: string | null
  /** The client's online acceptance (name, when, signature image as a data URL). */
  accepted?: { name: string; at: string | null; signature?: string | null } | null
}

function money(n: number, currency?: string | null): string {
  return formatCurrency(n, currency)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d.includes('T') ? d : `${d}T12:00:00`).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** The pro forma's number: QU0092 → PF0092. */
export function proformaNumber(quoteNumber: string | null | undefined): string {
  const q = (quoteNumber ?? '').trim()
  if (!q) return 'PF (draft)'
  return /^QU/i.test(q) ? `PF${q.slice(2)}` : `PF-${q}`
}

type Rgb = [number, number, number]
const SLATE_900: Rgb = [15, 23, 42]
const SLATE_700: Rgb = [51, 65, 85]
const SLATE_500: Rgb = [100, 116, 139]
const SLATE_400: Rgb = [148, 163, 184]
const LINE: Rgb = [226, 232, 240]
const PANEL: Rgb = [248, 250, 252]

const PAGE_W = 210
const L = 16
const R = 194
const BOTTOM = 276

const COL_WIDTH: Record<string, number> = { qty: 13, days: 11, unit: 14, price: 26, rate: 26, total: 28, part_no: 24, brand: 20, condition: 22, warranty: 18 }
const NUMERIC = new Set(['qty', 'days', 'price', 'rate', 'total'])

/** Draws the quote (or pro forma). With `into`, it goes on new pages at the end of that document (quote + pro forma in one file). */
export function buildQuotePdf(input: QuotePdfInput, into?: jsPDF): jsPDF {
  const doc = into ?? new jsPDF({ unit: 'mm', format: 'a4' })
  if (into) doc.addPage()
  const first = doc.getNumberOfPages()
  const lh = input.letterhead ?? letterheadFromRow({ name: input.company_name }, input.company_name)
  const brand: BrandColours = lh.colours ?? DEFAULT_BRAND
  const accent = rgbOf(brand.accent)
  const accentText = rgbOf(brand.accentText)
  const accentSoft = rgbOf(brand.accentSoft)
  const dark = rgbOf(brand.dark)
  const isPf = input.kind === 'proforma'
  const cur = input.currency
  const fill = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2])
  const ink = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2])
  const font = (style: 'normal' | 'bold' | 'italic', size: number) => { doc.setFont('helvetica', style); doc.setFontSize(size) }

  // ── Colour band ──
  const band = () => { fill(accent); doc.rect(0, 0, PAGE_W * 0.3, 2.2, 'F'); fill(dark); doc.rect(PAGE_W * 0.3, 0, PAGE_W * 0.7, 2.2, 'F') }
  band()

  // ── Company (left) ──
  let yL = 12
  if (lh.logo) {
    const maxW = 52, maxH = 19
    const ratio = lh.logo.width / lh.logo.height
    let w = maxW, h = maxW / ratio
    if (h > maxH) { h = maxH; w = maxH * ratio }
    try { doc.addImage(lh.logo.dataUrl, L, yL, w, h); yL += h + 4 } catch { /* a broken logo is left out */ }
  } else {
    font('bold', 15); ink(dark); doc.text(lh.name, L, yL + 6); yL += 11
  }
  font('bold', 8.5); ink(SLATE_900)
  doc.text(lh.legalName || lh.name, L, yL); yL += 4
  font('normal', 7.8); ink(SLATE_500)
  const company = [
    lh.address ? lh.address.replace(/\s*\n\s*/g, ', ') : null,
    [lh.phone, lh.email, lh.website].filter(Boolean).join(' · ') || null,
    [lh.registrationNumber ? `Reg. ${lh.registrationNumber}` : null, lh.vatNumber ? `VAT ${lh.vatNumber}` : null].filter(Boolean).join(' · ') || null,
  ].filter((x): x is string => !!x)
  for (const c of company) { const t = doc.splitTextToSize(c, 92); doc.text(t, L, yL); yL += 3.6 * t.length }

  // ── Document facts (right) ──
  let yR = 16
  font('bold', 19); ink(dark)
  doc.setCharSpace(0.6)
  doc.text(isPf ? 'PRO FORMA INVOICE' : 'QUOTATION', R, yR, { align: 'right' })
  doc.setCharSpace(0)
  yR += 7
  const facts: [string, string][] = [
    ['Number', isPf ? proformaNumber(input.quote_number) : (input.quote_number ?? 'Draft')],
    ['Date', fmtDate(input.issue_date ?? localISODate())],
    isPf ? ['Due', 'On acceptance'] : ['Valid until', fmtDate(input.valid_until)],
    ['Your reference', input.reference?.trim() || input.quote_number || '—'],
  ]
  if (input.sales_rep?.trim()) facts.push(['Sales rep', input.sales_rep.trim()])
  font('normal', 8.3)
  for (const [k, v] of facts) {
    ink(SLATE_500); doc.text(k, R - 40, yR)
    ink(SLATE_900); font(k === 'Number' ? 'bold' : 'normal', 8.3); doc.text(v, R, yR, { align: 'right' }); font('normal', 8.3)
    yR += 4.4
  }

  let y = Math.max(yL, yR) + 6

  // ── Prepared for / Deliver to ──
  const contact = input.contact ?? null
  const forLines = [
    contact?.name?.trim() ? `Attn: ${contact.name.trim()}` : null,
    input.client_address?.trim() ? input.client_address.trim().replace(/\s*\n\s*/g, ', ') : null,
    [contact?.email?.trim() || input.client_email?.trim(), contact?.phone?.trim()].filter(Boolean).join(' · ') || null,
    input.client_vat?.trim() ? `VAT ${input.client_vat.trim()}` : null,
    ...(input.header_fields ?? []).filter(h => h.value?.trim()).map(h => `${h.label}: ${h.value.trim()}`),
  ].filter((x): x is string => !!x)
  const delivery = input.delivery?.trim() || null
  const boxW = delivery ? (R - L - 6) / 2 : R - L
  font('normal', 8.3)
  const forWrapped = forLines.flatMap(l => doc.splitTextToSize(l, boxW - 8) as string[])
  const delWrapped = delivery ? (doc.splitTextToSize(delivery, boxW - 8) as string[]) : []
  const boxH = 12 + 3.9 * Math.max(forWrapped.length + 1, delWrapped.length)
  const box = (x: number, label: string, title: string | null, rows: string[]) => {
    fill(PANEL); doc.roundedRect(x, y, boxW, boxH, 2, 2, 'F')
    font('bold', 6.8); ink(accentText); doc.setCharSpace(0.5); doc.text(label, x + 4, y + 5.5); doc.setCharSpace(0)
    let yy = y + 10
    if (title) { font('bold', 9); ink(SLATE_900); doc.text(title, x + 4, yy); yy += 4.2 }
    font('normal', 8.3); ink(SLATE_700)
    for (const r of rows) { doc.text(r, x + 4, yy); yy += 3.9 }
  }
  box(L, 'PREPARED FOR', input.client_name?.trim() || '—', forWrapped)
  if (delivery) box(L + boxW + 6, 'DELIVER TO', null, delWrapped)
  y += boxH + 7

  if (input.title?.trim() && input.title.trim() !== 'Untitled quote' && input.title.trim() !== 'Untitled Quote') {
    font('bold', 10.5); ink(SLATE_900); doc.text(input.title.trim(), L, y); y += 6
  }

  // ── Lines ──
  y = drawLines(doc, input, y, { accentText, accentSoft, dark })

  // ── Totals (right) with note or banking (left) ──
  const rate = input.vatRate ?? (input.subtotal > 0 ? input.vat / input.subtotal : 0)
  const vatOn = rate > 0.0001
  const bank = bankLines(lh.bank)
  const leftBlockH = isPf ? 10 + 4.2 * Math.max(3, bank.length + 1) : 0
  if (y + Math.max(40, leftBlockH) > BOTTOM) { doc.addPage(); band(); y = 16 }
  y += 4
  const tx = R - 72
  let ty = y
  const trow = (label: string, value: string) => {
    font('normal', 8.6); ink(SLATE_500); doc.text(label, tx, ty); ink(SLATE_900); doc.text(value, R, ty, { align: 'right' }); ty += 5
  }
  trow(vatOn ? 'Subtotal (excl. VAT)' : 'Subtotal', money(input.subtotal, cur))
  if (vatOn) trow(`VAT ${vatPercentLabel(rate)}%`, money(input.vat, cur))
  fill(dark); doc.roundedRect(tx - 3, ty - 3.6, R - tx + 3, 9, 1.5, 1.5, 'F')
  font('bold', 11.5); doc.setTextColor(255, 255, 255)
  doc.text(vatOn ? 'Total (incl. VAT)' : 'Total', tx, ty + 2.2); doc.text(money(input.total, cur), R - 2, ty + 2.2, { align: 'right' })
  ty += 10.5
  if (input.deposit && input.deposit.amount > 0) {
    fill(accentSoft); doc.roundedRect(tx - 3, ty - 3.6, R - tx + 3, 7.5, 1.5, 1.5, 'F')
    font('bold', 8.8); ink(accentText)
    doc.text(isPf ? `Amount due now (${input.deposit.pct}% deposit)` : `Deposit to accept (${input.deposit.pct}%)`, tx, ty + 1.3)
    doc.text(money(input.deposit.amount, cur), R - 2, ty + 1.3, { align: 'right' })
    ty += 9
  } else if (isPf) {
    fill(accentSoft); doc.roundedRect(tx - 3, ty - 3.6, R - tx + 3, 7.5, 1.5, 1.5, 'F')
    font('bold', 8.8); ink(accentText); doc.text('Amount due now', tx, ty + 1.3); doc.text(money(input.total, cur), R - 2, ty + 1.3, { align: 'right' })
    ty += 9
  }
  for (const r of input.recurring ?? []) trow(`Then every ${r.period} (excl. VAT)`, money(r.amount, cur))

  // left of the totals
  const lw = tx - L - 10
  let ly = y
  if (isPf) {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.roundedRect(L, ly - 4, lw, leftBlockH, 2, 2, 'S')
    font('bold', 6.8); ink(accentText); doc.setCharSpace(0.5); doc.text('PAY INTO', L + 4, ly + 1.5); doc.setCharSpace(0)
    ly += 6.5
    const rows: [string, string][] = bank.length ? bank : [['Banking details', 'Add them in Settings › Company']]
    rows.push(['Reference', proformaNumber(input.quote_number)])
    for (const [k, v] of rows) {
      font('normal', 8.3); ink(SLATE_500); doc.text(k, L + 4, ly)
      font(k === 'Reference' ? 'bold' : 'normal', 8.3); ink(SLATE_900); doc.text(v, L + 34, ly); ly += 4.2
    }
    ly = y - 4 + leftBlockH
  } else if (input.notes?.trim()) {
    font('bold', 8.3); ink(SLATE_900); doc.text('Note', L, ly); ly += 4
    font('normal', 8.3); ink(SLATE_700)
    const t = doc.splitTextToSize(input.notes.trim(), lw) as string[]
    doc.text(t, L, ly); ly += 3.9 * t.length
  }
  y = Math.max(ty, ly) + 6

  // ── Terms + sign-off / pro forma note ──
  const terms = [input.terms?.trim(), input.rate_note?.trim()].filter(Boolean).join(' ')
  font('normal', 7.8)
  const termLines = terms ? (doc.splitTextToSize(terms, 108) as string[]) : []
  const blockH = Math.max(26, 8 + termLines.length * 3.6)
  if (y + blockH > BOTTOM) { doc.addPage(); band(); y = 16 }
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.line(L, y, R, y)
  y += 6
  if (termLines.length) {
    font('bold', 6.8); ink(SLATE_900); doc.setCharSpace(0.5); doc.text('TERMS', L, y); doc.setCharSpace(0)
    font('normal', 7.8); ink(SLATE_700); doc.text(termLines, L, y + 4.5)
  }
  const sx = L + 118
  if (isPf) {
    fill(PANEL); doc.roundedRect(sx, y - 3.5, R - sx, 16, 2, 2, 'F')
    font('normal', 7.8); ink(SLATE_700)
    doc.text(doc.splitTextToSize('This is a pro forma invoice, not a tax invoice. The tax invoice follows once payment is received.', R - sx - 8), sx + 4, y + 1.5)
  } else {
    font('bold', 6.8); ink(SLATE_900); doc.setCharSpace(0.5); doc.text('ACCEPTED BY', sx, y); doc.setCharSpace(0)
    const a = input.accepted
    if (a?.signature) { try { doc.addImage(a.signature, sx, y + 1.5, 38, 13) } catch { /* left out */ } }
    doc.setDrawColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]); doc.line(sx, y + 15, R, y + 15)
    font('normal', 7.4); ink(SLATE_500)
    doc.text(a ? a.name : 'Name and signature', sx, y + 18.5)
    doc.text(a?.at ? fmtDate(a.at) : 'Date', R, y + 18.5, { align: 'right' })
  }

  // ── Footer on every page ──
  const last = doc.getNumberOfPages()
  const pages = last - first + 1
  for (let pg = first; pg <= last; pg++) {
    const p = pg - first + 1
    doc.setPage(pg)
    fill(PANEL); doc.rect(0, 287, PAGE_W, 10, 'F')
    font('normal', 7); ink(SLATE_500)
    doc.text([lh.legalName || lh.name, lh.registrationNumber ? `Reg. ${lh.registrationNumber}` : null, lh.vatNumber ? `VAT ${lh.vatNumber}` : null].filter(Boolean).join(' · '), L, 292.5)
    doc.text(`Page ${p} of ${pages}`, R, 292.5, { align: 'right' })
  }
  return doc
}

/** The lines: dark header row, sections tinted with their subtotal, options under their line. Returns the new y. */
function drawLines(doc: jsPDF, input: QuotePdfInput, y0: number, c: { accentText: Rgb; accentSoft: Rgb; dark: Rgb }): number {
  let y = y0
  const cur = input.currency
  const hasDisc = input.lines.some(l => (Number(l.discount_pct) || 0) > 0)
  const cols: QuotePdfColumn[] = input.columns?.length
    ? input.columns.filter(x => x.key !== 'cost' && x.key !== 'margin')
    : [{ key: 'item', label: 'Description' }, { key: 'qty', label: 'Qty' }, { key: 'unit', label: 'Unit' }, { key: 'price', label: 'Rate' }, { key: 'total', label: 'Amount' }]
  const numW = 8
  const fixed = cols.filter(x => x.key !== 'item').reduce((s, x) => s + (COL_WIDTH[x.key] ?? 20), 0)
  const descW = Math.max(44, R - L - fixed - numW - 2)
  const xs: Record<string, number> = {}
  let x = L + numW
  for (const col of cols) { xs[col.key] = x; x += col.key === 'item' ? descW : (COL_WIDTH[col.key] ?? 20) }
  const w = (k: string) => (k === 'item' ? descW : (COL_WIDTH[k] ?? 20))
  const header = () => {
    doc.setFillColor(c.dark[0], c.dark[1], c.dark[2])
    doc.roundedRect(L, y - 4.6, R - L, 8, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2); doc.setTextColor(255, 255, 255)
    doc.text('#', L + 2.5, y)
    for (const col of cols) {
      const label = col.label.toUpperCase()
      if (NUMERIC.has(col.key)) doc.text(label, xs[col.key] + w(col.key) - 2, y, { align: 'right' })
      else doc.text(label, xs[col.key], y)
    }
    y += 7
  }
  header()
  const sections: (string | null)[] = []
  for (const l of input.lines) { const s = l.section?.trim() || null; if (!sections.includes(s)) sections.push(s) }
  const usable = input.lines.filter(l => l.description.trim() || l.total > 0)
  let n = 0
  for (const sct of sections) {
    const rows = usable.filter(l => (l.section?.trim() || null) === sct)
    if (!rows.length) continue
    if (sct) {
      if (y > BOTTOM - 12) { doc.addPage(); y = 16; header() }
      doc.setFillColor(c.accentSoft[0], c.accentSoft[1], c.accentSoft[2])
      doc.rect(L, y - 4.2, R - L, 6.6, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.6); doc.setTextColor(c.accentText[0], c.accentText[1], c.accentText[2])
      doc.text(sct, L + 2.5, y)
      const st = rows.filter(r => !r.is_option).reduce((s, r) => s + r.total, 0)
      doc.text(money(Math.round(st * 100) / 100, cur), R - 2, y, { align: 'right' })
      y += 6.4
    }
    for (const l of rows) {
      if (y > BOTTOM - 8) { doc.addPage(); y = 16; header() }
      const opt = !!l.is_option
      if (!opt) n++
      doc.setFont('helvetica', opt ? 'italic' : 'normal'); doc.setFontSize(8.4)
      doc.setTextColor(opt ? 100 : 15, opt ? 116 : 23, opt ? 139 : 42)
      doc.setTextColor(148, 163, 184)
      if (!opt) doc.text(String(n), L + 2.5, y)
      doc.setTextColor(opt ? 100 : 15, opt ? 116 : 23, opt ? 139 : 42)
      const days = Number(l.extra?.days) || 0
      const units = days ? Math.round((l.qty / days) * 100) / 100 : l.qty
      let h = 1
      for (const col of cols) {
        let text: string
        switch (col.key) {
          case 'item': text = `${opt ? 'Option: ' : ''}${l.description.trim() || '—'}${l.recurring ? ` (every ${l.recurring})` : ''}`; break
          case 'qty': text = units.toLocaleString('en-ZA'); break
          case 'days': text = days ? String(days) : ''; break
          case 'unit': text = l.unit || 'each'; break
          case 'price': case 'rate': text = money(l.unit_price, cur) + (hasDisc && Number(l.discount_pct) > 0 ? ` −${Math.round(Number(l.discount_pct) * 100) / 100}%` : ''); break
          case 'total': text = opt ? `(${money(l.total, cur)})` : money(l.total, cur); break
          default: text = l.extra?.[col.key] ?? ''
        }
        if (col.key === 'total' && !opt) doc.setFont('helvetica', 'bold')
        const lines = doc.splitTextToSize(text, w(col.key) - 2)
        if (NUMERIC.has(col.key)) doc.text(lines, xs[col.key] + w(col.key) - 2, y, { align: 'right' })
        else doc.text(lines, xs[col.key], y)
        if (col.key === 'total') doc.setFont('helvetica', opt ? 'italic' : 'normal')
        h = Math.max(h, lines.length)
      }
      const rowH = Math.max(6.2, h * 4.1 + 2)
      doc.setDrawColor(241, 245, 249); doc.line(L, y + rowH - 4.2, R, y + rowH - 4.2)
      y += rowH
    }
  }
  if (usable.some(l => l.is_option)) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.6); doc.setTextColor(100, 116, 139)
    doc.text('Options are choices instead of the line above them; they are not in the total.', L + 2.5, y)
    y += 5
  }
  return y
}

export function downloadQuotePdf(input: QuotePdfInput): void {
  const doc = buildQuotePdf(input)
  const safe = (input.quote_number || 'draft').replace(/[^\w.-]+/g, '_')
  doc.save(`Quote_${safe}.pdf`)
}

/** Raw base64 (no data: prefix) for Resend attachments. withProforma: the pro forma invoice follows the quote in the same file. */
export function quotePdfBase64(input: QuotePdfInput, opts: { withProforma?: boolean } = {}): string {
  const doc = buildQuotePdf(opts.withProforma ? { ...input, kind: 'quote' } : input)
  if (opts.withProforma) buildQuotePdf({ ...input, kind: 'proforma' }, doc)
  return doc.output('datauristring').replace(/^data:application\/pdf;base64,/, '')
}

export function openQuoteMailto(opts: {
  to: string | null | undefined
  quoteNumber: string | null
  title: string
  companyName: string
}): void {
  const to = (opts.to ?? '').trim()
  const subject = encodeURIComponent(
    `Quote ${opts.quoteNumber ?? ''} – ${opts.title || 'Quotation'}`.trim(),
  )
  const body = encodeURIComponent(
    [
      `Hello,`,
      ``,
      `Please find our quotation${opts.quoteNumber ? ` (${opts.quoteNumber})` : ''} attached / as discussed.`,
      ``,
      `Kind regards,`,
      opts.companyName || 'KaiSync',
    ].join('\n'),
  )
  const href = to
    ? `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
    : `mailto:?subject=${subject}&body=${body}`
  window.open(href, '_blank')
}

