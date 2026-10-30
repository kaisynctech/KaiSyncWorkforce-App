'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { PortalAppShell, type PortalNavItem } from '@/components/PortalAppShell'
import { signOutClientPortal, type ClientPortalSession } from '@/lib/client-portal/session'
import { portalHref, usePortalMode, type PortalMode } from '@/lib/client-portal/portal-mode'

const NAV: PortalNavItem[] = [
  { label: 'Home', href: '/client-portal/home?tab=home', icon: 'home' },
  { label: 'My information', href: '/client-portal/home?tab=information', icon: 'badge' },
  { label: 'Projects', href: '/client-portal/home?tab=projects', icon: 'folder', activePrefix: '/client-portal/projects' },
  { label: 'Jobs', href: '/client-portal/home?tab=jobs', icon: 'work', activePrefix: '/client-portal/jobs' },
  { label: 'Messages', href: '/client-portal/home?tab=messages', icon: 'chat' },
  { label: 'Compliance & documents', href: '/client-portal/home?tab=documents', icon: 'verified' },
  { label: 'Quotes & Invoices', href: '/client-portal/home?tab=quotes', icon: 'request_quote' },
  { label: 'Payments', href: '/client-portal/home?tab=payments', icon: 'payments' },
  { label: 'Banking', href: '/client-portal/home?tab=banking', icon: 'account_balance' },
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
  const mode = usePortalMode()
  if (mode.kind === 'linked') return <LinkedShell mode={mode}>{children}</LinkedShell>

  return (
    <PortalAppShell
      companyCode={session.company_code}
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

/** Tabs for a linked company's view of the provider's work, inside the normal dashboard. */
function LinkedShell({ mode, children }: { mode: Extract<PortalMode, { kind: 'linked' }>; children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const base = portalHref(mode, '/home')
  const tab = pathname === base ? (searchParams.get('tab') ?? 'home') : pathname.startsWith(`${base}/jobs`) ? 'jobs' : 'projects'
  const items = [
    { tab: 'home', label: 'Overview' },
    { tab: 'projects', label: 'Projects' },
    { tab: 'jobs', label: 'Jobs' },
    { tab: 'quotes', label: 'Quotes & invoices' },
    { tab: 'payments', label: 'Statement' },
    { tab: 'messages', label: 'Messages' },
    { tab: 'documents', label: 'Compliance & documents' },
    { tab: 'information', label: 'Our details' },
    ...(mode.canAct && mode.canEditDetails ? [{ tab: 'banking', label: 'Banking' }] : []),
  ]
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 bg-surface border-b border-divider px-4 pt-3">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/linked-companies" className="text-text-secondary hover:text-text-primary" aria-label="Back to linked companies">
            <span className="material-icons">arrow_back</span>
          </Link>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">{mode.providerName}</h1>
            <p className="text-[12px] text-text-secondary">Your contractor on KaiSync · their work for you</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto mt-2 -mb-px" aria-label={`${mode.providerName} work`}>
          {items.map(i => {
            const active = i.tab === tab || (i.tab === 'quotes' && tab === 'invoices')
            return (
              <Link
                key={i.tab}
                href={i.tab === 'home' ? base : `${base}?tab=${i.tab}`}
                className={`px-3 py-2 text-[13px] whitespace-nowrap border-b-2 ${active ? 'border-primary text-primary font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                {i.label}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
