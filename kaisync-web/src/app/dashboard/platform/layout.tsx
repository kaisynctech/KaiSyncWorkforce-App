'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPlatformAdmin } from '@/lib/platform-admin'
import PlatformSubNav from '@/components/PlatformSubNav'

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth/hr-sign-in')
        setAllowed(false)
        return
      }
      const ok = await isPlatformAdmin(supabase)
      if (!ok) {
        router.replace('/dashboard/overview')
        setAllowed(false)
        return
      }
      setAllowed(true)
    })()
  }, [router])

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[14px] text-text-secondary">Checking platform access…</span>
      </div>
    )
  }

  if (!allowed) return null

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-divider bg-surface shrink-0 flex items-center justify-between">
        <h1 className="text-[18px] font-semibold text-text-primary">Platform Console</h1>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">Operator</span>
      </div>
      <PlatformSubNav />
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
