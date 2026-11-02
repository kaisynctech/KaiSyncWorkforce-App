import type { ReactNode } from 'react'
import { InsightsShell } from '@/components/insights/InsightsShell'

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <InsightsShell>{children}</InsightsShell>
}
