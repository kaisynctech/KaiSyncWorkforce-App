'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function CompliancePacksLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="compliancePacks" permissionKey={PERM.contractorsView}>
      {children}
    </HrModuleGate>
  )
}
