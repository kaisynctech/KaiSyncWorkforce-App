import type { RfqStatus } from '@/types/quotes'

export function generateRfqNumber(quoteNumber: string, rfqIndex: number): string {
  // e.g. QT-2026-0041 → RFQ-2026-0041-01
  const base = quoteNumber.replace(/^QT-/, '')
  return `RFQ-${base}-${String(rfqIndex).padStart(2, '0')}`
}

export interface RfqStatusConfig {
  label: string
  colour: string    // Tailwind text class
  bgColour: string  // Tailwind bg class
  icon: string      // Material icon
}

export const RFQ_STATUS_CONFIG: Record<RfqStatus, RfqStatusConfig> = {
  draft:               { label: 'Draft',     colour: 'text-gray-500',  bgColour: 'bg-gray-100',  icon: 'draft' },
  sent:                { label: 'Sent',      colour: 'text-blue-600',  bgColour: 'bg-blue-50',   icon: 'send' },
  partially_responded: { label: 'Partial',   colour: 'text-amber-600', bgColour: 'bg-amber-50',  icon: 'hourglass_bottom' },
  responded:           { label: 'Responded', colour: 'text-green-600', bgColour: 'bg-green-50',  icon: 'check_circle' },
  expired:             { label: 'Expired',   colour: 'text-red-500',   bgColour: 'bg-red-50',    icon: 'schedule' },
  cancelled:           { label: 'Cancelled', colour: 'text-gray-400',  bgColour: 'bg-gray-50',   icon: 'cancel' },
}

export function rfqProgress(rfq: { lines?: { supplier_price: number | null }[] }): string {
  if (!rfq.lines?.length) return '0 items'
  const responded = rfq.lines.filter(l => l.supplier_price !== null).length
  return `${responded} / ${rfq.lines.length} responded`
}
