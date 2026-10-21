'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { PortalAppShell, type PortalNavItem } from '@/components/PortalAppShell'
import { signOutContractorPortal, type ContractorPortalSession } from '@/lib/contractor-portal/session'

const NAV: PortalNavItem[] = [
  { label: 'Home', href: '/contractor-portal/home?tab=home', icon: 'home' },
  { label: 'Information', href: '/contractor-portal/home?tab=information', icon: 'badge' },
  { label: 'Jobs', href: '/contractor-portal/home?tab=jobs', icon: 'work', activePrefix: '/contractor-portal/jobs' },
  { label: 'Quotes & Invoices', href: '/contractor-portal/home?tab=quotes', icon: 'request_quote' },
  { label: 'Payments', href: '/contractor-portal/home?tab=payments', icon: 'payments' },
  { label: 'Banking', href: '/contractor-portal/home?tab=banking', icon: 'account_balance' },
  { label: 'Compliance', href: '/contractor-portal/home?tab=compliance', icon: 'verified_user' },
  { label: 'Messages', href: '/contractor-portal/home?tab=messages', icon: 'chat' },
  { label: 'Main menu', href: '/auth/id-entry', icon: 'apps' },
]

export function ContractorPortalShell({
  session,
  children,
}: {
  session: ContractorPortalSession
  children: ReactNode
}) {
  const router = useRouter()

  return (
    <PortalAppShell
      portalLabel="Contractor Portal"
      displayName={session.contractor_name || 'Contractor'}
      roleLabel="Contractor"
      items={NAV}
      defaultTab="home"
      onSignOut={() => {
        signOutContractorPortal()
        router.replace('/contractor-portal')
      }}
    >
      {children}
    </PortalAppShell>
  )
}
