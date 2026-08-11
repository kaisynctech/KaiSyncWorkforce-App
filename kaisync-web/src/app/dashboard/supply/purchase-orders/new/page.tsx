import { Suspense } from 'react'
import PoBuilder from '../_po-builder'

export default function NewPoPage() {
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <PoBuilder />
    </Suspense>
  )
}
