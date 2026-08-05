'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function IncidentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="incidents" permissionKey={PERM.incidentsView}>
      {children}
    </HrModuleGate>
  )
}
