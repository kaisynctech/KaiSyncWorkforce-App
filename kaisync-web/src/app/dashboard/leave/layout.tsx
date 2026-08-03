'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="leave">{children}</HrModuleGate>
}
