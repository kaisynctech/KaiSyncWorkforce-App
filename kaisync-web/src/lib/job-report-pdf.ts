/**
 * The Job report PDF (office "Download PDF" at any time, and the signed copy): letterhead, the job, visits with time
 * per person, work done, checklist, parts, the chosen photos, still to do, and both signatures with date and time.
 * Never prices or costs.
 */

import { jsPDF } from 'jspdf'
import { drawLetterhead, finishDocument, PAGE, type Letterhead } from '@/lib/letterhead'
import { fmtClock, fmtDay, fmtMinutes, type JobReportContent } from '@/lib/job-report'

export type PdfImage = { dataUrl: string; width: number; height: number }
export type JobReportPdfInput = {
  letterhead: Letterhead
  content: JobReportContent
  /** 'draft' prints "Not signed yet". */
  status: 'draft' | 'awaiting_client' | 'signed' | 'not_happy'
  version?: number
  photos?: PdfImage[]
  technician?: { name: string | null; signature: string | null; at: string | null }
  client?: { name: string | null; signature: string | null; at: string | null; comment: string | null }
}

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' }) : ''

export function buildJobReportPdf(v: JobReportPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const { left, right } = PAGE
  const c = v.content
  let y = drawLetterhead(doc, v.letterhead, {
    title: 'Job report',
    meta: [
      ['Job', c.job.code ?? '—'],
      ...(v.version && v.version > 1 ? [['Version', String(v.version)] as [string, string]] : []),
      ['Status', v.status === 'signed' ? 'Signed' : v.status === 'not_happy' ? 'Client not happy' : 'Not signed yet'],
    ],
  })
  const need = (h: number) => { if (y + h > 272) { doc.addPage(); y = 20 } }
  const heading = (t: string) => {
    need(12)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(15, 23, 42)
    doc.text(t, left, y); y += 5.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(51, 65, 85)
  }
  const para = (t: string, indent = 0) => {
    const lines = doc.splitTextToSize(t, right - left - indent)
    for (const ln of lines) { need(5); doc.text(ln, left + indent, y); y += 4.4 }
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42)
  doc.text(c.job.title || 'Job', left, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(51, 65, 85)
  for (const l of [c.job.client && `Client: ${c.job.client}`, c.job.address && `Address: ${c.job.address}`, c.job.service && `Service: ${c.job.service}`].filter(Boolean) as string[]) para(l)
  y += 3

  if (c.visits.length) {
    heading('Visits and time on site')
    const cols = { date: left, who: left + 30, in: left + 92, out: left + 112, time: right - 1 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100, 116, 139)
    doc.text('Date', cols.date, y); doc.text('Who', cols.who, y); doc.text('Arrived', cols.in, y); doc.text('Left', cols.out, y); doc.text('Time', cols.time, y, { align: 'right' })
    y += 4.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(15, 23, 42)
    for (const d of c.visits) {
      for (const p of d.people) {
        need(5)
        doc.text(fmtDay(d.date), cols.date, y); doc.text(doc.splitTextToSize(p.name, 58)[0], cols.who, y)
        doc.text(fmtClock(p.arrived), cols.in, y); doc.text(fmtClock(p.left), cols.out, y)
        doc.text(fmtMinutes(p.minutes), cols.time, y, { align: 'right' }); y += 4.6
      }
    }
    doc.setDrawColor(226, 232, 240); doc.line(left, y - 2.5, right, y - 2.5)
    doc.setFont('helvetica', 'bold'); doc.text('Total', cols.date, y + 1); doc.text(fmtMinutes(c.total_minutes), cols.time, y + 1, { align: 'right' })
    y += 7
  }

  if (c.work.length) {
    heading('Work done')
    for (const w of c.work) para(`${fmtDay(w.date)}${w.author ? ` · ${w.author}` : ''}: ${w.text}`)
    y += 2
  }
  if (c.checklist.length) {
    heading('Checklist')
    for (const it of c.checklist) para(`${it.done ? '[x]' : '[ ]'}  ${it.text}${it.done ? '' : ' (to do)'}`)
    y += 2
  }
  if (c.parts.length || c.materials.length) {
    heading('Parts and materials')
    for (const p of c.parts) para(`${p.name} × ${p.qty}${p.unit && p.unit !== 'each' ? ` ${p.unit}` : ''}`)
    for (const m of c.materials) para(m)
    y += 2
  }
  if (v.photos?.length) {
    heading('Photos')
    const w = (right - left - 6) / 2
    let x = left
    for (const ph of v.photos) {
      const h = Math.min(60, (w * ph.height) / ph.width)
      need(h + 4)
      try { doc.addImage(ph.dataUrl, ph.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', x, y, w, h) } catch { /* a broken photo is left out */ }
      if (x === left) x = left + w + 6; else { x = left; y += h + 4 }
    }
    if (x !== left) y += 64
  }
  if (c.still_to_do) {
    heading('Still to do')
    para(c.still_to_do)
    y += 2
  }

  // Signatures
  need(48)
  y += 4
  const boxW = (right - left - 10) / 2
  const sig = (x: string | null | undefined, at: number) => {
    if (!x) return
    try { doc.addImage(x, 'PNG', at, y, boxW * 0.8, 20) } catch { /* left out */ }
  }
  sig(v.technician?.signature, left)
  sig(v.client?.signature, left + boxW + 10)
  y += 22
  doc.setDrawColor(15, 23, 42); doc.line(left, y, left + boxW, y); doc.line(left + boxW + 10, y, right, y)
  y += 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(51, 65, 85)
  doc.text(`Technician: ${v.technician?.name ?? ''}`, left, y)
  doc.text(`Client: ${v.client?.name ?? ''}`, left + boxW + 10, y)
  y += 4
  doc.text(when(v.technician?.at ?? null) || 'Not signed', left, y)
  doc.text(v.status === 'not_happy' ? `Not happy · ${when(v.client?.at ?? null)}` : when(v.client?.at ?? null) || 'Not signed', left + boxW + 10, y)
  y += 5
  if (v.client?.comment) para(`Client's comment: ${v.client.comment}`)

  finishDocument(doc, v.letterhead, { y: y + 6, bank: false, reference: c.job.code })
  return doc
}

/** A photo from a URL, scaled down (long side 1400 px, JPEG) so the PDF stays small. Null if it can't be read. */
export async function loadPdfImage(url: string): Promise<PdfImage | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}
