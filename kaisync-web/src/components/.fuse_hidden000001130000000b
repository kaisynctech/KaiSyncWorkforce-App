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

interface NavItem {
  label: string
  href: string
  icon: string
  /** undefined = always visible when section is shown */
  flag?: keyof HrNavFlags
  /** Owner-only (MAUI Activity Log) */
  ownerOnly?: boolean
}

interface NavSection {
  id: string
  label: string
  items: NavItem[]
}

const NAV_STORAGE_KEY = 'kf_hr_nav_sections_v1'

/** Always visible at top (not inside a collapsible group). */
const PINNED_TOP: NavItem[] = [
  { label: 'Overview', href: '/dashboard/overview', icon: 'home' },
  { label: 'My PA', href: '/dashboard/pa', icon: 'task_alt', flag: 'myPa' },
  { label: 'Messages', href: '/dashboard/messages', icon: 'chat', flag: 'messaging' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'notifications' },
]

/** Always visible above the account footer. */
const PINNED_BOTTOM: NavItem[] = [
  { label: 'Settings', href: '/dashboard/settings', icon: 'settings', flag: 'settings' },
]

/**
 * Recommended IA — same routes/flags as before, only presentation grouping.
 * Module gating still applied per-item via HrNavFlags.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workforce',
    label: 'Workforce',
    items: [
      { label: 'Employees', href: '/dashboard/employees', icon: 'people', flag: 'employees' },
      { label: 'Work Teams', href: '/dashboard/work-teams', icon: 'groups', flag: 'workTeams' },
      { label: 'Leave', href: '/dashboard/leave', icon: 'event_available', flag: 'leave' },
      { label: 'Attendance', href: '/dashboard/attendance', icon: 'schedule', flag: 'attendance' },
      { label: 'Team Punch', href: '/dashboard/team-punch', icon: 'punch_clock', flag: 'teamPunch' },
      { label: 'Time Templates', href: '/dashboard/time-templates', icon: 'access_time', flag: 'timeTemplates' },
      { label: 'Scheduling', href: '/dashboard/scheduling', icon: 'calendar_month', flag: 'scheduling' },
      { label: 'Payroll', href: '/dashboard/payroll', icon: 'payments', flag: 'payroll' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { label: 'Clients', href: '/dashboard/clients', icon: 'business', flag: 'clients' },
      { label: 'Projects', href: '/dashboard/projects', icon: 'folder', flag: 'projects' },
      { label: 'Jobs', href: '/dashboard/jobs', icon: 'work', flag: 'jobs' },
      { label: 'Contractors', href: '/dashboard/contractors', icon: 'engineering', flag: 'contractors' },
      { label: 'Incidents', href: '/dashboard/incidents', icon: 'warning', flag: 'incidents' },
      { label: 'Compliance Packs', href: '/dashboard/compliance-packs', icon: 'verified', flag: 'compliancePacks' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    items: [
      { label: 'Finance', href: '/dashboard/finance', icon: 'account_balance', flag: 'finance' },
    ],
  },
  {
    id: 'supply',
    label: 'Supply & Assets',
    items: [
      { label: 'Suppliers', href: '/dashboard/suppliers', icon: 'storefront', flag: 'suppliers' },
      { label: 'Inventory', href: '/dashboard/inventory', icon: 'inventory_2', flag: 'inventory' },
      { label: 'Assets', href: '/dashboard/assets', icon: 'category', flag: 'assets' },
    ],
  },
  {
    id: 'properties',
    label: 'Properties',
    items: [
      { label: 'Properties', href: '/dashboard/properties', icon: 'home_work', flag: 'properties' },
      { label: 'Residents', href: '/dashboard/residents', icon: 'apartment', flag: 'residents' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { label: 'Reports', href: '/dashboard/reports', icon: 'bar_chart', flag: 'reports' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { label: 'My Profile', href: '/dashboard/profile', icon: 'person' },
      { label: 'Active Sessions', href: '/dashboard/active-sessions', icon: 'manage_accounts', flag: 'settings' },
      { label: 'Activity Log', href: '/dashboard/activity-log', icon: 'history', ownerOnly: true },
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
}

function itemVisible(item: NavItem, flags: HrNavFlags, isOwner: boolean): boolean {
  if (item.ownerOnly) return isOwner
  if (!item.flag) return true
  return Boolean(flags[item.flag])
}

function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function readStoredOpen(): Record<string, boolean> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, boolean>
  } catch {
    return null
  }
}

function writeStoredOpen(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(state))
  } catch { /* ignore quota */ }
}

