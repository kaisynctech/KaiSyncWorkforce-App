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
  /** Registered name, when it differs from the trading name. */
  client_legal_name?: string | null
  /** Billing (or physical) address — required on a full tax invoice (over R5,000). */
  client_address?: string | null
  client_vat_number?: string | null
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

/** VAT appears only when the company is VAT-registered and this invoice actually charges VAT. */
export function invoiceShowsVat(lh: Pick<Letterhead, 'vatRegistered'>, vat: number): boolean {
  return lh.vatRegistered && Math.abs(vat) > 0.004
}

/** The client lines under "Bill to": registered name, address, VAT number (tax invoices only), email. */
export function billToLines(
  input: Pick<InvoicePdfInput, 'client_name' | 'client_legal_name' | 'client_address' | 'client_vat_number' | 'client_email'>,
  vatShown: boolean,
): string[] {
  const out: string[] = []
  const name = input.client_name?.trim().toLowerCase()
  const legal = input.client_legal_name?.trim()
  if (legal && legal.toLowerCase() !== name) out.push(legal)
  const address = input.client_address?.trim()
  if (address) out.push(...address.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 5))
  if (vatShown && input.client_vat_number?.trim()) out.push(`VAT no. ${input.client_vat_number.trim()}`)
  if (input.client_email?.trim()) out.push(input.client_email.trim())
  return out
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
  // South African rules: only a VAT-registered supplier charging VAT issues a "Tax invoice"; anyone else
  // issues a plain "Invoice" that does not mention VAT at all.
  const vatShown = invoiceShowsVat(lh, input.vat)
  let y = drawLetterhead(doc, lh, {
    title: vatShown ? 'Tax invoice' : 'Invoice',
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
  for (const line of billToLines(input, vatShown)) {
    const wrapped = doc.splitTextToSize(line, 100) as string[]
    doc.text(wrapped, left, y)
    y += wrapped.length * 4.6
  }
  y += 5

  doc.setFillColor(241, 245, 249)
  doc.rect(left, y - 4, right - left, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('Description', left + 1, y)
  doc.text('Qty', 118, y, { align: 'right' })
  doc.text(vatShown ? 'Price excl. VAT' : 'Price', 145, y, { align: 'right' })
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

  const rate = input.subtotal > 0 ? input.vat / input.subtotal : 0
  const totals: [string, string, boolean][] = vatShown
    ? [
        ['Total excl. VAT', money(input.subtotal), false],
        [`VAT (${Math.round(rate * 1000) / 10}%)`, money(input.vat), false],
        ['Total incl. VAT', money(input.total), true],
      ]
    : [['Total', money(input.total), true]]
  totals.push(['Paid', money(input.amount_paid), false], ['Balance due', money(input.balance_due), true])

  for (let i = 0; i < totals.length; i++) {
    const [label, value, bold] = totals[i]
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
