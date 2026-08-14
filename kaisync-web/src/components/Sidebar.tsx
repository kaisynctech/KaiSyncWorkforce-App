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
import { loadCompanyWorkspace } from '@/lib/employee-workspace'
import { isPlatformAdmin } from '@/lib/platform-admin'
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

const ALL_HR_FLAGS: HrNavFlags = {
  employees: true,
  leave: true,
  attendance: true,
  jobs: true,
  projects: true,
  payroll: true,
  contractors: true,
  clients: true,
  inventory: true,
  suppliers: true,
  assets: true,
  properties: true,
  incidents: true,
  reports: true,
  scheduling: true,
  myPa: true,
  workTeams: true,
  messaging: true,
  settings: true,
  compliancePacks: true,
  timeTemplates: true,
  teamPunch: true,
  residents: true,
  finance: true,
  commercial: true,
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
          ? 'border-primary text-primary bg-primary/10 font-medium'
          : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-elevated',
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
        'flex items-center justify-center w-8 h-8 my-auto rounded-md transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated',
      )}
    >
      <span className="material-icons text-[18px]">{icon}</span>
    </Link>
  )
}

function PanelItems({
  items,
  flags,
  isOwner,
  pathname,
  collapsed,
}: {
  items: NavItem[]
  flags: HrNavFlags
  isOwner: boolean
  pathname: string
  collapsed: boolean
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
                className={cn(
                  'flex items-center gap-2 mx-1 mb-0.5 rounded-md transition-colors',
                  collapsed ? 'justify-center px-0 py-2' : 'px-2 py-1.5',
                  active
                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary rounded-l-none'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated',
                )}
              >
                <span
                  className={cn(
                    'material-icons shrink-0',
                    collapsed ? 'text-[18px]' : 'text-[16px]',
                  )}
                >
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="text-[12px] truncate">{item.label}</span>
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
  company: Company | null
  employee: Employee | null
  /** JWT platform admin with no employee row */
  platformOnly?: boolean
}

export default function Sidebar({ company, employee, platformOnly = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [flags, setFlags] = useState<HrNavFlags>(ALL_HR_FLAGS)
  const [showPlatform, setShowPlatform] = useState(platformOnly)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      if (platformOnly) {
        if (!cancelled) setShowPlatform(true)
        return
      }
      const admin = await isPlatformAdmin(supabase)
      if (!cancelled) setShowPlatform(admin)

      if (!company?.id) return
      const workspace = await loadCompanyWorkspace(supabase, company.id)
      const { finance } = await resolveFinanceNavFlag(
        supabase,
        company.id,
        workspace?.enabled_modules,
      )
      if (!cancelled) setFlags(resolveHrNavFlags(workspace?.enabled_modules, finance))
    }
    void load()
    return () => { cancelled = true }
  }, [company?.id, platformOnly])

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

  // Sync CSS variable so main content can adjust left padding
  const panelWidth = activeSection
    ? (panelCollapsed ? 44 : 176)
    : 0
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-panel-w', `${panelWidth}px`)
  }, [panelWidth])

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

  return (
    <>
      {/* ── TOP NAV BAR ─────────────────────────────────────────────── */}
      <header className="flex items-stretch h-[42px] shrink-0 bg-surface border-b border-divider z-30">

        {/* Logo + company name */}
        <div className="flex items-center gap-2 px-3 border-r border-divider shrink-0">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
            <span className="material-icons text-white text-[14px]">bolt</span>
          </div>
          <span className="text-[12px] font-semibold text-text-primary truncate max-w-[120px]">
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
        <div className="w-px bg-divider mx-2 self-stretch shrink-0" />

        {/* ── Module tabs ── */}
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

        {/* Avatar + dropdown */}
        <div className="flex items-center px-3 border-l border-divider ml-1">
          <div className="relative group">
            <button
              className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-[11px] font-semibold"
              title={displayName}
              aria-label="Account menu"
            >
              {getInitials(displayName)}
            </button>
            {/* Dropdown — visible on hover / focus-within */}
            <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-divider rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
              <div className="px-3 py-2 border-b border-divider">
                <p className="text-[12px] font-medium text-text-primary truncate">{displayName}</p>
                <p className="text-[11px] text-text-secondary">{roleLabel}</p>
              </div>
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
              >
                <span className="material-icons text-[16px]">person</span>
                My Profile
              </Link>
              <Link
                href="/dashboard/active-sessions"
                className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
              >
                <span className="material-icons text-[16px]">manage_accounts</span>
                Active Sessions
              </Link>
              {isOwner && (
                <Link
                  href="/dashboard/activity-log"
                  className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                >
                  <span className="material-icons text-[16px]">history</span>
                  Activity Log
                </Link>
              )}
              <div className="border-t border-divider" />
              {!platformOnly && itemVisible({ label: 'Settings', href: '/dashboard/settings', icon: 'settings', flag: 'settings' }, flags, isOwner) && (
                <Link
                  href="/dashboard/settings"
                  className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
                >
                  <span className="material-icons text-[16px]">settings</span>
                  Settings
                </Link>
              )}
              <PwaInstallButton
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
              />
              <div className="border-t border-divider" />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
              >
                <span className="material-icons text-[16px]">logout</span>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── LEFT PANEL ──────────────────────────────────────────────── */}
      {activeSection && !platformOnly && (
        <aside
          className={cn(
            'fixed top-[42px] left-0 bottom-0 flex flex-col shrink-0 bg-surface border-r border-divider overflow-hidden transition-all duration-200 z-20',
            panelCollapsed ? 'w-11' : 'w-44',
          )}
        >
          {/* Panel header — module name + collapse toggle */}
          <div className="flex items-center justify-between px-2 pt-2 pb-1 shrink-0">
            {!panelCollapsed && (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary px-1">
                {activeSection.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => setPanelCollapsed(v => !v)}
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors',
                panelCollapsed && 'mx-auto',
              )}
              title={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
            >
              <span className="material-icons text-[16px]">
                {panelCollapsed ? 'chevron_right' : 'chevron_left'}
              </span>
            </button>
          </div>

          {/* Panel items — grouped by item.group when present */}
          <nav className="flex-1 overflow-y-auto py-1">
            <PanelItems
              items={activeSection.items}
              flags={flags}
              isOwner={isOwner}
              pathname={pathname}
              collapsed={panelCollapsed}
            />
          </nav>
        </aside>
      )}
    </>
  )
}
