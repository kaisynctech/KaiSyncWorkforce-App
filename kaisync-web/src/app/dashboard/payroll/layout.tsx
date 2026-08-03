'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="payroll">{children}</HrModuleGate>
}
