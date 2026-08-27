/**
 * Client-side Money invoice PDF + mailto — same jsPDF pattern as quotes.
 */

import { jsPDF } from 'jspdf'

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
  let y = 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(input.company_name || 'Invoice', left, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(100, 116, 139)
  doc.text(input.invoice_number ? `Invoice ${input.invoice_number}` : 'Draft invoice', left, y)
  doc.text(fmtDate(input.issue_date), right, y, { align: 'right' })
  y += 10

  doc.setDrawColor(226, 232, 240)
  doc.line(left, y, right, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  doc.text(`Client: ${input.client_name?.trim() || '—'}`, left, y)
  y += 5
  if (input.client_email?.trim()) {
    doc.text(`Email: ${input.client_email.trim()}`, left, y)
    y += 5
  }
  doc.text(`Due: ${fmtDate(input.due_date)}`, left, y)
  y += 5
  doc.text(`Status: ${input.status.replace(/_/g, ' ')}`, left, y)
  y += 10

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
    doc.text(doc.splitTextToSize(input.notes.trim(), right - left), left, y)
  }

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
