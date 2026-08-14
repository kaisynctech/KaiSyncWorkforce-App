'use client'

import { cn } from '@/lib/utils'
import { RFQ_STATUS_CONFIG, rfqProgress } from '@/lib/rfq'
import type { QuoteRfq } from '@/types/quotes'

interface Props {
  rfq: QuoteRfq
  onClick: () => void
}

export default function RfqCard({ rfq, onClick }: Props) {
  const cfg = RFQ_STATUS_CONFIG[rfq.status]
  const lines = rfq.lines ?? []
  const responded = lines.filter(l => l.supplier_price !== null).length
  const total = lines.length
  const progress = total > 0 ? responded / total : 0

  const prices = lines
    .map(l => l.supplier_price)
    .filter((p): p is number => p !== null)
  const minPrice = prices.length ? Math.min(...prices) : null
  const maxPrice = prices.length ? Math.max(...prices) : null

  function fmtR(n: number) {
    return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-[220px] shrink-0 text-left border border-divider rounded-xl bg-surface p-4 hover:border-primary/50 hover:shadow-sm transition-all"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[13px] font-semibold text-text-primary leading-tight line-clamp-2 flex-1">
          {rfq.supplier_name ?? 'Unknown supplier'}
        </p>
        <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium', cfg.colour, cfg.bgColour)}>
          {cfg.label}
        </span>
      </div>

      {/* RFQ number */}
      <p className="text-[10px] text-text-secondary font-mono mb-3">{rfq.rfq_number}</p>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-2">
          <div className="h-1.5 rounded-full bg-surface-elevated overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', responded === total ? 'bg-green-500' : 'bg-primary')}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-text-secondary mt-1">{rfqProgress(rfq)}</p>
        </div>
      )}

      {total === 0 && (
        <p className="text-[11px] text-text-secondary mb-2 italic">No items added yet</p>
      )}

      {/* Sent date + price range */}
      <div className="flex items-center justify-between text-[10px] text-text-secondary mt-2">
        {rfq.sent_at ? (
          <span>Sent {new Date(rfq.sent_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</span>
        ) : (
          <span className="text-amber-500">Not sent</span>
        )}
        {minPrice !== null && (
          <span className="font-medium text-text-primary">
            {minPrice === maxPrice ? fmtR(minPrice) : `${fmtR(minPrice)} – ${fmtR(maxPrice!)}`}
          </span>
        )}
      </div>

      {/* CTA */}
      <div className="mt-3 text-[11px] text-primary font-medium">View / log response →</div>
    </button>
  )
}