interface SidebarProps {
  open: boolean
  onToggle: () => void
  company: Company | null
  employee: Employee | null
  /** JWT platform admin with no employee row (MAUI Platform Console parity) */
  platformOnly?: boolean
}

export default function Sidebar({ open, onToggle, company, employee, platformOnly = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [flags, setFlags] = useState<HrNavFlags>(ALL_HR_FLAGS)
  const [showPlatform, setShowPlatform] = useState(platformOnly)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

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

  const pinnedTop = useMemo(() => {
    if (platformOnly) return [] as NavItem[]
    const list = PINNED_TOP.filter(item => itemVisible(item, flags, isOwner))
    if (showPlatform) {
      return [
        { label: 'Platform Console', href: '/dashboard/platform', icon: 'admin_panel_settings' },
        ...list,
      ]
    }
    return list
  }, [flags, isOwner, platformOnly, showPlatform])

  const pinnedBottom = useMemo(() => {
    if (platformOnly) return [] as NavItem[]
    return PINNED_BOTTOM.filter(item => itemVisible(item, flags, isOwner))
  }, [flags, isOwner, platformOnly])

  const sections = useMemo(() => {
    if (platformOnly) return [] as { id: string; label: string; items: NavItem[] }[]
    return NAV_SECTIONS
      .map(section => ({
        ...section,
        items: section.items.filter(item => itemVisible(item, flags, isOwner)),
      }))
      .filter(section => section.items.length > 0)
  }, [flags, isOwner, platformOnly])

  const platformOnlyItems = useMemo(() => {
    if (!platformOnly) return [] as NavItem[]
    return [{ label: 'Platform Console', href: '/dashboard/platform', icon: 'admin_panel_settings' }]
  }, [platformOnly])

  // Initialise / sync open state: restore storage, always force-open section for active route
  useEffect(() => {
    if (platformOnly) return
    const stored = readStoredOpen() ?? {}
    const next: Record<string, boolean> = { ...stored }
    let changed = false
    for (const section of sections) {
      if (next[section.id] === undefined) {
        next[section.id] = false
        changed = true
      }
      const hasActive = section.items.some(item => isItemActive(pathname, item.href))
      if (hasActive && !next[section.id]) {
        next[section.id] = true
        changed = true
      }
    }
    setOpenSections(prev => {
      const same =
        sections.every(s => Boolean(prev[s.id]) === Boolean(next[s.id]))
        && Object.keys(prev).length === Object.keys(next).length
      return same ? prev : next
    })
    if (changed) writeStoredOpen(next)
  }, [pathname, sections, platformOnly])

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] }
      writeStoredOpen(next)
      return next
    })
  }

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

  function renderLink(item: NavItem) {
    const active = isItemActive(pathname, item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        title={!open ? item.label : undefined}
        className={cn(
          'flex items-center gap-3 mx-2 mb-0.5 rounded-lg px-3 h-10 transition-colors group',
          active
            ? 'bg-primary/20 text-sidebar-active'
            : 'text-white/60 hover:text-white hover:bg-white/10',
        )}
      >
        <span
          className={cn(
            'material-icons shrink-0 transition-colors text-[20px]',
            active ? 'text-sidebar-active' : 'text-white/50 group-hover:text-white',
          )}
        >
          {item.icon}
        </span>
        {open && (
          <span className="text-[13px] font-medium truncate">{item.label}</span>
        )}
      </Link>
    )
  }

  // Icon-only rail: scrollable destinations only — Settings stays in sticky bottom pin
  const flatRailItems = useMemo(() => {
    if (platformOnly) return platformOnlyItems
    return [
      ...pinnedTop,
      ...sections.flatMap(s => s.items),
    ]
  }, [platformOnly, platformOnlyItems, pinnedTop, sections])

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          'fixed lg:relative inset-y-0 left-0 z-30 flex flex-col bg-sidebar-bg transition-all duration-200 shrink-0',
          open ? 'w-60' : 'w-[64px]',
        )}
      >
        <div
          className={cn(
            'flex items-center h-16 border-b border-white/10 shrink-0',
            open ? 'gap-3 px-4' : 'justify-center px-1',
          )}
        >
          {open ? (
            <>
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <span className="material-icons text-white text-[18px]">bolt</span>
              </div>
              <div className="flex-1 overflow-hidden min-w-0">
                <p className="text-white text-[13px] font-semibold truncate">
                  {company?.name ?? (platformOnly ? 'KaiSync Platform' : 'KaiSync')}
                </p>
                <p className="text-white/50 text-[11px] truncate">
                  {platformOnly ? 'Operator Console' : 'Workforce'}
                </p>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="text-white/50 hover:text-white transition-colors shrink-0"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <span className="material-icons text-[20px]">chevron_left</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              className="w-10 h-10 rounded-lg bg-primary/90 hover:bg-primary flex items-center justify-center text-white transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <span className="material-icons text-[22px]">chevron_right</span>
            </button>
          )}
        </div>

        <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
          {platformOnly ? (
            platformOnlyItems.map(renderLink)
          ) : !open ? (
            flatRailItems.map(renderLink)
          ) : (
            <>
              {pinnedTop.map(renderLink)}

              {sections.map(section => {
                const expanded = Boolean(openSections[section.id])
                const sectionActive = section.items.some(item => isItemActive(pathname, item.href))
                return (
                  <div key={section.id} className="mt-2">
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={expanded}
                      className={cn(
                        'flex w-[calc(100%-16px)] items-center gap-2 mx-2 mb-0.5 rounded-lg px-3 h-8 transition-colors',
                        sectionActive
                          ? 'text-white/80'
                          : 'text-white/40 hover:text-white/70 hover:bg-white/5',
                      )}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] flex-1 text-left truncate">
                        {section.label}
                      </span>
                      <span className="material-icons text-[16px] shrink-0 opacity-70">
                        {expanded ? 'expand_more' : 'chevron_right'}
                      </span>
                    </button>
                    <div
                      className={cn(
                        'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
                        expanded ? 'max-h-[520px] opacity-100' : 'max-h-0 opacity-0',
                      )}
                    >
                      {section.items.map(renderLink)}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </nav>

        {!platformOnly && pinnedBottom.length > 0 && (
          <div className={cn('border-t border-white/10 py-2', !open && 'px-0')}>
            {pinnedBottom.map(renderLink)}
          </div>
        )}

        <div className={cn('px-2 pb-1', !open && 'flex justify-center')}>
          <PwaInstallButton
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 h-9 text-[12px] font-medium transition-colors',
              'text-white/55 hover:text-white hover:bg-white/10',
              !open && 'px-2',
            )}
          />
        </div>

        <div className="border-t border-white/10 p-3">
          <div className={cn('flex items-center gap-3', !open && 'justify-center')}>
            <div className="w-8 h-8 rounded-full bg-primary-dark flex items-center justify-center shrink-0">
              <span className="text-white text-[12px] font-semibold">
                {getInitials(displayName)}
              </span>
            </div>
            {open && (
              <div className="flex-1 overflow-hidden">
                <p className="text-white text-[12px] font-medium truncate">{displayName}</p>
                <p className="text-white/50 text-[11px]">{roleLabel}</p>
              </div>
            )}
            {open && (
              <button
                onClick={handleSignOut}
                className="text-white/50 hover:text-white transition-colors"
                title="Sign out"
              >
                <span className="material-icons text-[18px]">logout</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
