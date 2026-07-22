'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadCompanyWorkspace, moduleFlagsForCompany } from '@/lib/employee-workspace'
import type { EmployeeModuleFlags } from '@/lib/company-modules'

/** Redirect employees away when a module is disabled. Returns true if allowed. */
export async function ensureEmployeeModule(
  flag: keyof EmployeeModuleFlags,
  fallback = '/dashboard/employee/overview',
): Promise<boolean> {
  const supabase = createClient()
  const member = await resolveCurrentMember(supabase)
  if (!member) return false
  const company = await loadCompanyWorkspace(supabase, member.companyId)
  const flags = moduleFlagsForCompany(company)
  return Boolean(flags[flag])
}

export function useEmployeeModuleGate(flag: keyof EmployeeModuleFlags) {
  const router = useRouter()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      const ok = await ensureEmployeeModule(flag)
      if (!ok) {
        router.replace('/dashboard/employee/overview')
        setAllowed(false)
        return
      }
      setAllowed(true)
    })()
  }, [flag, router])

  return allowed
}
