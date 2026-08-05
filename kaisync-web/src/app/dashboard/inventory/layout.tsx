'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="inventory" permissionKey={PERM.inventoryView}>
      {children}
    </HrModuleGate>
  )
}
