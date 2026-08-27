import { Suspense } from 'react'
import SimpleQuoteBuilder from '@/components/quotes/SimpleQuoteBuilder'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditQuotePage({ params }: Props) {
  const { id } = await params
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <SimpleQuoteBuilder quoteId={id} />
    </Suspense>
  )
}
