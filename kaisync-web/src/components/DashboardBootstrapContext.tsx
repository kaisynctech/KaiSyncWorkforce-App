'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  resolveCurrentMember,
  type CurrentMember,
} from '@/lib/supabase/resolve-company'
import {
  loadCompanyWorkspace,
  loadEmployeeWorkspace,
  moduleFlagsForCompany,
  type CompanyWorkspace,
  type EmployeeWorkspace,
} from '@/lib/employee-workspace'
import {
  ALL_MODULES_ENABLED,
  type EmployeeModuleFlags,
} from '@/lib/company-modules'
import { useDashboardCompany } from '@/components/DashboardCompanyContext'

export type DashboardBootstrapValue = {
  /** False until first member/workspace resolve attempt finishes. */
  ready: boolean
  member: CurrentMember | null
  companyWs: CompanyWorkspace | null
  employeeWs: EmployeeWorkspace | null
  modules: EmployeeModuleFlags
  refresh: () => Promise<void>
}

const DashboardBootstrapContext = createContext<DashboardBootstrapValue>({
  ready: false,
  member: null,
  companyWs: null,
  employeeWs: null,
  modules: ALL_MODULES_ENABLED,
  refresh: async () => {},
})

/**
 * Shared tenant bootstrap for the dashboard shell.
 * Resolves member + company/employee workspace once so pages and gates
 * do not each re-hit auth + companies on every navigation.
 */
export function DashboardBootstrapProvider({ children }: { children: React.ReactNode }) {
  const { company, employee } = useDashboardCompany()
  const [ready, setReady] = useState(false)
  const [member, setMember] = useState<CurrentMember | null>(null)
  const [companyWs, setCompanyWs] = useState<CompanyWorkspace | null>(null)
  const [employeeWs, setEmployeeWs] = useState<EmployeeWorkspace | null>(null)

  const modules = useMemo(() => {
    if (companyWs) return moduleFlagsForCompany(companyWs)
    if (company?.enabled_modules != null) {
      return moduleFlagsForCompany({
        id: company.id,
        name: company.name,
        enabled_modules: company.enabled_modules,
        dispatch_settings: {},
      })
    }
    return ALL_MODULES_ENABLED
  }, [companyWs, company])

  const load = useCallback(async () => {
    const supabase = createClient()
    const resolved = await resolveCurrentMember(supabase)
    if (!resolved) {
      setMember(null)
      setCompanyWs(null)
      setEmployeeWs(null)
      setReady(true)
      return
    }

    setMember(resolved)
    const [cws, ews] = await Promise.all([
      loadCompanyWorkspace(supabase, resolved.companyId),
      loadEmployeeWorkspace(supabase, resolved.employeeId),
    ])
    setCompanyWs(cws)
    setEmployeeWs(ews)
    setReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    void (async () => {
      await load()
      if (cancelled) return
    })()
    return () => { cancelled = true }
  }, [company?.id, employee?.id, load])

  const value = useMemo<DashboardBootstrapValue>(
    () => ({
      ready,
      member,
      companyWs,
      employeeWs,
      modules,
      refresh: load,
    }),
    [ready, member, companyWs, employeeWs, modules, load],
  )

  return (
    <DashboardBootstrapContext.Provider value={value}>
      {children}
    </DashboardBootstrapContext.Provider>
  )
}

export function useDashboardBootstrap() {
  return useContext(DashboardBootstrapContext)
}
