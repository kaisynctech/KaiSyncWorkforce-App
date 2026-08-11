import { Suspense } from 'react'
import GrnForm from '../_grn-form'

export default function NewGrnPage() {
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <GrnForm />
    </Suspense>
  )
}
