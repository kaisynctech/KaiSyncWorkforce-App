'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="properties" permissionKey={PERM.propertiesView}>
      {children}
    </HrModuleGate>
  )
}
