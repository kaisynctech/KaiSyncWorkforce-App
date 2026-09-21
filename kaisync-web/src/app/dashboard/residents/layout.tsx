'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function ResidentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="residents" permissionKey={PERM.propertiesView}>
      {children}
    </HrModuleGate>
  )
}
