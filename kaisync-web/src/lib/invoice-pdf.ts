/**
 * Client-side Money invoice PDF + mailto — same jsPDF pattern as quotes.
 */

import { jsPDF } from 'jspdf'
import { drawLetterhead, finishDocument, letterheadFromRow, showsBank, type Letterhead } from '@/lib/letterhead'

export type InvoicePdfLine = {
  description: string
  qty: number
  unit_price: number
  vat_amount: number
  total: number
}

export type InvoicePdfInput = {
  invoice_number: string | null
  status: string
  issue_date: string | null
  due_date: string | null
  notes: string | null
  client_name: string | null
  client_email: string | null
  company_name: string
  lines: InvoicePdfLine[]
  subtotal: number
  vat: number
  total: number
  amount_paid: number
  balance_due: number
  /** Company letterhead (logo, details, banking). Falls back to the company name only. */
  letterhead?: Letterhead | null
}

function money(n: number): string {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d.includes('T') ? d : `${d}T12:00:00`).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function buildInvoicePdf(input: InvoicePdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 18
  const right = 192
  const lh = input.letterhead ?? letterheadFromRow({ name: input.company_name }, input.company_name)
  let y = drawLetterhead(doc, lh, {
    title: lh.vatNumber ? 'Tax invoice' : 'Invoice',
    meta: [
      ['Invoice no.', input.invoice_number ?? 'Draft'],
      ['Date', fmtDate(input.issue_date)],
      ['Due', fmtDate(input.due_date)],
    ],
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('BILL TO', left, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(input.client_name?.trim() || '—', left, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(51, 65, 85)
  y += 5
  if (input.client_email?.trim()) {
    doc.text(input.client_email.trim(), left, y)
    y += 5
  }
  y += 5

  doc.setFillColor(241, 245, 249)
  doc.rect(left, y - 4, right - left, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('Description', left + 1, y)
  doc.text('Qty', 118, y, { align: 'right' })
  doc.text('Price', 145, y, { align: 'right' })
  doc.text('Total', right - 1, y, { align: 'right' })
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)

  for (const line of input.lines.filter(l => l.description.trim() || l.total > 0)) {
    if (y > 250) {
      doc.addPage()
      y = 20
    }
    const desc = doc.splitTextToSize(line.description.trim() || '—', 90)
    doc.text(desc, left + 1, y)
    doc.text(String(line.qty), 118, y, { align: 'right' })
    doc.text(money(line.unit_price), 145, y, { align: 'right' })
    doc.text(money(line.total), right - 1, y, { align: 'right' })
    y += Math.max(6, desc.length * 4.5)
  }

  y += 4
  doc.setDrawColor(226, 232, 240)
  doc.line(120, y, right, y)
  y += 7

  const totals = [
    ['Subtotal', money(input.subtotal)],
    ['VAT', money(input.vat)],
    ['Total', money(input.total)],
    ['Paid', money(input.amount_paid)],
    ['Balance due', money(input.balance_due)],
  ] as const

  for (let i = 0; i < totals.length; i++) {
    const [label, value] = totals[i]
    const bold = i === 2 || i === totals.length - 1
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 10 : 9)
    doc.setTextColor(bold ? 15 : 100, bold ? 23 : 116, bold ? 42 : 139)
    doc.text(label, 120, y)
    doc.setTextColor(15, 23, 42)
    doc.text(value, right - 1, y, { align: 'right' })
    y += bold ? 7 : 6
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
    const noteLines = doc.splitTextToSize(input.notes.trim(), right - left) as string[]
    doc.text(noteLines, left, y)
    y += noteLines.length * 4.2
  }

  finishDocument(doc, lh, { y: y + 8, bank: showsBank(lh, 'invoice'), reference: input.invoice_number })
  return doc
}

export function downloadInvoicePdf(input: InvoicePdfInput): void {
  const doc = buildInvoicePdf(input)
  const safe = (input.invoice_number || 'draft').replace(/[^\w.-]+/g, '_')
  doc.save(`Invoice_${safe}.pdf`)
}

export function openInvoiceMailto(opts: {
  to: string | null | undefined
  invoiceNumber: string | null
  companyName: string
}): void {
  const to = (opts.to ?? '').trim()
  const subject = encodeURIComponent(
    `Invoice ${opts.invoiceNumber ?? ''}`.trim() || 'Invoice',
  )
  const body = encodeURIComponent(
    [
      'Hello,',
      '',
      `Please find our invoice${opts.invoiceNumber ? ` (${opts.invoiceNumber})` : ''} attached / as discussed.`,
      '',
      'Kind regards,',
      opts.companyName || 'KaiSync',
    ].join('\n'),
  )
  const href = to
    ? `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
    : `mailto:?subject=${subject}&body=${body}`
  window.open(href, '_blank')
}
