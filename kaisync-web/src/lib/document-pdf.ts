/**
 * A plain company document PDF (credit note, purchase order) on the company letterhead:
 * title + reference box, who it is for, a lines table, totals and notes. Same look as invoices and quotes.
 */

import { jsPDF } from 'jspdf'
import { drawLetterhead, finishDocument, type Letterhead } from '@/lib/letterhead'

export type DocumentPdfLine = { description: string; qty: number; unit?: string | null; unit_price: number; total: number }

export type DocumentPdfInput = {
  letterhead: Letterhead
  title: string
  meta: [string, string][]
  toLabel: string
  toName: string
  toLines?: string[]
  lines: DocumentPdfLine[]
  totals: [string, string, boolean][]
  notesHeading?: string
  notes?: string | null
  reference?: string | null
}

export function money(n: number): string {
  return `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function pdfDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d.includes('T') ? d : `${d}T12:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function buildDocumentPdf(input: DocumentPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 18
  const right = 192
  let y = drawLetterhead(doc, input.letterhead, { title: input.title, meta: input.meta })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(input.toLabel.toUpperCase(), left, y)
  y += 5
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text(input.toName.trim() || '—', left, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(51, 65, 85)
  y += 5
  for (const line of (input.toLines ?? []).filter(Boolean)) {
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
  doc.text('Unit', 122, y)
  doc.text('Price', 160, y, { align: 'right' })
  doc.text('Total', right - 1, y, { align: 'right' })
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  for (const line of input.lines.filter(l => l.description.trim() || l.total)) {
    if (y > 250) { doc.addPage(); y = 20 }
    const desc = doc.splitTextToSize(line.description.trim() || '—', 88) as string[]
    doc.text(desc, left + 1, y)
    doc.text(String(Number(line.qty) || 0), 118, y, { align: 'right' })
    doc.text((line.unit ?? '').slice(0, 10), 122, y)
    doc.text(money(line.unit_price), 160, y, { align: 'right' })
    doc.text(money(line.total), right - 1, y, { align: 'right' })
    y += Math.max(6, desc.length * 4.5)
  }

  y += 4
  doc.setDrawColor(226, 232, 240)
  doc.line(120, y, right, y)
  y += 7
  for (const [label, value, bold] of input.totals) {
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
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text(input.notesHeading ?? 'Notes', left, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(51, 65, 85)
    const noteLines = doc.splitTextToSize(input.notes.trim(), right - left) as string[]
    doc.text(noteLines, left, y)
    y += noteLines.length * 4.2
  }

  finishDocument(doc, input.letterhead, { y: y + 8, bank: false, reference: input.reference ?? null })
  return doc
}

/** Raw base64 (no data: prefix) for email attachments. */
export function pdfBase64(doc: jsPDF): string {
  return doc.output('datauristring').split(',')[1] ?? ''
}
