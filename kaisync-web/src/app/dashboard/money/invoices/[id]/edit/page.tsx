import { Suspense } from 'react'
import { InvoiceBuilder } from '@/components/money/InvoiceBuilder'

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <InvoiceBuilder invoiceId={id} />
    </Suspense>
  )
}
