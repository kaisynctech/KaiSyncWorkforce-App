'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  hrModuleDeniedMessage,
  hrPermissionDeniedMessage,
  resolveHrModuleAccess,
  type HrModuleFlag,
} from '@/lib/hr-module-gate'
import type { PermissionKey } from '@/lib/permissions'

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
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [denyReason, setDenyReason] = useState<'module' | 'permission'>('module')

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) {
        setAllowed(false)
        setDenyReason('module')
        return
      }
      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      const moduleOnly = await resolveHrModuleAccess(supabase, member.companyId, flag)
      if (!moduleOnly.allowed) {
        setDenyReason('module')
        setAllowed(false)
        return
      }
      if (permissionKey) {
        const withPerm = await resolveHrModuleAccess(supabase, member.companyId, flag, {
          permissionKey,
          accessLevel: me?.access_level,
        })
        setDenyReason(withPerm.allowed ? 'module' : 'permission')
        setAllowed(withPerm.allowed)
        return
      }
      setAllowed(true)
    })()
  }, [flag, permissionKey])

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
            {denyReason === 'permission' ? 'Access denied' : 'Module unavailable'}
          </p>
          <p className="text-[13px] text-text-secondary">
            {denyReason === 'permission'
              ? hrPermissionDeniedMessage(flag)
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
