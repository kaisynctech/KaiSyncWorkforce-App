'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/** Red strip across the office app while the company is read-only for an unpaid KaiSync bill. */
export function BillingLockBanner({ companyId }: { companyId: string | null | undefined }) {
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (!companyId) return
    let alive = true
    createClient().from('companies').select('billing_locked_at').eq('id', companyId).maybeSingle()
      .then(({ data }) => { if (alive) setLocked(Boolean((data as { billing_locked_at?: string | null } | null)?.billing_locked_at)) })
    return () => { alive = false }
  }, [companyId])
  if (!locked) return null
  return (
    <div className="bg-red-600 text-white text-[13px] px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1" role="alert">
      <span className="material-icons text-[18px]">lock</span>
      <span className="font-medium">Read-only: the KaiSync subscription is more than 7 days overdue.</span>
      <span className="opacity-90">You can still see everything. Pay to open the account again straight away.</span>
      <Link href="/dashboard/settings?tab=billing" className="underline font-semibold text-white">Pay now</Link>
    </div>
  )
}
