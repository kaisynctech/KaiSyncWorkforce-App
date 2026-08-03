'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

/**
 * Supplier detail route — same underlying partner record as contractors,
 * but URL stays in the Suppliers module for product separation.
 */
export default function SupplierDetailRedirectPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  useEffect(() => {
    if (params.id) {
      router.replace(`/dashboard/contractors/${params.id}?from=suppliers`)
    }
  }, [params.id, router])
  return (
    <div className="flex items-center justify-center h-full">
      <span className="text-text-secondary text-[13px]">Opening supplier…</span>
    </div>
  )
}
