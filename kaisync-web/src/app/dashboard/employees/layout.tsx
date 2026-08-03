'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function EmployeesLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="employees">{children}</HrModuleGate>
}
