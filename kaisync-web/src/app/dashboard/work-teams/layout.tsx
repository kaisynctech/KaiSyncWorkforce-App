'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function WorkTeamsLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="workTeams">{children}</HrModuleGate>
}
