'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="jobs" permissionKey={PERM.jobsView}>
      {children}
    </HrModuleGate>
  )
}
