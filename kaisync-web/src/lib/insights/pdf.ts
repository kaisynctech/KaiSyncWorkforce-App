/**
 * Branded Insights PDF: the company letterhead, the period and filters, headline figures, simple
 * vector charts (they stay sharp when printed) and tables that carry on over pages.
 */

import { jsPDF } from 'jspdf'
import { drawLetterhead, finishDocument, PAGE, type Letterhead } from '@/lib/letterhead'
import { cellValue, displayCell, isNumericKind, type TableSpec } from './table'

export type PdfKpi = { label: string; value: string; sub?: string }

export type PdfSection =
  | { kind: 'kpis'; items: PdfKpi[] }
  | { kind: 'bars'; title: string; items: { label: string; value: number; display: string }[] }
  | { kind: 'columns'; title: string; labels: string[]; series: { name: string; color: string; values: number[] }[]; format: (n: number) => string }
  | { kind: 'table'; table: TableSpec<any> } // eslint-disable-line @typescript-eslint/no-explicit-any
  | { kind: 'note'; text: string }

export type InsightsPdfInput = {
  letterhead: Letterhead
  title: string
  /** e.g. "1–31 Oct 2026" */
  period: string
  /** e.g. ["Compared with 1–30 Sep 2026", "Site: Head Office"] */
  context?: string[]
  sections: PdfSection[]
  fileName: string
}

const INK: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [100, 116, 139]
const HAIR: [number, number, number] = [226, 232, 240]
const NAVY: [number, number, number] = [30, 58, 95]

