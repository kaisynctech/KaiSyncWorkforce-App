'use client'

import RfqCard from './RfqCard'
import type { QuoteRfq } from '@/types/quotes'

interface Props {
  rfqs: QuoteRfq[]
  onOpenRfq: (rfq: QuoteRfq) => void
  onNewRfq: () => void
}

export default function RfqBoard({ rfqs, onOpenRfq, onNewRfq }: Props) {
  return (
    <div className="border-t border-divider pt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">RFQs</p>
        <button
          type="button"
          onClick={onNewRfq}
          className="flex items-center gap-1 text-[12px] text-primary hover:underline"
        >
          <span className="material-icons text-[15px]">add</span>
          New RFQ
        </button>
      </div>

      {rfqs.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-text-secondary border-2 border-dashed border-divider rounded-xl">
          <div className="text-center">
            <span className="material-icons text-[32px] mb-2 block">request_quote</span>
            <p className="text-[13px] font-medium">No RFQs yet</p>
            <p className="text-[12px] mt-1">Create an RFQ to request prices from suppliers</p>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {rfqs.map(rfq => (
            <RfqCard key={rfq.id} rfq={rfq} onClick={() => onOpenRfq(rfq)} />
          ))}
          <button
            type="button"
            onClick={onNewRfq}
            className="w-[220px] shrink-0 border-2 border-dashed border-divider rounded-xl flex flex-col items-center justify-center py-8 text-text-secondary hover:border-primary/50 hover:text-primary transition-all"
          >
            <span className="material-icons text-[28px] mb-1">add</span>
            <span className="text-[12px]">Add supplier</span>
          </button>
        </div>
      )}
    </div>
  )
}
