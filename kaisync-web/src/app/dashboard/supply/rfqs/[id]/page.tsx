import { Suspense } from 'react'
import RfqBuilder from '../_builder'

interface Props { params: Promise<{ id: string }> }

export default async function RfqDetailPage({ params }: Props) {
  const { id } = await params
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <RfqBuilder rfqId={id} />
    </Suspense>
  )
}
