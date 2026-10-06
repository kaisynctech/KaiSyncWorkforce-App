'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn, getInitials } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  resolveHrNavFlags,
  type HrNavFlags,
} from '@/lib/company-modules'
import { resolveFinanceNavFlag } from '@/lib/finance-gate'
import { loadCompanyWorkspace, clearCompanyWorkspaceCache } from '@/lib/employee-workspace'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { MODULES_UPDATED_EVENT, type ModulesUpdatedDetail } from '@/lib/module-events'
import { PwaInstallButton } from '@/components/PwaInstallButton'
import type { Company, Employee } from '@/types/database'

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: string
  /** undefined = always visible when section is shown */
  flag?: keyof HrNavFlags
  /** Owner-only */
  ownerOnly?: boolean
  /** Optional sub-section label within a module panel */
  group?: string
}

interface NavSection {
  id: string
  label: string
  /** Material Icon name for the top nav tab */
  icon: string
  items: NavItem[]
}

// ─── Nav data ─────────────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workforce',
    label: 'Workforce',
    icon: 'people',
    items: [
      { label: 'Employees',      href: '/dashboard/employees',      icon: 'people',          flag: 'employees' },
      { label: 'Work Teams',     href: '/dashboard/work-teams',     icon: 'groups',          flag: 'workTeams' },
      { label: 'Leave',          href: '/dashboard/leave',          icon: 'event_available', flag: 'leave' },
      { label: 'Attendance',     href: '/dashboard/attendance',     icon: 'schedule',        flag: 'attendance' },
      { label: 'Team Punch',     href: '/dashboard/team-punch',     icon: 'punch_clock',     flag: 'teamPunch' },
      { label: 'Time Templates', href: '/dashboard/time-templates', icon: 'access_time',     flag: 'timeTemplates' },
      { label: 'Scheduling',     href: '/dashboard/scheduling',     icon: 'calendar_month',  flag: 'scheduling' },
      { label: 'Payroll',        href: '/dashboard/payroll',        icon: 'payments',        flag: 'payroll' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: 'work',
    items: [
      { label: 'Clients',          href: '/dashboard/clients',           icon: 'business',    flag: 'clients' },
      { label: 'Projects',         href: '/dashboard/projects',          icon: 'folder',      flag: 'projects' },
      { label: 'Jobs',             href: '/dashboard/jobs',              icon: 'work',        flag: 'jobs' },
      { label: 'Contractors',      href: '/dashboard/contractors',       icon: 'engineering', flag: 'contractors' },
      { label: 'Incidents',        href: '/dashboard/incidents',         icon: 'warning',     flag: 'incidents' },
      { label: 'Compliance Packs', href: '/dashboard/compliance-packs', icon: 'verified',    flag: 'compliancePacks' },
      { label: 'Inventory & Services', href: '/dashboard/inventory',       icon: 'inventory_2', flag: 'inventory' },
      { label: 'Assets',           href: '/dashboard/assets',            icon: 'category',    flag: 'assets' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    icon: 'account_balance_wallet',
    items: [
      { label: 'Finance',           href: '/dashboard/finance',                   icon: 'account_balance', flag: 'finance',    group: 'Finance' },
      { label: 'Quotes',            href: '/dashboard/money/quotes',              icon: 'request_quote',   flag: 'commercial', group: 'Client' },
      { label: 'New quote',         href: '/dashboard/money/quotes/new',          icon: 'add_circle',      flag: 'commercial', group: 'Client' },
      { label: 'Invoices',          href: '/dashboard/money/invoices',            icon: 'receipt_long',    flag: 'commercial', group: 'Client' },
      { label: 'Credit Notes',      href: '/dashboard/money/credit-notes',        icon: 'undo',            flag: 'commercial', group: 'Client' },
      { label: 'Inventory & Services', href: '/dashboard/inventory',               icon: 'inventory_2',     flag: 'commercial', group: 'Client' },
      { label: 'RFQs',              href: '/dashboard/supply/rfqs',               icon: 'compare_arrows',  flag: 'commercial', group: 'Procurement' },
      { label: 'Purchase Orders',   href: '/dashboard/supply/purchase-orders',    icon: 'shopping_cart',   flag: 'commercial', group: 'Procurement' },
      { label: 'Goods Received',    href: '/dashboard/supply/goods-received',     icon: 'local_shipping',  flag: 'commercial', group: 'Procurement' },
      { label: 'Supplier Invoices', href: '/dashboard/finance/supplier-invoices', icon: 'receipt',         flag: 'commercial', group: 'Procurement' },
      { label: 'Suppliers',         href: '/dashboard/supply/suppliers',          icon: 'storefront',      flag: 'commercial', group: 'Procurement' },
    ],
  },
  {
    id: 'properties',
    label: 'Properties',
    icon: 'home_work',
    items: [
      { label: 'Properties', href: '/dashboard/properties', icon: 'home_work', flag: 'properties' },
      { label: 'Residents',  href: '/dashboard/residents',  icon: 'apartment', flag: 'residents' },
      { label: 'Student accommodations', href: '/dashboard/student-accommodations', icon: 'school', flag: 'properties' },
      { label: 'B&B / Guest house', href: '/dashboard/guest-houses', icon: 'hotel', flag: 'properties' },
      { label: 'Rent arrears', href: '/dashboard/properties/arrears', icon: 'money_off', flag: 'properties' },
    ],
  },
  {
    id: 'farms',
    label: 'Farms',
    icon: 'agriculture',
    items: [
      { label: 'Farms',     href: '/dashboard/farms',           icon: 'agriculture', flag: 'farms' },
      { label: 'Livestock', href: '/dashboard/farms/livestock', icon: 'pets',        flag: 'farms' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: 'bar_chart',
    items: [
      { label: 'Reports',               href: '/dashboard/reports',                       icon: 'bar_chart',   flag: 'reports' },
      { label: 'Project Profitability', href: '/dashboard/reports/project-profitability', icon: 'trending_up', flag: 'reports' },
    ],
  },
]

/** Initial flags from company modules — never flash opt-in modules (farms) as on. */
function flagsFromCompany(company: Company | null | undefined, finance = false): HrNavFlags {
  return resolveHrNavFlags(company?.enabled_modules ?? {}, finance)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function itemVisible(item: NavItem, flags: HrNavFlags, isOwner: boolean): boolean {
  if (item.ownerOnly) return isOwner
  if (!item.flag) return true
  return Boolean(flags[item.flag])
}

function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavTopBtn({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-1.5 px-3 text-[12px] border-b-2 transition-colors self-stretch whitespace-nowrap',
        active
          ? 'border-[#3B5CF6] text-white font-medium bg-[#3B5CF6]/15'
          : 'border-transparent text-white/45 hover:text-white/85 hover:bg-white/7',
      )}
    >
      <span className="material-icons text-[15px]">{icon}</span>
      {label}
    </Link>
  )
}

function NavIconBtn({
  href,
  icon,
  label,
  active,
}: {
  href: string
  icon: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center justify-center w-11 h-12 lg:w-8 lg:h-8 my-auto rounded-md transition-colors',
        active
          ? 'bg-[#3B5CF6]/18 text-[#3B5CF6]'
          : 'text-white/50 hover:text-white/90 hover:bg-white/8',
      )}
    >
      <span className="material-icons text-[20px] lg:text-[18px]">{icon}</span>
    </Link>
  )
}

function PanelItems({
  items,
  flags,
  isOwner,
  pathname,
  collapsed,
  onNavigate,
}: {
  items: NavItem[]
  flags: HrNavFlags
  isOwner: boolean
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const visible = items.filter(item => itemVisible(item, flags, isOwner))
  if (visible.length === 0) return null

  // Group items by their `group` property
  const groups: { label: string | null; items: NavItem[] }[] = []
  for (const item of visible) {
    const g = item.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.label === g) {
      last.items.push(item)
    } else {
      groups.push({ label: g, items: [item] })
    }
  }

  return (
    <>
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && !collapsed && (
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-secondary px-3 pt-3 pb-1">
              {group.label}
            </p>
          )}
          {group.items.map(item => {
            const active = isItemActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-2 mx-1 mb-0.5 rounded-md transition-colors',
                  collapsed ? 'justify-center px-0 py-2.5 lg:py-2' : 'px-2 py-2.5 lg:py-1.5',
                  active
                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary rounded-l-none'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated',
                )}
              >
                <span
                  className={cn(
                    'material-icons shrink-0',
                    collapsed ? 'text-[18px]' : 'text-[18px] lg:text-[16px]',
                  )}
                >
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="text-[13px] lg:text-[12px] truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SidebarProps {
  open: boolean
  onToggle: () => void
  onClose?: () => void
  company: Company | null
  employee: Employee | null
  /** JWT platform admin with no employee row */
  platformOnly?: boolean
}

export default function Sidebar({
  open,
  onToggle,
  onClose,
  company,
  employee,
  platformOnly = false,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [flags, setFlags] = useState<HrNavFlags>(() => flagsFromCompany(company))
  const [showPlatform, setShowPlatform] = useState(platformOnly)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    setAccountOpen(false)
    if (!isDesktop) onClose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (!accountOpen) return
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t?.closest('[data-account-menu]')) return
      setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [accountOpen])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      if (platformOnly) {
        if (!cancelled) setShowPlatform(true)
        return
      }
      if (!company?.id) {
        const adminOnly = await isPlatformAdmin(supabase)
        if (!cancelled) {
          setShowPlatform(adminOnly)
          setFlags(flagsFromCompany(null))
        }
        return
      }

      // Paint nav from layout company immediately; load admin + workspace in parallel.
      if (company.enabled_modules != null) {
        setFlags(flagsFromCompany(company))
      }

      const [admin, workspace] = await Promise.all([
        isPlatformAdmin(supabase),
        loadCompanyWorkspace(supabase, company.id),
      ])
      if (cancelled) return
      setShowPlatform(admin)
      const modules = workspace?.enabled_modules ?? company.enabled_modules ?? {}
      const { finance } = await resolveFinanceNavFlag(supabase, company.id, modules)
      if (!cancelled) setFlags(resolveHrNavFlags(modules, finance))
    }
    void load()
    return () => { cancelled = true }
  }, [company?.id, company?.enabled_modules, platformOnly])

  useEffect(() => {
    function onModulesUpdated(ev: Event) {
      const detail = (ev as CustomEvent<ModulesUpdatedDetail>).detail
      if (!detail || detail.companyId !== company?.id) return
      clearCompanyWorkspaceCache(detail.companyId)
      void (async () => {
        const supabase = createClient()
        const { finance } = await resolveFinanceNavFlag(supabase, detail.companyId, detail.enabledModules)
        setFlags(resolveHrNavFlags(detail.enabledModules, finance))
      })()
    }
    window.addEventListener(MODULES_UPDATED_EVENT, onModulesUpdated)
    return () => window.removeEventListener(MODULES_UPDATED_EVENT, onModulesUpdated)
  }, [company?.id])

  const isOwner = (employee?.access_level ?? '').toLowerCase() === 'owner'

  const sections = useMemo(() => {
    if (platformOnly) return [] as NavSection[]
    return NAV_SECTIONS
      .map(section => ({
        ...section,
        items: section.items.filter(item => itemVisible(item, flags, isOwner)),
      }))
      .filter(section => section.items.length > 0)
  }, [flags, isOwner, platformOnly])

  // Which section is currently active (drives which top tab is highlighted and panel content)
  const activeSection = useMemo(() => {
    return sections.find(section =>
      section.items.some(item => isItemActive(pathname, item.href))
    ) ?? null
  }, [pathname, sections])

  // Sync CSS variable so main content can adjust left padding (0 on phones — panel is a drawer).
  useEffect(() => {
    const apply = () => {
      const desktop = window.matchMedia('(min-width: 1024px)').matches
      const w = !desktop
        ? 0
        : activeSection
          ? (panelCollapsed ? 44 : 176)
          : 0
      document.documentElement.style.setProperty('--sidebar-panel-w', `${w}px`)
    }
    apply()
    const mq = window.matchMedia('(min-width: 1024px)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [activeSection, panelCollapsed])

  async function handleSignOut() {
    const supabase = createClient()
    const { revokeCodeSession } = await import('@/lib/auth/session')
    const { clearAllAuthLocalState } = await import('@/lib/auth/code-session')
    await revokeCodeSession(supabase)
    await supabase.auth.signOut()
    clearAllAuthLocalState()
    router.push('/auth/id-entry')
    router.refresh()
  }

  const displayName = employee
    ? `${employee.name} ${employee.surname}`
    : platformOnly
      ? 'Platform Operator'
      : 'Unknown'
  const roleLabel = employee?.access_level
    ? employee.access_level.charAt(0).toUpperCase() + employee.access_level.slice(1)
    : platformOnly
      ? 'Platform Admin'
      : ''

  const showMobileDrawer = open && !isDesktop
  const desktopPanel = Boolean(activeSection && !platformOnly)

  return (
    <>
      {/* ── TOP NAV BAR ─────────────────────────────────────────────── */}
      <header className="flex items-stretch h-12 lg:h-[42px] shrink-0 bg-[#0C111D] border-b border-white/8 z-30 overflow-x-auto">

        <button
          type="button"
          onClick={onToggle}
          className="lg:hidden flex items-center justify-center w-11 h-12 shrink-0 text-white/80 hover:text-white hover:bg-white/10"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <span className="material-icons text-[22px]">{open ? 'close' : 'menu'}</span>
        </button>

        {/* Logo + company name */}
        <div className="flex items-center gap-2 px-3 border-r border-white/10 shrink-0">
          <div className="w-7 h-7 lg:w-6 lg:h-6 rounded-md bg-[#3B5CF6] flex items-center justify-center">
            <span className="material-icons text-white text-[14px]">bolt</span>
          </div>
          <span className="text-[12px] font-semibold text-white truncate max-w-[120px]">
            {company?.name ?? (platformOnly ? 'KaiSync Platform' : 'KaiSync')}
          </span>
        </div>

        {/* ── Left text tabs: Overview, My PA, Messages ── */}
        <NavTopBtn
          href="/dashboard/overview"
          icon="home"
          label="Overview"
          active={!activeSection && isItemActive(pathname, '/dashboard/overview')}
        />
        {!platformOnly && (
          <>
            {itemVisible({ label: 'My PA', href: '/dashboard/pa', icon: 'task_alt', flag: 'myPa' }, flags, isOwner) && (
              <NavTopBtn
                href="/dashboard/pa"
                icon="task_alt"
                label="My PA"
                active={isItemActive(pathname, '/dashboard/pa')}
              />
            )}
            {itemVisible({ label: 'Messages', href: '/dashboard/messages', icon: 'chat', flag: 'messaging' }, flags, isOwner) && (
              <NavTopBtn
                href="/dashboard/messages"
                icon="chat"
                label="Messages"
                active={isItemActive(pathname, '/dashboard/messages')}
              />
            )}
          </>
        )}

        {/* Divider between left tabs and module tabs */}
        <div className="w-px bg-white/10 mx-2 self-stretch shrink-0" />

        {/* ── Module tabs (desktop / scroll on phone) ── */}
        <div className="hidden sm:contents">
          {!platformOnly && sections.map(section => (
            <NavTopBtn
              key={section.id}
              href={section.items[0]?.href ?? '#'}
              icon={section.icon}
              label={section.label}
              active={activeSection?.id === section.id}
            />
          ))}
          {showPlatform && (
            <NavTopBtn
              href="/dashboard/platform"
              icon="admin_panel_settings"
              label="Platform"
              active={isItemActive(pathname, '/dashboard/platform')}
            />
          )}
        </div>

        <div className="flex-1" />

        {/* ── Right icon buttons: Notifications, Settings ── */}
        {!platformOnly && (
          <>
            <NavIconBtn
              href="/dashboard/notifications"
              icon="notifications"
              label="Notifications"
              active={isItemActive(pathname, '/dashboard/notifications')}
            />
            {itemVisible({ label: 'Settings', href: '/dashboard/settings', icon: 'settings', flag: 'settings' }, flags, isOwner) && (
              <NavIconBtn
                href="/dashboard/settings"
                icon="settings"
                label="Settings"
                active={isItemActive(pathname, '/dashboard/settings')}
              />
            )}
          </>
        )}

        {/* Avatar + tap dropdown */}
        <div className="flex items-center px-2 sm:px-3 border-l border-white/10 ml-1" data-account-menu>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen(v => !v)}
              className="w-9 h-9 lg:w-7 lg:h-7 rounded-full bg-[#3B5CF6] flex items-center justify-center text-white text-[11px] font-semibold"
              title={displayName}
              aria-label="Account menu"
              aria-expanded={accountOpen}
            >
              {getInitials(displayName)}
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-divider rounded-lg shadow-lg z-50">
                <div className="px-3 py-2 border-b border-divider">
                  <p className="text-[12px] font-medium text-text-primary truncate">{displayName}</p>
                  <p className="text-[11px] text-text-secondary">{roleLabel}</p>
                </div>
                <Link
                  href="/dashboard/profile"
                  onClick={() => setAccountOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                >
                  <span className="material-icons text-[18px]">person</span>
                  My Profile
                </Link>
                <Link
                  href="/dashboard/active-sessions"
                  onClick={() => setAccountOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                >
                  <span className="material-icons text-[18px]">manage_accounts</span>
                  Active Sessions
                </Link>
                {isOwner && (
                  <Link
                    href="/dashboard/activity-log"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                  >
                    <span className="material-icons text-[18px]">history</span>
                    Activity Log
                  </Link>
                )}
                <div className="border-t border-divider" />
                {!platformOnly && itemVisible({ label: 'Settings', href: '/dashboard/settings', icon: 'settings', flag: 'settings' }, flags, isOwner) && (
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                  >
                    <span className="material-icons text-[18px]">settings</span>
                    Settings
                  </Link>
                )}
                <PwaInstallButton
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                />
                <div className="border-t border-divider" />
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                >
                  <span className="material-icons text-[18px]">logout</span>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile drawer backdrop */}
      {showMobileDrawer && (
        <div
          className="fixed inset-0 top-12 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      {/* ── LEFT PANEL (desktop fixed / phone drawer) ───────────────── */}
      {(desktopPanel || showMobileDrawer) && !platformOnly && (
        <aside
          className={cn(
            'fixed top-12 lg:top-[42px] left-0 bottom-0 flex flex-col shrink-0 bg-surface border-r border-divider overflow-hidden transition-transform duration-200 z-50',
            'w-72 lg:transition-[width]',
            showMobileDrawer ? 'translate-x-0' : 'max-lg:-translate-x-full',
            desktopPanel ? 'lg:translate-x-0' : 'lg:-translate-x-full',
            panelCollapsed ? 'lg:w-11' : 'lg:w-44',
          )}
        >
          <div className="flex items-center justify-between px-2 pt-2 pb-1 shrink-0">
            {(!panelCollapsed || !isDesktop) && (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary px-1">
                {activeSection?.label ?? 'Menu'}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (!isDesktop) onClose?.()
                else setPanelCollapsed(v => !v)
              }}
              className={cn(
                'w-9 h-9 lg:w-7 lg:h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors',
                panelCollapsed && isDesktop && 'mx-auto',
              )}
              title={isDesktop ? (panelCollapsed ? 'Expand panel' : 'Collapse panel') : 'Close menu'}
            >
              <span className="material-icons text-[18px] lg:text-[16px]">
                {isDesktop ? (panelCollapsed ? 'chevron_right' : 'chevron_left') : 'close'}
              </span>
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            {/* On phone: show all modules when no section, or section items + module switcher */}
            {!isDesktop && (
              <div className="px-2 pb-2 mb-2 border-b border-divider space-y-0.5">
                <Link
                  href="/dashboard/overview"
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 h-11 text-[13px]',
                    isItemActive(pathname, '/dashboard/overview') && !activeSection
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-text-secondary hover:bg-surface-elevated',
                  )}
                >
                  <span className="material-icons text-[20px]">home</span>
                  Overview
                </Link>
                {sections.map(section => (
                  <Link
                    key={section.id}
                    href={section.items[0]?.href ?? '#'}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 h-11 text-[13px]',
                      activeSection?.id === section.id
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-text-secondary hover:bg-surface-elevated',
                    )}
                  >
                    <span className="material-icons text-[20px]">{section.icon}</span>
                    {section.label}
                  </Link>
                ))}
                {showPlatform && (
                  <Link
                    href="/dashboard/platform"
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 h-11 text-[13px]',
                      isItemActive(pathname, '/dashboard/platform')
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-text-secondary hover:bg-surface-elevated',
                    )}
                  >
                    <span className="material-icons text-[20px]">admin_panel_settings</span>
                    Platform
                  </Link>
                )}
              </div>
            )}

            {activeSection && (
              <PanelItems
                items={activeSection.items}
                flags={flags}
                isOwner={isOwner}
                pathname={pathname}
                collapsed={isDesktop && panelCollapsed}
                onNavigate={onClose}
              />
            )}
          </nav>
        </aside>
      )}
    </>
  )
}
