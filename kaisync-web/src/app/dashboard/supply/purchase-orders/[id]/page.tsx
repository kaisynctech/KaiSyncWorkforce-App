import { Suspense } from 'react'
import PoBuilder from '../_po-builder'

interface Props { params: Promise<{ id: string }> }

export default async function PoDetailPage({ params }: Props) {
  const { id } = await params
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <PoBuilder poId={id} />
    </Suspense>
  )
}
