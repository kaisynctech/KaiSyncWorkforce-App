'use client'

import { HrModuleGate } from '@/components/HrModuleGate'

export default function TimeTemplatesLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleGate flag="timeTemplates">{children}</HrModuleGate>
}
