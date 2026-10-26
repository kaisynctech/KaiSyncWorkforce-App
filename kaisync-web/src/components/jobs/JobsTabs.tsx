'use client'

import Link from 'next/link'

export type JobsSection = 'jobs' | 'services' | 'plans'

const TABS: { id: JobsSection; label: string; href: string }[] = [
  { id: 'jobs', label: 'Jobs', href: '/dashboard/jobs' },
  { id: 'services', label: 'Job services', href: '/dashboard/jobs/services' },
  { id: 'plans', label: 'Service plans', href: '/dashboard/jobs/plans' },
]

export function JobsTabs({ active, className = '' }: { active: JobsSection; className?: string }) {
  return (
    <nav aria-label="Jobs sections" className={`flex gap-1 bg-surface border border-divider rounded-md p-1 w-fit ${className}`}>
      {TABS.map(tab => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`inline-flex items-center px-3 h-7 rounded text-[12px] font-medium transition-colors ${
            active === tab.id ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
