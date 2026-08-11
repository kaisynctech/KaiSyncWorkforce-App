import { Suspense } from 'react'
import GrnForm from '../_grn-form'

interface Props { params: Promise<{ id: string }> }

export default async function GrnDetailPage({ params }: Props) {
  const { id } = await params
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <GrnForm grnId={id} />
    </Suspense>
  )
}
