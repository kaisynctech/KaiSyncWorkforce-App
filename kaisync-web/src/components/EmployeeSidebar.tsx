'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn, getInitials } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  ALL_MODULES_ENABLED,
  type EmployeeModuleFlags,
} from '@/lib/company-modules'
import { loadCompanyWorkspace, moduleFlagsForCompany } from '@/lib/employee-workspace'
import type { Company, Employee } from '@/types/database'

interface NavItem {
  label: string
  href: string
  icon: string
  /** null = always visible */
  module?: keyof EmployeeModuleFlags
}

const EMP_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard/employee/overview', icon: 'home' },
  { label: 'My Jobs', href: '/dashboard/employee/jobs', icon: 'work', module: 'jobs' },
  { label: 'My PA', href: '/dashboard/employee/pa', icon: 'task_alt', module: 'myPa' },
  { label: 'My Shifts', href: '/dashboard/employee/shifts', icon: 'event', module: 'scheduling' },
  { label: 'My Leave', href: '/dashboard/employee/leave', icon: 'beach_access', module: 'leave' },
  { label: 'Attendance', href: '/dashboard/employee/attendance', icon: 'schedule', module: 'attendance' },
  { label: 'My Incidents', href: '/dashboard/employee/incidents', icon: 'warning', module: 'incidents' },
  { label: 'Contractor Profile', href: '/dashboard/employee/contractor', icon: 'badge', module: 'contractors' },
  { label: 'My Payslips', href: '/dashboard/employee/payslips', icon: 'payments', module: 'payroll' },
  { label: 'My Documents', href: '/dashboard/employee/documents', icon: 'folder' },
  { label: 'Forms', href: '/dashboard/employee/forms', icon: 'description', module: 'paperless' },
  { label: 'Messages', href: '/dashboard/messages', icon: 'chat', module: 'messaging' },
  { label: 'Notifications', href: '/dashboard/employee/notifications', icon: 'notifications' },
  { label: 'My Profile', href: '/dashboard/profile', icon: 'person' },
]

interface SidebarProps {
  open: boolean
  onToggle: () => void
  company: Company | null
  employee: Employee | null
}

export default function EmployeeSidebar({ open, onToggle, company, employee }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [modules, setModules] = useState<EmployeeModuleFlags>(ALL_MODULES_ENABLED)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!company?.id) return
      const supabase = createClient()
      const workspace = await loadCompanyWorkspace(supabase, company.id)
      if (!cancelled) setModules(moduleFlagsForCompany(workspace))
    }
    load()
    return () => { cancelled = true }
  }, [company?.id])

  const items = useMemo(
    () => EMP_NAV_ITEMS.filter((item) => !item.module || modules[item.module]),
    [modules],
  )

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

  const displayName = employee ? `${employee.name} ${employee.surname}` : 'Unknown'
  const roleLabel = 'Employee'

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={onToggle} />
      )}
      <aside className={cn(
        'fixed lg:relative inset-y-0 left-0 z-30 flex flex-col bg-sidebar-bg transition-all duration-200 shrink-0',
        open ? 'w-60' : 'w-[64px]',
      )}>
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="material-icons text-white text-[18px]">bolt</span>
          </div>
          {open && (
            <div className="flex-1 overflow-hidden">
              <p className="text-white text-[13px] font-semibold truncate">{company?.name ?? 'KaiSync'}</p>
              <p className="text-white/50 text-[11px] truncate">Employee Portal</p>
            </div>
          )}
          <button onClick={onToggle} className="text-white/50 hover:text-white transition-colors ml-auto" aria-label="Toggle sidebar">
            <span className="material-icons text-[20px]">{open ? 'chevron_left' : 'chevron_right'}</span>
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 mx-2 mb-0.5 rounded-lg px-3 h-10 transition-colors group',
                  active ? 'bg-primary/20 text-sidebar-active' : 'text-white/60 hover:text-white hover:bg-white/10',
                )}
              >
                <span className={cn(
                  'material-icons shrink-0 transition-colors text-[20px]',
                  active ? 'text-sidebar-active' : 'text-white/50 group-hover:text-white',
                )}>
                  {item.icon}
                </span>
                {open && <span className="text-[13px] font-medium truncate">{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className={cn('flex items-center gap-3', !open && 'justify-center')}>
            <div className="w-8 h-8 rounded-full bg-primary-dark flex items-center justify-center shrink-0">
              <span className="text-white text-[12px] font-semibold">{getInitials(displayName)}</span>
            </div>
            {open && (
              <div className="flex-1 overflow-hidden">
                <p className="text-white text-[12px] font-medium truncate">{displayName}</p>
                <p className="text-white/50 text-[11px]">{roleLabel}</p>
              </div>
            )}
            {open && (
              <button onClick={handleSignOut} className="text-white/50 hover:text-white transition-colors" title="Sign out">
                <span className="material-icons text-[18px]">logout</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
