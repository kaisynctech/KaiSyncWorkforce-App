/**
 * Client-side Money quote PDF — same jsPDF pattern as payslips.
 */

import { jsPDF } from 'jspdf'
import { formatCurrency } from '@/lib/currencies'
import { localISODate } from '@/lib/utils'
import { drawLetterhead, finishDocument, letterheadFromRow, showsBank, type Letterhead } from '@/lib/letterhead'
import { vatPercentLabel } from '@/lib/quote-vat'

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

export function buildQuotePdf(input: QuotePdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 18
  const right = 192
  const lh = input.letterhead ?? letterheadFromRow({ name: input.company_name }, input.company_name)
  let y = drawLetterhead(doc, lh, {
    title: 'Quotation',
    meta: [
      ['Quote no.', input.quote_number ?? 'Draft'],
      ['Date', fmtDate(localISODate())],
      ['Valid until', fmtDate(input.valid_until)],
    ],
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text(input.title || 'Untitled quote', left, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  doc.text(`Client: ${input.client_name?.trim() || '—'}`, left, y)
  y += 5
  if (input.client_email?.trim()) {
    doc.text(`Email: ${input.client_email.trim()}`, left, y)
    y += 5
  }
  for (const h of (input.header_fields ?? []).filter(x => x.value?.trim())) {
    const t = doc.splitTextToSize(`${h.label}: ${h.value.trim()}`, right - left)
    doc.text(t, left, y)
    y += 5 * t.length
  }
  y += 5

  if (input.columns?.length) {
    y = drawTemplateTable(doc, input, y, left, right)
  } else {

  // Table header
  doc.setFillColor(241, 245, 249)
  doc.rect(left, y - 4, right - left, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  const hasDisc = input.lines.some(l => (Number(l.discount_pct) || 0) > 0)
  // With a discount column the other columns move left to make room.
  const col = hasDisc ? { qty: 108, unit: 112, price: 146, disc: 163, desc: 78 } : { qty: 118, unit: 132, price: 158, disc: 0, desc: 90 }
  doc.text('Description', left + 1, y)
  doc.text('Qty', col.qty, y, { align: 'right' })
  doc.text('Unit', col.unit, y)
  doc.text('Price', col.price, y, { align: 'right' })
  if (hasDisc) doc.text('Disc.', col.disc, y, { align: 'right' })
  doc.text('Total', right - 1, y, { align: 'right' })
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)

  const usable = input.lines.filter(l => l.description.trim() || l.total > 0)
  for (const line of usable) {
    if (y > 260) {
      doc.addPage()
      y = 20
    }
    const desc = doc.splitTextToSize(line.description.trim() || '—', col.desc)
    doc.text(desc, left + 1, y)
    doc.text(String(line.qty), col.qty, y, { align: 'right' })
    doc.text(line.unit || 'each', col.unit, y)
    doc.text(money(line.unit_price, input.currency), col.price, y, { align: 'right' })
    const d = Number(line.discount_pct) || 0
    if (hasDisc) doc.text(d > 0 ? `${Math.round(d * 100) / 100}%` : '', col.disc, y, { align: 'right' })
    doc.text(money(line.total, input.currency), right - 1, y, { align: 'right' })
    y += Math.max(6, desc.length * 4.5)
  }
  }

  y += 4
  doc.setDrawColor(226, 232, 240)
  doc.line(120, y, right, y)
  y += 7

  const rate = input.vatRate ?? (input.subtotal > 0 ? input.vat / input.subtotal : 0)
  const vatOn = rate > 0.0001
  const vatLabel = vatOn ? `VAT (${vatPercentLabel(rate)}%)` : 'VAT'
  const totals = [
    [vatOn ? 'Subtotal (excl. VAT)' : 'Subtotal', money(input.subtotal, input.currency)],
    [vatLabel, vatOn ? money(input.vat, input.currency) : 'No VAT'],
    [vatOn ? 'Total (incl. VAT)' : 'Total', money(input.total, input.currency)],
  ] as const

  for (let i = 0; i < totals.length; i++) {
    const [label, value] = totals[i]
    const bold = i === totals.length - 1
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 11 : 9)
    doc.setTextColor(bold ? 15 : 100, bold ? 23 : 116, bold ? 42 : 139)
    doc.text(label, 120, y)
    doc.setTextColor(15, 23, 42)
    doc.text(value, right - 1, y, { align: 'right' })
    y += bold ? 7 : 6
  }
  const extras: [string, string][] = []
  if (input.deposit && input.deposit.amount > 0) extras.push([`Deposit to accept (${input.deposit.pct}%)`, money(input.deposit.amount, input.currency)])
  for (const r of input.recurring ?? []) extras.push([`Then every ${r.period} (excl. VAT)`, money(r.amount, input.currency)])
  for (const [label, value] of extras) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(15, 23, 42)
    doc.text(label, 120, y)
    doc.text(value, right - 1, y, { align: 'right' })
    y += 6
  }

  if (input.notes?.trim()) {
    y += 6
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('Notes', left, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(51, 65, 85)
    const noteLines = doc.splitTextToSize(input.notes.trim(), right - left)
    doc.text(noteLines, left, y)
    y += noteLines.length * 4.2
  }

  if (input.terms?.trim()) {
    y += 6
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('Terms', left, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(51, 65, 85)
    const termLines = doc.splitTextToSize(input.terms.trim(), right - left)
    doc.text(termLines, left, y)
    y += termLines.length * 4.2
  }

  finishDocument(doc, lh, { y: y + 8, bank: showsBank(lh, 'quote'), reference: input.quote_number })
  return doc
}

export function downloadQuotePdf(input: QuotePdfInput): void {
  const doc = buildQuotePdf(input)
  const safe = (input.quote_number || 'draft').replace(/[^\w.-]+/g, '_')
  doc.save(`Quote_${safe}.pdf`)
}

/** Raw base64 (no data: prefix) for Resend attachments. */
export function quotePdfBase64(input: QuotePdfInput): string {
  const doc = buildQuotePdf(input)
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

const COL_WIDTH: Record<string, number> = { qty: 12, days: 11, unit: 14, price: 24, rate: 24, total: 26, part_no: 24, brand: 20, condition: 22, warranty: 18 }
const NUMERIC = new Set(['qty', 'days', 'price', 'rate', 'total'])

/** The lines in the template's columns, by section, with options under their line. Returns the new y. */
function drawTemplateTable(doc: jsPDF, input: QuotePdfInput, y0: number, left: number, right: number): number {
  let y = y0
  const cols = (input.columns ?? []).filter(c => c.key !== 'cost' && c.key !== 'margin')
  const fixed = cols.filter(c => c.key !== 'item').reduce((s, c) => s + (COL_WIDTH[c.key] ?? 20), 0)
  const descW = Math.max(40, right - left - fixed - 2)
  // x position (left edge) of each column
  const xs: Record<string, number> = {}
  let x = left + 1
  for (const c of cols) { xs[c.key] = x; x += c.key === 'item' ? descW : (COL_WIDTH[c.key] ?? 20) }
  const w = (k: string) => (k === 'item' ? descW : (COL_WIDTH[k] ?? 20))
  const header = () => {
    doc.setFillColor(241, 245, 249)
    doc.rect(left, y - 4, right - left, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    for (const c of cols) {
      if (NUMERIC.has(c.key)) doc.text(c.label, xs[c.key] + w(c.key) - 2, y, { align: 'right' })
      else doc.text(c.label, xs[c.key], y)
    }
    y += 7
  }
  header()
  const sections: (string | null)[] = []
  for (const l of input.lines) { const sct = l.section?.trim() || null; if (!sections.includes(sct)) sections.push(sct) }
  const usable = input.lines.filter(l => l.description.trim() || l.total > 0)
  for (const sct of sections) {
    const rows = usable.filter(l => (l.section?.trim() || null) === sct)
    if (!rows.length) continue
    if (sct) {
      if (y > 255) { doc.addPage(); y = 20; header() }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(15, 23, 42)
      doc.text(sct, left + 1, y)
      const st = rows.filter(r => !r.is_option).reduce((s, r) => s + r.total, 0)
      doc.text(money(Math.round(st * 100) / 100, input.currency), right - 1, y, { align: 'right' })
      y += 6
    }
    for (const l of rows) {
      if (y > 262) { doc.addPage(); y = 20; header() }
      doc.setFont('helvetica', l.is_option ? 'italic' : 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(l.is_option ? 71 : 15, l.is_option ? 85 : 23, l.is_option ? 105 : 42)
      const days = Number(l.extra?.days) || 0
      const units = days ? Math.round((l.qty / days) * 100) / 100 : l.qty
      let h = 1
      for (const c of cols) {
        let text: string
        switch (c.key) {
          case 'item': text = `${l.is_option ? 'Option: ' : ''}${l.description.trim() || '—'}${l.recurring ? ` (every ${l.recurring})` : ''}`; break
          case 'qty': text = String(units); break
          case 'days': text = days ? String(days) : ''; break
          case 'unit': text = l.unit || 'each'; break
          case 'price': case 'rate': text = money(l.unit_price, input.currency) + (Number(l.discount_pct) > 0 ? ` -${Math.round(Number(l.discount_pct) * 100) / 100}%` : ''); break
          case 'total': text = l.is_option ? `(${money(l.total, input.currency)})` : money(l.total, input.currency); break
          default: text = l.extra?.[c.key] ?? ''
        }
        const lines = doc.splitTextToSize(text, w(c.key) - 2)
        if (NUMERIC.has(c.key)) doc.text(lines, xs[c.key] + w(c.key) - 2, y, { align: 'right' })
        else doc.text(lines, xs[c.key], y)
        h = Math.max(h, lines.length)
      }
      y += Math.max(6, h * 4.2)
    }
  }
  if (usable.some(l => l.is_option)) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('Options are choices instead of the line above them; they are not in the total.', left + 1, y)
    y += 5
  }
  return y
}
