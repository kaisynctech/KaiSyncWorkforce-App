'use client'

/**
 * Shows an error message. When it is the Starter limit (employee 16 on Starter), it adds a
 * "Move to Business" button that opens Settings → Billing ready to switch (owner/HR/admin can do it there).
 */

import Link from 'next/link'
import { isPlanLimit } from '@/lib/supabase/read-only-fetch'

export function ErrorWithUpgrade({ message, className = '' }: { message: string | null | undefined; className?: string }) {
  if (!message) return null
  if (!isPlanLimit(message)) return <p className={`text-error text-[13px] ${className}`}>{message}</p>
  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 flex flex-col gap-2 ${className}`} role="alert">
      <p className="text-[13px] text-amber-900 flex items-start gap-2">
        <span className="material-icons text-[18px] text-amber-700">group_add</span>
        <span>{message}</span>
      </p>
      <Link href="/dashboard/settings?tab=billing&plan=kaiflow_standard"
        className="self-start h-9 px-4 rounded-lg bg-primary text-white text-[12.5px] font-semibold inline-flex items-center hover:bg-primary-dark">
        Move to Business
      </Link>
    </div>
  )
}
