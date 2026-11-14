/** The purchase order PDF (PO screen and the Order page's "Send all"). */

import type { jsPDF } from 'jspdf'
import { buildDocumentPdf, money, pdfDate } from '@/lib/document-pdf'
import type { Letterhead } from '@/lib/letterhead'

export type PoPdfInput = {
  letterhead: Letterhead
  po: {
    po_number: string | null; currency: string | null; approved_at?: string | null; created_at: string
    required_delivery_date?: string | null; vat_amount?: number | null; subtotal?: number | null; total_amount?: number | null
    delivery_address?: string | null; notes?: string | null; terms_and_conditions?: string | null
  }
  supplier: { name: string | null; email: string | null } | null
  lines: { description: string | null; unit: string | null; quantity_ordered: number | string | null; unit_price: number | string | null }[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildPoPdf({ letterhead, po, supplier, lines }: PoPdfInput): { doc: jsPDF; filename: string } {
  const vat = Number(po.vat_amount ?? 0)
  const doc = buildDocumentPdf({
    currency: po.currency,
    letterhead,
    title: 'Purchase order',
    meta: [
      ['PO no.', po.po_number ?? 'Draft'],
      ['Date', pdfDate(po.approved_at ?? po.created_at)],
      ...(po.required_delivery_date ? [['Deliver by', pdfDate(po.required_delivery_date)] as [string, string]] : []),
    ],
    toLabel: 'Supplier',
    toName: supplier?.name ?? '—',
    toLines: [supplier?.email ?? ''],
    lines: lines.map(l => {
      const qty = Number(l.quantity_ordered) || 0
      const up = Number(l.unit_price) || 0
      return { description: l.description ?? '', qty, unit: l.unit, unit_price: up, total: round2(qty * up) }
    }),
    totals: vat > 0.004
      ? [['Total excl. VAT', money(Number(po.subtotal ?? 0), po.currency), false], ['VAT', money(vat, po.currency), false], ['Total incl. VAT', money(Number(po.total_amount ?? 0), po.currency), true]]
      : [['Total', money(Number(po.total_amount ?? 0), po.currency), true]],
    notesHeading: 'Delivery and terms',
    notes: [
      po.delivery_address ? `Deliver to: ${po.delivery_address}` : '',
      po.notes ?? '',
      po.terms_and_conditions ?? '',
      `Please quote ${po.po_number ?? 'this PO number'} on your invoice.`,
    ].filter(Boolean).join('\n\n'),
    reference: po.po_number,
  })
  const safe = (po.po_number || 'draft').replace(/[^\w.-]+/g, '_')
  return { doc, filename: `Purchase_order_${safe}.pdf` }
}
