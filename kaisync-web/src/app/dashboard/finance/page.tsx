'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** The old Finance hub is now the Money overview. */
export default function FinanceHubRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/money') }, [router])
  return <p className="text-center text-[13px] text-text-secondary py-10">Opening Money…</p>
}
