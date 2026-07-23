'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from '@/components/Sidebar'
import EmployeeSidebar from '@/components/EmployeeSidebar'
import { getCodeSession, getEmpContext, clearCodeSession } from '@/lib/auth/code-session'
import { AUTH_ROUTES, usesCompanyDashboard } from '@/lib/auth/employee-routing'
import { refreshCodeSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/platform-admin'
import type { Company, Employee } from '@/types/database'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [platformOnly, setPlatformOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      // ── Path 1: Supabase JWT session (HR users + email-auth employees) ──
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const ctx = getEmpContext()

        let query = supabase
          .from('employees')
          .select('*, companies(*)')
          .eq('user_id', user.id)
          .eq('is_active', true)

        if (ctx?.employee_id && ctx.company_id) {
          query = query.eq('id', ctx.employee_id).eq('company_id', ctx.company_id)
        }

        const { data: emp } = await query.limit(1).maybeSingle()

        if (emp) {
          const access = (emp as Employee).access_level
          // Pure employees must pick a company (MAUI company picker) when no ctx
          if (!ctx && access === 'employee') {
            router.replace(AUTH_ROUTES.companyPicker)
            setLoading(false)
            return
          }
          setEmployee(emp as Employee)
          setCompany((emp as { companies: Company }).companies)
          setPlatformOnly(false)
          setLoading(false)
          return
        }

        // JWT but no employee row — platform owners may continue (MAUI parity)
        const admin = await isPlatformAdmin(supabase)
        if (admin) {
          setEmployee(null)
          setCompany(null)
          setPlatformOnly(true)
          if (!pathname.startsWith('/dashboard/platform')) {
            router.replace('/dashboard/platform')
          }
          setLoading(false)
          return
        }

        // JWT but no employee row — resume link company
        router.replace(
          `${AUTH_ROUTES.linkCompany}?email=${encodeURIComponent(user.email ?? '')}&firstName=&lastName=`,
        )
        setLoading(false)
        return
      }

      // ── Path 2: Code session (code-authenticated employees) ──
      const existing = getCodeSession()
      if (existing) {
        const refreshed = await refreshCodeSession(supabase)
        const session = refreshed ?? existing
        if (session.employee?.id && session.company?.id) {
          setEmployee({
            ...session.employee,
            company_id: session.company_id,
          } as unknown as Employee)
          setCompany({
            id: session.company.id,
            name: session.company.name,
            company_code: session.company.code,
            owner_user_id: '',
            industry: null,
            size_range: null,
            address: null,
            created_at: '',
          })
          setLoading(false)
          return
        }
        clearCodeSession()
      }

      router.replace(AUTH_ROUTES.idEntry)
      setLoading(false)
    }

    init()
  }, [router, pathname])

  // Match MAUI: only field employees use employee shell; managers+ use company dashboard
  const showEmployeeShell = employee != null && !usesCompanyDashboard(employee.access_level)

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-text-secondary text-[14px]">
          <span className="material-icons animate-spin text-primary text-[20px]">refresh</span>
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {showEmployeeShell ? (
        <EmployeeSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
          company={company}
          employee={employee}
        />
      ) : (
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
          company={company}
          employee={employee}
          platformOnly={platformOnly}
        />
      )}

      <div className="flex flex-col flex-1 overflow-hidden bg-background">
        <header className="flex items-center h-14 px-5 bg-surface border-b border-divider shrink-0">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="lg:hidden mr-3 text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="material-icons">menu</span>
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-[13px] font-medium text-text-primary leading-none">
                {employee ? `${employee.name} ${employee.surname}` : platformOnly ? 'Platform Operator' : ''}
              </p>
              <p className="text-[11px] text-text-secondary capitalize mt-0.5">
                {employee?.access_level ?? (platformOnly ? 'platform admin' : '')}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-white text-[12px] font-semibold">
                {employee
                  ? `${employee.name?.[0] ?? ''}${employee.surname?.[0] ?? ''}`
                  : platformOnly ? 'P' : '?'}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
