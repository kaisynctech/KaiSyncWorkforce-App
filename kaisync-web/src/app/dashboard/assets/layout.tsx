'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="assets" permissionKey={PERM.assetsView}>
      {children}
    </HrModuleGate>
  )
}
