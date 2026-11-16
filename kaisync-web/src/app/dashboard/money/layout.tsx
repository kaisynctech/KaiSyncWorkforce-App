import { WithMoneySectionTabs } from '@/components/money/MoneySectionTabs'

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return <WithMoneySectionTabs>{children}</WithMoneySectionTabs>
}
