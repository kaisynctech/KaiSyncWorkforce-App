import { Suspense } from 'react'
import RfqBuilder from '../_builder'

export default function NewRfqPage() {
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <RfqBuilder />
    </Suspense>
  )
}
