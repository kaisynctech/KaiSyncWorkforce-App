'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadCompanyWorkspace, moduleFlagsForCompany } from '@/lib/employee-workspace'
import { useDashboardBootstrap } from '@/components/DashboardBootstrapContext'
import type { EmployeeModuleFlags } from '@/lib/company-modules'

function moduleGateHome(pathname: string | null): string {
  return pathname?.startsWith('/dashboard/pa')
    ? '/dashboard/overview'
    : '/dashboard/employee/overview'
}

/** Redirect away when a module is disabled. Returns true if allowed. */
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
  const pathname = usePathname()
  const bootstrap = useDashboardBootstrap()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const home = moduleGateHome(pathname)

  useEffect(() => {
    // Prefer shared bootstrap (no extra network) once ready.
    if (bootstrap.ready) {
      const ok = Boolean(bootstrap.modules[flag])
      if (!ok) {
        router.replace(home)
        setAllowed(false)
        return
      }
      setAllowed(true)
      return
    }

    void (async () => {
      const ok = await ensureEmployeeModule(flag, home)
      if (!ok) {
        router.replace(home)
        setAllowed(false)
        return
      }
      setAllowed(true)
    })()
  }, [flag, router, home, bootstrap.ready, bootstrap.modules])

  return allowed
}
