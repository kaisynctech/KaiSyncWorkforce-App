'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/** The old Finance "new invoice" form now opens the invoice builder (same client carried over). */
export default function NewFinanceInvoiceRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  )
}

function Redirect() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const clientId = params.get('clientId') ?? params.get('client_id')
    router.replace(`/dashboard/money/invoices/new${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`)
  }, [params, router])
  return <p className="text-center text-[13px] text-text-secondary py-10">Opening the invoice builder…</p>
}
