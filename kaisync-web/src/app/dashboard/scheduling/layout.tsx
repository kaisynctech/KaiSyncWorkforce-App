'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function SchedulingLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="scheduling">{children}</HrModuleGate>
}
