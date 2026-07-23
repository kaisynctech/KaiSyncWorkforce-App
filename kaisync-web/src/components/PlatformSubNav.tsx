'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/dashboard/platform', label: 'Overview', exact: true },
  { href: '/dashboard/platform/companies', label: 'Companies' },
  { href: '/dashboard/platform/subscriptions', label: 'Subscriptions' },
  { href: '/dashboard/platform/audit', label: 'Audit' },
]

export default function PlatformSubNav() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-divider px-4 py-2 bg-surface shrink-0">
      {ITEMS.map(item => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'h-8 px-3 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors',
              active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-elevated',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
