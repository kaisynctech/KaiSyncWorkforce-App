/**
 * Statement PDF on the company letterhead — used by the client portal (statement of account)
 * and the contractor portal (payments statement).
 */

import { jsPDF } from 'jspdf'
import { drawLetterhead, finishDocument, showsBank, type Letterhead } from '@/lib/letterhead'

export type StatementPdfColumn = { label: string; width: number; align?: 'left' | 'right' }

export type StatementPdfInput = {
  letterhead: Letterhead
  /** e.g. "Statement of account" */
  title: string
  /** Who the statement is for. */
  toName: string
  toCode?: string | null
  /** Summary figures shown above the table. */
  summary: [string, string][]
  /** Highlighted closing line, e.g. ["Balance owing", "R 1 200.00"]. */
  closing: [string, string]
  columns: StatementPdfColumn[]
  rows: string[][]
  /** Show the company's banking details (client statements, when switched on for invoices). */
  bank: boolean
  fileName: string
}

function today(): string {
  return new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function buildStatementPdf(input: StatementPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const left = 18, right = 192
  const lh = input.letterhead
  let y = drawLetterhead(doc, lh, {
    title: 'Statement',
    meta: [['Date', today()], ...(input.toCode ? [['Account', input.toCode] as [string, string]] : [])],
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(input.title.toUpperCase(), left, y)
  y += 5
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(input.toName || '—', left, y)
  y += 8

  // Summary row
  const n = Math.max(1, input.summary.length)
  const cellW = (right - left) / n
  input.summary.forEach(([label, value], i) => {
    const x = left + i * cellW
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x + (i ? 1 : 0), y, cellW - 1, 13, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    doc.text(label, x + 3, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text(value, x + 3, y + 10.5)
  })
  y += 23

  // Table
  const xs: number[] = []
  let cx = left
  for (const c of input.columns) { xs.push(cx); cx += c.width }
  const header = () => {
    doc.setFillColor(241, 245, 249)
    doc.rect(left, y - 4, right - left, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(100, 116, 139)
    input.columns.forEach((c, i) => {
      const x = c.align === 'right' ? xs[i] + c.width - 1 : xs[i] + 1
      doc.text(c.label, x, y, { align: c.align === 'right' ? 'right' : 'left' })
    })
    y += 6
  }
  header()
  doc.setFontSize(8.5)
  for (const row of input.rows) {
    const wrapped = input.columns.map((c, i) => doc.splitTextToSize(row[i] ?? '', c.width - 2) as string[])
    const h = Math.max(5.5, Math.max(...wrapped.map(w => w.length)) * 4)
    if (y + h > 262) { doc.addPage(); y = 20; header(); doc.setFontSize(8.5) }
    input.columns.forEach((c, i) => {
      doc.setFont('helvetica', i === input.columns.length - 1 ? 'bold' : 'normal')
      doc.setTextColor(15, 23, 42)
      const x = c.align === 'right' ? xs[i] + c.width - 1 : xs[i] + 1
      doc.text(wrapped[i], x, y, { align: c.align === 'right' ? 'right' : 'left' })
    })
    y += h
    doc.setDrawColor(241, 245, 249)
    doc.line(left, y - 3.5, right, y - 3.5)
  }
  if (input.rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text('No transactions yet.', left + 1, y)
    y += 6
  }

  y += 3
  if (y > 255) { doc.addPage(); y = 20 }
  doc.setDrawColor(30, 58, 95)
  doc.line(120, y, right, y)
  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(input.closing[0], 120, y)
  doc.text(input.closing[1], right - 1, y, { align: 'right' })
  y += 6

  finishDocument(doc, lh, { y: y + 6, bank: input.bank && showsBank(lh, 'statement'), reference: input.toCode ?? null })
  return doc
}

export function downloadStatementPdf(input: StatementPdfInput): void {
  buildStatementPdf(input).save(input.fileName.replace(/[^\w.-]+/g, '_'))
}
