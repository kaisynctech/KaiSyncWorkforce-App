'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn, getInitials } from '@/lib/utils'
import { CompanyMark, useCompanyBrand } from '@/components/CompanyMark'

export type PortalNavItem = {
  label: string
  href: string
  icon: string
  /** Also highlight this item on drill-in routes, such as a project or job page. */
  activePrefix?: string
}

export function PortalAppShell({
  portalLabel,
  displayName,
  roleLabel,
  items,
  defaultTab,
  onSignOut,
  companyCode,
  children,
}: {
  portalLabel: string
  /** The company whose portal this is (its name and logo are shown, not KaiSync's). */
  companyCode?: string | null
  displayName: string
  roleLabel: string
  items: PortalNavItem[]
  defaultTab: string
  onSignOut: () => void
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const [open, setOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => {
      const desktop = mq.matches
      setIsDesktop(desktop)
      setOpen(desktop)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) return
    setOpen(false)
  }, [pathname, tab])

  const brand = useCompanyBrand(null, { companyCode })
  const companyName = brand.name || 'KaiSync'
  const mobileClosed = !isDesktop && !open
  const showLabels = isDesktop ? open : true
  const desktopCollapsed = isDesktop && !open

  return (
    <div className="flex h-screen overflow-hidden">
      {!isDesktop && open && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'flex flex-col bg-sidebar-bg',
          mobileClosed && 'hidden',
          !isDesktop && open && 'fixed inset-y-0 left-0 z-50 w-72 translate-x-0 shadow-xl',
          isDesktop && 'relative z-auto shrink-0 h-full transition-[width] duration-200',
          isDesktop && (open ? 'w-60' : 'w-16'),
        )}
        aria-hidden={mobileClosed}
      >
        <div
          className={cn(
            'flex items-center h-16 border-b border-white/10 shrink-0',
            showLabels ? 'gap-3 px-4' : 'justify-center px-1',
          )}
        >
          {showLabels ? (
            <>
              <CompanyMark name={companyName} logoUrl={brand.logoUrl} size={32} />
              <div className="flex-1 overflow-hidden min-w-0">
                <p className="text-white text-[13px] font-semibold truncate" title={companyName}>{companyName}</p>
                <p className="text-white/50 text-[11px] truncate">{portalLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="text-white/50 hover:text-white transition-colors shrink-0 w-10 h-10 flex items-center justify-center"
                aria-label={isDesktop ? 'Collapse sidebar' : 'Close menu'}
                title={isDesktop ? 'Collapse sidebar' : 'Close menu'}
              >
                <span className="material-icons text-[20px]">{isDesktop ? 'chevron_left' : 'close'}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-10 h-10 rounded-lg bg-primary/90 hover:bg-primary flex items-center justify-center text-white transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <span className="material-icons text-[22px]">chevron_right</span>
            </button>
          )}
        </div>

        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {items.map(item => {
            const active = isItemActive(item, pathname, tab, defaultTab)
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={() => {
                  if (!isDesktop) setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-3 mx-2 mb-0.5 rounded-lg px-3 h-11 transition-colors group',
                  active ? 'bg-primary/20 text-sidebar-active' : 'text-white/60 hover:text-white hover:bg-white/10',
                  desktopCollapsed && 'justify-center px-0',
                )}
                title={item.label}
              >
                <span className={cn(
                  'material-icons shrink-0 transition-colors text-[20px]',
                  active ? 'text-sidebar-active' : 'text-white/50 group-hover:text-white',
                )}>
                  {item.icon}
                </span>
                {showLabels && (
                  <span className="text-[13px] font-medium truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          {showLabels && (
            <p className="text-[10px] text-white/40 mb-2 flex items-center gap-1">
              <span className="material-icons text-[12px]" aria-hidden="true">bolt</span>
              Powered by KaiSync
            </p>
          )}
          <div className={cn('flex items-center gap-3', desktopCollapsed && 'justify-center')}>
            <div className="w-8 h-8 rounded-full bg-primary-dark flex items-center justify-center shrink-0">
              <span className="text-white text-[12px] font-semibold">{getInitials(displayName)}</span>
            </div>
            {showLabels && (
              <div className="flex-1 overflow-hidden">
                <p className="text-white text-[12px] font-medium truncate">{displayName}</p>
                <p className="text-white/50 text-[11px]">{roleLabel}</p>
              </div>
            )}
            {showLabels && (
              <button
                type="button"
                onClick={onSignOut}
                className="text-white/50 hover:text-white transition-colors"
                title="Sign out"
              >
                <span className="material-icons text-[18px]">logout</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-background">
        {!isDesktop && (
          <div className="flex items-center gap-2 px-3 h-12 border-b border-divider bg-surface shrink-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
              aria-label="Open menu"
            >
              <span className="material-icons text-[22px]">menu</span>
            </button>
            <CompanyMark name={companyName} logoUrl={brand.logoUrl} size={28} />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-text-primary truncate leading-tight">{companyName}</p>
              <p className="text-[11px] text-text-secondary truncate leading-tight">{portalLabel}</p>
            </div>
          </div>
        )}
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>
    </div>
  )
}

function isItemActive(item: PortalNavItem, pathname: string, tab: string | null, defaultTab: string): boolean {
  if (item.activePrefix && (pathname === item.activePrefix || pathname.startsWith(`${item.activePrefix}/`))) {
    return true
  }
  const [path, query] = item.href.split('?')
  if (pathname !== path) return false
  const itemTab = new URLSearchParams(query ?? '').get('tab')
  if (!itemTab) return true
  return (tab ?? defaultTab) === itemTab
}
