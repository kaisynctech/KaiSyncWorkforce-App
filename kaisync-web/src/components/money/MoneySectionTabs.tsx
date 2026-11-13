'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Money menu: one menu item can hold several related lists (e.g. Invoices · Recurring · Credit notes).
 * These tabs show above those lists only (not on a single document), so each list has one home.
 */
type SectionTab = { href: string; label: string }

export const MONEY_SECTION_TABS: SectionTab[][] = [
  [
    { href: '/dashboard/money/invoices', label: 'Invoices' },
    { href: '/dashboard/money/recurring', label: 'Recurring' },
    { href: '/dashboard/money/credit-notes', label: 'Credit notes' },
  ],
  [
    { href: '/dashboard/supply/rfqs', label: 'Requests' },
    { href: '/dashboard/money/incoming-quotes', label: 'Quotes received' },
  ],
  [
    { href: '/dashboard/supply/purchase-orders', label: 'Orders' },
    { href: '/dashboard/supply/goods-received', label: 'Goods received' },
  ],
  [
    { href: '/dashboard/finance/supplier-invoices', label: 'Supplier bills' },
    { href: '/dashboard/money/subscriptions', label: 'Subscriptions & expenses' },
  ],
  [
    { href: '/dashboard/finance/contractor-payouts', label: 'Contractor payouts' },
    { href: '/dashboard/finance/approvals', label: 'Approvals' },
  ],
]

/** The tab group a list page belongs to, or null (single documents, other pages). */
export function moneySectionFor(pathname: string): SectionTab[] | null {
  const path = pathname.replace(/\/+$/, '')
  return MONEY_SECTION_TABS.find(group => group.some(t => t.href === path)) ?? null
}

export function MoneySectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname().replace(/\/+$/, '')
  return (
    <nav
      aria-label="Lists in this section"
      className="flex gap-1.5 overflow-x-auto border-b border-divider px-4 py-2 bg-surface shrink-0"
    >
      {tabs.map(tab => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center h-10 px-4 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors border',
              active
                ? 'bg-primary border-primary text-white'
                : 'bg-surface border-divider text-text-secondary hover:text-text-primary hover:bg-surface-elevated',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Wraps a Money list page with its section tabs; other pages render unchanged. */
export function WithMoneySectionTabs({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const tabs = moneySectionFor(pathname)
  if (!tabs) return <>{children}</>
  return (
    <div className="h-full flex flex-col">
      <MoneySectionTabs tabs={tabs} />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
