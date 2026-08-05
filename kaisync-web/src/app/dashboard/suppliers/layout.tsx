'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function SuppliersLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="suppliers" permissionKey={PERM.suppliersView}>
      {children}
    </HrModuleGate>
  )
}
