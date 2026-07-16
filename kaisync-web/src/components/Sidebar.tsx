'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn, getInitials } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { Company, Employee } from '@/types/database'

interface NavItem {
  label: string
  href: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview',      href: '/dashboard/overview',      icon: 'home' },
  { label: 'My Profile',   href: '/dashboard/profile',       icon: 'person' },
  { label: 'Messages',     href: '/dashboard/messages',      icon: 'chat' },
  { label: 'Employees',    href: '/dashboard/employees',     icon: 'people' },
  { label: 'Jobs',          href: '/dashboard/jobs',          icon: 'work' },
  { label: 'Contractors',   href: '/dashboard/contractors',   icon: 'engineering' },
  { label: 'Projects',      href: '/dashboard/projects',      icon: 'folder' },
  { label: 'Clients',       href: '/dashboard/clients',       icon: 'business' },
  { label: 'Incidents',     href: '/dashboard/incidents',     icon: 'warning' },
  { label: 'Leave',         href: '/dashboard/leave',         icon: 'event_available' },
  { label: 'Attendance',    href: '/dashboard/attendance',    icon: 'schedule' },
  { label: 'Payroll',           href: '/dashboard/payroll',           icon: 'payments' },
  { label: 'Suppliers',         href: '/dashboard/suppliers',         icon: 'storefront' },
  { label: 'Inventory',         href: '/dashboard/inventory',         icon: 'inventory_2' },
  { label: 'Assets',            href: '/dashboard/assets',            icon: 'category' },
  { label: 'Compliance Packs',  href: '/dashboard/compliance-packs',  icon: 'verified' },
  { label: 'Time Templates',    href: '/dashboard/time-templates',    icon: 'access_time' },
  { label: 'Work Teams',        href: '/dashboard/work-teams',        icon: 'groups' },
  { label: 'Scheduling',        href: '/dashboard/scheduling',        icon: 'calendar_month' },
  { label: 'Team Punch',        href: '/dashboard/team-punch',        icon: 'punch_clock' },
  { label: 'Properties',        href: '/dashboard/properties',        icon: 'home_work' },
  { label: 'Residents',         href: '/dashboard/residents',         icon: 'apartment' },
  { label: 'Activity Log',      href: '/dashboard/activity-log',      icon: 'history' },
  { label: 'Active Sessions',   href: '/dashboard/active-sessions',   icon: 'manage_accounts' },
  { label: 'Reports',           href: '/dashboard/reports',           icon: 'bar_chart' },
  { label: 'Notifications',     href: '/dashboard/notifications',     icon: 'notifications' },
  { label: 'Settings',          href: '/dashboard/settings',          icon: 'settings' },
]

interface SidebarProps {
  open: boolean
  onToggle: () => void
  company: Company | null
  employee: Employee | null
}

export default function Sidebar({ open, onToggle, company, employee }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/hr-sign-in')
    router.refresh()
  }

  const displayName = employee
    ? `${employee.name} ${employee.surname}`
    : 'Unknown'
  const roleLabel = employee?.access_level
    ? employee.access_level.charAt(0).toUpperCase() + employee.access_level.slice(1)
    : ''

  return (
    <>
      {/* Mobile overlay */}
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
        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-[18px]">bolt</span>
          </div>
          {open && (
            <div className="flex-1 overflow-hidden">
              <p className="text-white text-[13px] font-semibold truncate">
                {company?.name ?? 'KaiSync'}
              </p>
              <p className="text-white/50 text-[11px] truncate">Workforce</p>
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

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map(item => {
            const active = pathname.startsWith(item.href)
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

        {/* User footer */}
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
