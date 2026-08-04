'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="clients" permissionKey={PERM.clientsView}>
      {children}
    </HrModuleGate>
  )
}
