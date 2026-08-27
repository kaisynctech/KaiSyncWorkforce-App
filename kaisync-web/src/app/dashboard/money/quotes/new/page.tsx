'use client'

import { Suspense } from 'react'
import SimpleQuoteBuilder from '@/components/quotes/SimpleQuoteBuilder'

export default function NewQuotePage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <SimpleQuoteBuilder quoteId={null} />
    </Suspense>
  )
}
