'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { PortalAppShell, type PortalNavItem } from '@/components/PortalAppShell'
import { signOutClientPortal, type ClientPortalSession } from '@/lib/client-portal/session'

const NAV: PortalNavItem[] = [
  { label: 'Home', href: '/client-portal/home?tab=home', icon: 'home' },
  { label: 'My information', href: '/client-portal/home?tab=information', icon: 'badge' },
  { label: 'Projects', href: '/client-portal/home?tab=projects', icon: 'folder', activePrefix: '/client-portal/projects' },
  { label: 'Jobs', href: '/client-portal/home?tab=jobs', icon: 'work', activePrefix: '/client-portal/jobs' },
  { label: 'Messages', href: '/client-portal/home?tab=messages', icon: 'chat' },
  { label: 'Documents', href: '/client-portal/home?tab=documents', icon: 'description' },
  { label: 'Invoices', href: '/client-portal/home?tab=invoices', icon: 'receipt_long' },
  { label: 'Main menu', href: '/auth/id-entry', icon: 'apps' },
]

export function ClientPortalShell({
  session,
  children,
}: {
  session: ClientPortalSession
  children: ReactNode
}) {
  const router = useRouter()

  return (
    <PortalAppShell
      portalLabel="Client Portal"
      displayName={session.client_name || 'Client'}
      roleLabel="Client"
      items={NAV}
      defaultTab="projects"
      onSignOut={() => {
        signOutClientPortal()
        router.replace('/client-portal')
      }}
    >
      {children}
    </PortalAppShell>
  )
}
