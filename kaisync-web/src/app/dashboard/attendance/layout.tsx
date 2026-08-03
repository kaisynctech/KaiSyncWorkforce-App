'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="attendance">{children}</HrModuleGate>
}
