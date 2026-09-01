'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { useDashboardCompany } from '@/components/DashboardCompanyContext'
import {
  hrModuleDeniedMessage,
  hrPermissionDeniedMessage,
  type HrModuleFlag,
} from '@/lib/hr-module-gate'
import { MODULES_UPDATED_EVENT, type ModulesUpdatedDetail } from '@/lib/module-events'
import {
  resolveHrNavFlags,
  type EnabledModules,
} from '@/lib/company-modules'
import { can, loadPermissions, type PermissionKey } from '@/lib/permissions'
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import { resolveFinanceNavFlag } from '@/lib/finance-gate'

export function HrModuleGate({
  flag,
  permissionKey,
  children,
}: {
  flag: HrModuleFlag
  /** When set, module flag AND this permission key are required. */
  permissionKey?: PermissionKey
  children: React.ReactNode
}) {
  const router = useRouter()
  const { company, employee } = useDashboardCompany()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [denyReason, setDenyReason] = useState<'module' | 'permission' | 'auth'>('module')
  const [modulesOverride, setModulesOverride] = useState<EnabledModules | null>(null)

  useEffect(() => {
    function onModulesUpdated(ev: Event) {
      const detail = (ev as CustomEvent<ModulesUpdatedDetail>).detail
      if (!detail) return
      if (company?.id && detail.companyId !== company.id) return
      setModulesOverride(detail.enabledModules)
    }
    window.addEventListener(MODULES_UPDATED_EVENT, onModulesUpdated)
    return () => window.removeEventListener(MODULES_UPDATED_EVENT, onModulesUpdated)
  }, [company?.id])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)

      // Layout company is source of truth for multi-company users (nav + gate must match)
      const companyId = company?.id ?? member?.companyId
      if (!companyId) {
        if (!cancelled) {
          setDenyReason('auth')
          setAllowed(false)
        }
        return
      }

      const workspace = await loadCompanyWorkspace(supabase, companyId)
      const enabled: EnabledModules = {
        ...(workspace?.enabled_modules ?? {}),
        ...(company?.enabled_modules ?? {}),
        ...(modulesOverride ?? {}),
      }

      const { finance } = await resolveFinanceNavFlag(supabase, companyId, enabled)
      const flags = resolveHrNavFlags(enabled, finance)
      const moduleAllowed = Boolean(flags[flag])

      if (!moduleAllowed) {
        if (!cancelled) {
          setDenyReason('module')
          setAllowed(false)
        }
        return
      }

      if (permissionKey) {
        const perms = await loadPermissions(
          supabase,
          companyId,
          employee?.access_level ?? null,
        )
        const ok = can(perms, permissionKey)
        if (!cancelled) {
          setDenyReason(ok ? 'module' : 'permission')
          setAllowed(ok)
        }
        return
      }

      if (!cancelled) setAllowed(true)
    })()

    return () => { cancelled = true }
  }, [
    flag,
    permissionKey,
    company?.id,
    company?.enabled_modules,
    employee?.access_level,
    modulesOverride,
  ])

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
          <p className="text-[16px] font-semibold text-text-primary">
            {denyReason === 'permission'
              ? 'Access denied'
              : denyReason === 'auth'
                ? 'Sign-in required'
                : 'Module unavailable'}
          </p>
          <p className="text-[13px] text-text-secondary">
            {denyReason === 'permission'
              ? hrPermissionDeniedMessage(flag)
              : denyReason === 'auth'
                ? 'Could not resolve your company session. Refresh the page or sign in again.'
                : hrModuleDeniedMessage(flag)}
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

  return <>{children}</>
}
