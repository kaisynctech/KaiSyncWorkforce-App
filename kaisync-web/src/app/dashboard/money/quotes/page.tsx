'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { QuotesList } from '@/components/money/QuotesList'

export default function QuotesPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <QuotesFromUrl />
    </Suspense>
  )
}

function QuotesFromUrl() {
  const sp = useSearchParams()
  return (
    <QuotesList
      clientId={sp.get('client') ?? sp.get('client_id')}
      jobId={sp.get('job_id')}
      dealId={sp.get('deal_id') ?? sp.get('project_id')}
    />
  )
}
