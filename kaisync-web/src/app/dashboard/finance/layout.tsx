'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import { canAccessFinance } from '@/lib/finance-gate'
import FinanceSubNav from '@/components/FinanceSubNav'

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setAllowed(false); return }
      const workspace = await loadCompanyWorkspace(supabase, member.companyId)
      const ok = await canAccessFinance(supabase, member.companyId, workspace?.enabled_modules)
      if (!ok) {
        setAllowed(false)
        return
      }
      setAllowed(true)
    })()
  }, [])

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[14px] text-text-secondary">Loading Finance…</span>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center space-y-3 max-w-md">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[16px] font-semibold text-text-primary">Upgrade required</p>
          <p className="text-[13px] text-text-secondary">
            Finance is not included in your current plan, or the Payments module is disabled.
            Enable Payroll/Payments in Settings → Modules, or upgrade your plan.
          </p>
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

  return (
    <div className="h-full flex flex-col">
      <FinanceSubNav />
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
