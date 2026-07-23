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
import type { Company, Employee } from '@/types/database'

interface NavItem {
  label: string
  href: string
  icon: string
  /** null = always visible */
  flag?: keyof HrNavFlags
  /** Owner-only (MAUI Activity Log) */
  ownerOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/dashboard/overview', icon: 'home' },
  { label: 'My Profile', href: '/dashboard/profile', icon: 'person' },
  { label: 'Messages', href: '/dashboard/messages', icon: 'chat', flag: 'messaging' },
  { label: 'My PA', href: '/dashboard/pa', icon: 'task_alt', flag: 'myPa' },
  { label: 'Employees', href: '/dashboard/employees', icon: 'people', flag: 'employees' },
  { label: 'Jobs', href: '/dashboard/jobs', icon: 'work', flag: 'jobs' },
  { label: 'Contractors', href: '/dashboard/contractors', icon: 'engineering', flag: 'contractors' },
  { label: 'Projects', href: '/dashboard/projects', icon: 'folder', flag: 'projects' },
  { label: 'Clients', href: '/dashboard/clients', icon: 'business', flag: 'clients' },
  { label: 'Incidents', href: '/dashboard/incidents', icon: 'warning', flag: 'incidents' },
  { label: 'Leave', href: '/dashboard/leave', icon: 'event_available', flag: 'leave' },
  { label: 'Attendance', href: '/dashboard/attendance', icon: 'schedule', flag: 'attendance' },
  { label: 'Payroll', href: '/dashboard/payroll', icon: 'payments', flag: 'payroll' },
  { label: 'Finance', href: '/dashboard/finance', icon: 'account_balance', flag: 'finance' },
  { label: 'Suppliers', href: '/dashboard/suppliers', icon: 'storefront', flag: 'suppliers' },
  { label: 'Inventory', href: '/dashboard/inventory', icon: 'inventory_2', flag: 'inventory' },
  { label: 'Assets', href: '/dashboard/assets', icon: 'category', flag: 'assets' },
  { label: 'Compliance Packs', href: '/dashboard/compliance-packs', icon: 'verified', flag: 'compliancePacks' },
  { label: 'Time Templates', href: '/dashboard/time-templates', icon: 'access_time', flag: 'timeTemplates' },
  { label: 'Work Teams', href: '/dashboard/work-teams', icon: 'groups', flag: 'workTeams' },
  { label: 'Scheduling', href: '/dashboard/scheduling', icon: 'calendar_month', flag: 'scheduling' },
  { label: 'Team Punch', href: '/dashboard/team-punch', icon: 'punch_clock', flag: 'teamPunch' },
  { label: 'Properties', href: '/dashboard/properties', icon: 'home_work', flag: 'properties' },
  { label: 'Residents', href: '/dashboard/residents', icon: 'apartment', flag: 'residents' },
  { label: 'Activity Log', href: '/dashboard/activity-log', icon: 'history', ownerOnly: true },
  { label: 'Active Sessions', href: '/dashboard/active-sessions', icon: 'manage_accounts', flag: 'settings' },
  { label: 'Reports', href: '/dashboard/reports', icon: 'bar_chart', flag: 'reports' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'notifications' },
  { label: 'Settings', href: '/dashboard/settings', icon: 'settings', flag: 'settings' },
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

  const items = useMemo(() => {
    if (platformOnly) {
      return [{ label: 'Platform Console', href: '/dashboard/platform', icon: 'admin_panel_settings' }]
    }
    const hr = NAV_ITEMS.filter(item => {
      if (item.ownerOnly) return isOwner
      if (!item.flag) return true
      return Boolean(flags[item.flag])
    })
    if (showPlatform) {
      return [
        { label: 'Platform Console', href: '/dashboard/platform', icon: 'admin_panel_settings' },
        ...hr,
      ]
    }
    return hr
  }, [flags, isOwner, platformOnly, showPlatform])

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
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          'fixed lg:relative inset-y-0 left-0 z-30 flex flex-col bg-sidebar-bg transition-all duration-200 shrink-0',
          open ? 'w-60' : 'w-[64px]'
        )}
      >
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-[18px]">bolt</span>
          </div>
          {open && (
            <div className="flex-1 overflow-hidden">
              <p className="text-white text-[13px] font-semibold truncate">
                {company?.name ?? (platformOnly ? 'KaiSync Platform' : 'KaiSync')}
              </p>
              <p className="text-white/50 text-[11px] truncate">
                {platformOnly ? 'Operator Console' : 'Workforce'}
              </p>
            </div>
          )}
          <button
            onClick={onToggle}
            className="text-white/50 hover:text-white transition-colors ml-auto"
            aria-label="Toggle sidebar"
          >
            <span className="material-icons text-[20px]">
              {open ? 'chevron_left' : 'chevron_right'}
            </span>
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {items.map(item => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 mx-2 mb-0.5 rounded-lg px-3 h-10 transition-colors group',
                  active
                    ? 'bg-primary/20 text-sidebar-active'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                )}
              >
                <span
                  className={cn(
                    'material-icons shrink-0 transition-colors text-[20px]',
                    active ? 'text-sidebar-active' : 'text-white/50 group-hover:text-white'
                  )}
                >
                  {item.icon}
                </span>
                {open && (
                  <span className="text-[13px] font-medium truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </nav>

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
