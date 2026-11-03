'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { InvoiceBuilder } from '@/components/money/InvoiceBuilder'
import { RentInvoiceForm } from '@/components/money/RentInvoiceForm'

export default function NewMoneyInvoicePage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <NewInvoiceRouter />
    </Suspense>
  )
}

/** Rent invoices from a lease keep their simple form; every other invoice uses the builder. */
function NewInvoiceRouter() {
  const params = useSearchParams()
  return params.get('lease_id') ? <RentInvoiceForm /> : <InvoiceBuilder />
}
