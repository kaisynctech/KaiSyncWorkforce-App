'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  hrModuleDeniedMessage,
  resolveHrModuleAccess,
  type HrModuleFlag,
} from '@/lib/hr-module-gate'

export function HrModuleGate({
  flag,
  children,
}: {
  flag: HrModuleFlag
  children: React.ReactNode
}) {
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) {
        setAllowed(false)
        return
      }
      const { allowed: ok } = await resolveHrModuleAccess(supabase, member.companyId, flag)
      setAllowed(ok)
    })()
  }, [flag])

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[14px] text-text-secondary">Loading…</span>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center space-y-3 max-w-md">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[16px] font-semibold text-text-primary">Module unavailable</p>
          <p className="text-[13px] text-text-secondary">{hrModuleDeniedMessage(flag)}</p>
          <button
            onClick={() => router.push('/dashboard/overview')}
            className="h-9 px-4 rounded-md bg-primary text-white text-[13px] font-semibold"
          >
            Back to Overview
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
