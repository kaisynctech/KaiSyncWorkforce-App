/**
 * Client-side Money quote PDF — same jsPDF pattern as payslips.
 */

import { jsPDF } from 'jspdf'

export type QuotePdfLine = {
  description: string
  qty: number
  unit: string
  unit_price: number
  total: number
}

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

export function buildQuotePdf(input: QuotePdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 18
  const right = 192
  let y = 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(input.company_name || 'Quote', left, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(100, 116, 139)
  doc.text(input.quote_number ? `Quote ${input.quote_number}` : 'Draft quote', left, y)
  doc.text(fmtDate(new Date().toISOString().slice(0, 10)), right, y, { align: 'right' })
  y += 10

  doc.setDrawColor(226, 232, 240)
  doc.line(left, y, right, y)
  y += 8

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
  doc.text(`Valid until: ${fmtDate(input.valid_until)}`, left, y)
  y += 5
  doc.text(`Status: ${input.status.replace(/_/g, ' ')}`, left, y)
  y += 10

  // Table header
  doc.setFillColor(241, 245, 249)
  doc.rect(left, y - 4, right - left, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('Description', left + 1, y)
  doc.text('Qty', 118, y, { align: 'right' })
  doc.text('Unit', 132, y)
  doc.text('Price', 158, y, { align: 'right' })
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
    const desc = doc.splitTextToSize(line.description.trim() || '—', 90)
    doc.text(desc, left + 1, y)
    doc.text(String(line.qty), 118, y, { align: 'right' })
    doc.text(line.unit || 'each', 132, y)
    doc.text(money(line.unit_price), 158, y, { align: 'right' })
    doc.text(money(line.total), right - 1, y, { align: 'right' })
    y += Math.max(6, desc.length * 4.5)
  }

  y += 4
  doc.setDrawColor(226, 232, 240)
  doc.line(120, y, right, y)
  y += 7

  const totals = [
    ['Subtotal (excl. VAT)', money(input.subtotal)],
    ['VAT (15%)', money(input.vat)],
    ['Total (incl. VAT)', money(input.total)],
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
  }

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
