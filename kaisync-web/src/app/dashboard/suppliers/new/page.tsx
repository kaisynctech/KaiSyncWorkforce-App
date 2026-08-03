'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Supplier create lives under /dashboard/suppliers for product IA; storage is contractors.partner_kind. */
export default function NewSupplierRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/contractors/new?type=supplier')
  }, [router])
  return (
    <div className="flex items-center justify-center h-full">
      <span className="text-text-secondary text-[13px]">Opening new supplier…</span>
    </div>
  )
}
