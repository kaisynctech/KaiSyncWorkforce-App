/**
 * Salary schedule PDF in the layout payroll offices already use (a landscape spreadsheet grid):
 * Employee name · Salary · Overtime amount · Other payments · Deductions · PAYE · UIF deductions ·
 * MEIBC · Total amount paid, with a Total line. Zero amounts stay blank, as on the paper schedule.
 */

import { jsPDF } from 'jspdf'
import { cellValue, displayCell, isNumericKind, type TableSpec } from './table'
import { pdfText } from './pdf'
import type { DateRange } from './period'
import { describeRange } from './period'

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

/** "SEPTEMBER SALARY SCHEDULE 2026" for a whole month, otherwise "SALARY SCHEDULE 1 Oct – 3 Nov 2026". */
export function salaryScheduleTitle(r: DateRange): string {
  const [y, m, d] = r.from.split('-').map(Number)
  const [ty, tm, td] = r.to.split('-').map(Number)
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  if (d === 1 && y === ty && m === tm && td === last) return `${MONTHS[m - 1]} SALARY SCHEDULE ${y}`
  return `SALARY SCHEDULE ${describeRange(r)}`
}

export function buildSalarySchedulePdf(input: {
  companyName: string
  title: string
  subtitle?: string
  table: TableSpec<any> // eslint-disable-line @typescript-eslint/no-explicit-any
}): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const left = 12, right = 285, top = 14, bottom = 196
  const width = right - left
  const cols = input.table.columns
  const total = cols.reduce((a, c) => a + (c.width ?? 1), 0)
  const widths = cols.map(c => ((c.width ?? 1) / total) * width)
  const xs: number[] = []
  widths.reduce((x, w) => { xs.push(x); return x + w }, left)

  let y = top
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(0, 0, 0)
  doc.text(pdfText(input.companyName), left, y)
  doc.text(pdfText(input.title), right, y, { align: 'right' })
  y += 4.5
  if (input.subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(pdfText(input.subtitle), left, y)
  }
  y += 5

  const lineColour = () => { doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2) }

  const cellText = (text: string, i: number, rowY: number, h: number, bold: boolean, size: number, header: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(0, 0, 0)
    // Column titles sit on the left, as on the paper schedule; amounts line up on the right.
    const num = !header && isNumericKind(cols[i].kind)
    // Text that does not fit its column is made a little smaller rather than cut off.
    const t = pdfText(text)
    const room = widths[i] - 2.4
    if (doc.getTextWidth(t) > room) doc.setFontSize(size * Math.max(0.6, room / doc.getTextWidth(t)))
    const ty = rowY + h / 2 + size * 0.13
    if (num) doc.text(t, xs[i] + widths[i] - 1.2, ty, { align: 'right' })
    else doc.text(t, xs[i] + 1.2, ty)
  }

  const drawRow = (values: string[], h: number, bold: boolean, size: number, header = false) => {
    if (y + h > bottom) {
      doc.addPage()
      y = top
      drawHeader()
    }
    lineColour()
    values.forEach((v, i) => {
      doc.rect(xs[i], y, widths[i], h)
      if (v) cellText(v, i, y, h, bold, size, header)
    })
    y += h
  }

  const drawHeader = () => drawRow(cols.map(c => c.label), 8, true, 10.5, true)

  drawHeader()
  for (const r of input.table.rows) drawRow(cols.map(c => displayCell(c.kind, cellValue(c, r))), 6, false, 8.5)
  if (input.table.totals) {
    drawRow(cols.map((c, i) => (i === 0 ? 'Total' : input.table.totals![c.key] == null ? '' : displayCell(c.kind, input.table.totals![c.key]))), 7, true, 9)
  }

  const pages = doc.getNumberOfPages()
  const printed = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(110, 110, 110)
    doc.text(pdfText(`Printed ${printed} · KaiSync`), left, 204)
    doc.text(`Page ${p} of ${pages}`, right, 204, { align: 'right' })
  }
  return doc
}
