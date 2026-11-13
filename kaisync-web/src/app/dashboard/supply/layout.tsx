import type { ReactNode } from 'react'
import { WithMoneySectionTabs } from '@/components/money/MoneySectionTabs'

export default function SupplyLayout({ children }: { children: ReactNode }) {
  return <WithMoneySectionTabs>{children}</WithMoneySectionTabs>
}
