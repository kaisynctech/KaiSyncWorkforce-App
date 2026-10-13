'use client'

import Link from 'next/link'

export type PayrollSection = 'payslips' | 'bank' | 'settings'

const TABS: { id: PayrollSection; label: string; href: string }[] = [
  { id: 'payslips', label: 'Payslips', href: '/dashboard/payroll' },
  { id: 'bank', label: 'Bank & tax', href: '/dashboard/payroll?tab=bank' },
  { id: 'settings', label: 'Settings', href: '/dashboard/payroll/settings' },
]

export function PayrollTabs({ active, className = 'mt-2' }: { active: PayrollSection; className?: string }) {
  return (
    <div className={`flex gap-1 bg-surface border border-divider rounded-md p-1 w-fit ${className}`}>
      {TABS.map(tab => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`inline-flex items-center px-4 h-8 rounded text-[13px] font-medium transition-colors ${
            active === tab.id ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
