'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function ContractorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="contractors" permissionKey={PERM.contractorsView}>
      {children}
    </HrModuleGate>
  )
}