/** The PDF fonts only know Western characters: swap the few typographic ones Intl and our labels use. */
export function pdfText(s: string): string {
  return s
    .replace(/[   ]/g, ' ')
    .replace(/−/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x00-\xff–—•…€]/g, '')
}

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function today(): string {
  return new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function buildInsightsPdf(input: InsightsPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const { left, right, bottom } = PAGE
  const width = right - left
  const lh = input.letterhead

  let y = drawLetterhead(doc, lh, {
    title: 'Report',
    meta: [['Period', pdfText(input.period)], ['Printed', today()]],
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...INK)
  doc.text(pdfText(input.title), left, y)
  y += 5.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  for (const c of input.context ?? []) {
    doc.text(pdfText(c), left, y)
    y += 4.2
  }
  y += 3

  const ensure = (h: number) => {
    if (y + h > bottom) { doc.addPage(); y = 20 }
  }

  const heading = (t: string) => {
    ensure(12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text(pdfText(t), left, y)
    y += 5
  }

  for (const s of input.sections) {
    if (s.kind === 'kpis') {
      const perRow = 4
      const gap = 2.5
      const w = (width - gap * (perRow - 1)) / perRow
      const h = 17
      s.items.forEach((k, i) => {
        const col = i % perRow
        if (col === 0 && i > 0) y += h + gap
        if (col === 0) ensure(h + 2)
        const x = left + col * (w + gap)
        doc.setFillColor(248, 250, 252)
        doc.setDrawColor(...HAIR)
        doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...MUTED)
        doc.text(pdfText(k.label), x + 3, y + 5, { maxWidth: w - 6 })
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(12)
        doc.setTextColor(...INK)
        doc.text(pdfText(k.value), x + 3, y + 11)
        if (k.sub) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.5)
          doc.setTextColor(...MUTED)
          doc.text(pdfText(k.sub), x + 3, y + 14.8, { maxWidth: w - 6 })
        }
      })
      if (s.items.length) y += h + 8
    }

    if (s.kind === 'bars') {
      const items = s.items.slice(0, 15)
      heading(s.title)
      const max = Math.max(1, ...items.map(i => Math.abs(i.value)))
      const labelW = 52, valueW = 30
      const barW = width - labelW - valueW - 4
      for (const it of items) {
        ensure(6.5)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...INK)
        const label = doc.splitTextToSize(pdfText(it.label), labelW - 2)[0] as string
        doc.text(label, left, y + 3.2)
        const bw = Math.max(0.6, (Math.abs(it.value) / max) * barW)
        doc.setFillColor(...hex('#2a78d6'))
        doc.roundedRect(left + labelW, y + 0.6, bw, 3.6, 0.8, 0.8, 'F')
        doc.setTextColor(...MUTED)
        doc.text(pdfText(it.display), right, y + 3.2, { align: 'right' })
        y += 6
      }
      y += 5
    }

    if (s.kind === 'columns') {
      const h = 46
      heading(s.title)
      ensure(h + 14)
      const n = s.labels.length
      if (n === 0) continue
      const all = s.series.flatMap(x => x.values)
      const max = Math.max(1, ...all)
      const axisW = 18
      const plotX = left + axisW, plotW = width - axisW
      const top = y, base = y + h
      // gridlines at 0, 50%, 100%
      doc.setDrawColor(...HAIR)
      doc.setLineWidth(0.2)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      for (const f of [0, 0.5, 1]) {
        const gy = base - f * h
        doc.line(plotX, gy, right, gy)
        doc.text(pdfText(s.format(max * f)), plotX - 2, gy + 1, { align: 'right' })
      }
      const slot = plotW / n
      const groupW = Math.min(slot * 0.75, 8 * s.series.length)
      const bw = groupW / s.series.length
      s.labels.forEach((lab, i) => {
        const gx = plotX + i * slot + (slot - groupW) / 2
        s.series.forEach((ser, si) => {
          const v = Math.max(0, ser.values[i] ?? 0)
          const bh = (v / max) * h
          if (bh <= 0) return
          doc.setFillColor(...hex(ser.color))
          doc.rect(gx + si * bw + 0.2, base - bh, Math.max(0.4, bw - 0.4), bh, 'F')
        })
        // label every point when they fit, otherwise every few
        const every = Math.ceil(n / 14)
        if (i % every === 0) {
          doc.setTextColor(...MUTED)
          doc.text(pdfText(lab), plotX + i * slot + slot / 2, base + 3.8, { align: 'center' })
        }
      })
      y = base + 7
      // legend
      let lx = plotX
      s.series.forEach(ser => {
        doc.setFillColor(...hex(ser.color))
        doc.rect(lx, y - 2.2, 2.6, 2.6, 'F')
        doc.setTextColor(...INK)
        doc.setFontSize(7)
        doc.text(pdfText(ser.name), lx + 4, y)
        lx += 6 + doc.getTextWidth(pdfText(ser.name)) + 4
      })
      y += 7
      void top
    }

    if (s.kind === 'note') {
      ensure(8)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      const lines = doc.splitTextToSize(pdfText(s.text), width) as string[]
      doc.text(lines, left, y)
      y += lines.length * 3.6 + 3
    }

    if (s.kind === 'table') {
      const t = s.table
      heading(t.title)
      const cols = t.columns
      const many = cols.length > 8
      const fs = many ? 6.6 : 7.6
      const lineH = many ? 2.9 : 3.3
      const totalW = cols.reduce((a, c) => a + (c.width ?? 1), 0)
      const widths = cols.map(c => ((c.width ?? 1) / totalW) * width)
      const xs: number[] = []
      widths.reduce((x, w) => { xs.push(x); return x + w }, left)

      const drawHeader = () => {
        doc.setFillColor(241, 245, 249)
        doc.rect(left, y, width, 6, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(fs)
        doc.setTextColor(...MUTED)
        cols.forEach((c, i) => {
          const num = isNumericKind(c.kind)
          const label = doc.splitTextToSize(pdfText(c.label), widths[i] - 2)[0] as string
          doc.text(label, num ? xs[i] + widths[i] - 1 : xs[i] + 1, y + 4, { align: num ? 'right' : 'left' })
        })
        y += 6
      }

      const drawRow = (values: string[], bold: boolean, shade: boolean) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal')
        doc.setFontSize(fs)
        const wrapped = values.map((v, i) => doc.splitTextToSize(pdfText(v), widths[i] - 2) as string[])
        const linesN = Math.min(3, Math.max(1, ...wrapped.map(w => w.length)))
        const h = linesN * lineH + 2.2
        if (y + h > bottom) { doc.addPage(); y = 20; drawHeader() }
        if (shade) { doc.setFillColor(250, 251, 253); doc.rect(left, y, width, h, 'F') }
        doc.setTextColor(...INK)
        doc.setFont('helvetica', bold ? 'bold' : 'normal')
        doc.setFontSize(fs)
        wrapped.forEach((w, i) => {
          const num = isNumericKind(cols[i].kind)
          doc.text(w.slice(0, 3), num ? xs[i] + widths[i] - 1 : xs[i] + 1, y + lineH, { align: num ? 'right' : 'left' })
        })
        y += h
        doc.setDrawColor(...HAIR)
        doc.line(left, y, right, y)
      }

      ensure(14)
      drawHeader()
      if (t.rows.length === 0) {
        drawRow(cols.map((_, i) => (i === 0 ? 'Nothing for this period' : '')), false, false)
      }
      t.rows.forEach((r, ri) => drawRow(cols.map(c => displayCell(c.kind, cellValue(c, r))), false, ri % 2 === 1))
      if (t.totals) {
        drawRow(cols.map((c, i) => (i === 0 && t.totals![c.key] == null ? 'Total' : t.totals![c.key] == null ? '' : displayCell(c.kind, t.totals![c.key]))), true, false)
      }
      if (t.note) {
        y += 2
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(7)
        doc.setTextColor(...MUTED)
        doc.text(pdfText(t.note), left, y + 2, { maxWidth: width })
        y += 5
      }
      y += 6
    }
  }

  // Bottom note on where the numbers come from.
  ensure(8)
  doc.setDrawColor(...NAVY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text('Generated by KaiSync Insights from the live records at the time of printing.', left, y + 2)

  finishDocument(doc, lh, { y: y + 6, bank: false })
  return doc
}

export function downloadInsightsPdf(input: InsightsPdfInput): void {
  buildInsightsPdf(input).save(input.fileName.replace(/[^\w.-]+/g, '_'))
}
