'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function FarmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="farms" permissionKey={PERM.farmsView}>
      {children}
    </HrModuleGate>
  )
}
