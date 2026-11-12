'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { InvoicesList } from '@/components/money/InvoicesList'

export default function MoneyInvoicesPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <InvoicesFromUrl />
    </Suspense>
  )
}

function InvoicesFromUrl() {
  const sp = useSearchParams()
  return (
    <InvoicesList
      clientId={sp.get('client') ?? sp.get('client_id')}
      jobId={sp.get('job_id')}
      dealId={sp.get('deal_id') ?? sp.get('project_id')}
    />
  )
}
