'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function TeamPunchLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="teamPunch">{children}</HrModuleGate>
}
