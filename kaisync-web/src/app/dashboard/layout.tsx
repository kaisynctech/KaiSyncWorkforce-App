'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from '@/components/Sidebar'
import EmployeeSidebar from '@/components/EmployeeSidebar'
import { DashboardCompanyProvider } from '@/components/DashboardCompanyContext'
import { DashboardBootstrapProvider } from '@/components/DashboardBootstrapContext'
import { getCodeSession, getEmpContext, clearCodeSession } from '@/lib/auth/code-session'
import { AUTH_ROUTES, usesCompanyDashboard } from '@/lib/auth/employee-routing'
import { refreshCodeSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { EMPLOYEE_SAFE_SELECT } from '@/lib/employee-columns'
import type { Company, Employee } from '@/types/database'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [platformOnly, setPlatformOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => {
      const desktop = mq.matches
      setIsDesktop(desktop)
      // Employee + HR: drawer closed on phones; desktop starts expanded.
      setSidebarOpen(desktop)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function init() {
      // ── Path 1: Supabase JWT session (HR users + email-auth employees) ──
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return

      if (user) {
        const ctx = getEmpContext()

        let query = supabase
          .from('employees')
          .select(`${EMPLOYEE_SAFE_SELECT}, companies(*)`)
          .eq('user_id', user.id)
          .eq('is_active', true)

        if (ctx?.employee_id && ctx.company_id) {
          query = query.eq('id', ctx.employee_id).eq('company_id', ctx.company_id)
        }

        const { data: emp } = await query.limit(1).maybeSingle()
        if (cancelled) return

        if (emp) {
          const access = (emp as unknown as Employee).access_level
          // Pure employees must pick a company when no ctx
          if (!ctx && access === 'employee') {
            router.replace(AUTH_ROUTES.companyPicker)
            setLoading(false)
            return
          }
          setEmployee(emp as unknown as Employee)
          setCompany((emp as unknown as { companies: Company }).companies)
          setPlatformOnly(false)
          setLoading(false)
          return
        }

        // JWT but no employee row — platform owners may continue
        const admin = await isPlatformAdmin(supabase)
        if (cancelled) return
        if (admin) {
          setEmployee(null)
          setCompany(null)
          setPlatformOnly(true)
          setLoading(false)
          return
        }

        // A company-code sign-in is stored separately. Use it before
        // sending an unlinked email session off to link a company.
        const codeSession = getCodeSession()
        if (!(codeSession?.employee?.id && codeSession.company?.id)) {
          router.replace(
            `${AUTH_ROUTES.linkCompany}?email=${encodeURIComponent(user.email ?? '')}&firstName=&lastName=`,
          )
          setLoading(false)
          return
        }
      }

      // ── Path 2: Code session (code-authenticated employees) ──
      // Paint from cached session first; refresh once in the background (not on every nav).
      const existing = getCodeSession()
      if (existing?.employee?.id && existing.company?.id) {
        setEmployee({
          ...existing.employee,
          company_id: existing.company_id,
        } as unknown as Employee)
        setCompany({
          id: existing.company.id,
          name: existing.company.name,
          code: existing.company.code,
          owner_user_id: '',
          industry: null,
          size_range: null,
          address: null,
          created_at: '',
        })
        setPlatformOnly(false)
        setLoading(false)

        void refreshCodeSession(supabase).then(refreshed => {
          if (cancelled) return
          if (refreshed?.employee?.id && refreshed.company?.id) {
            setEmployee({
              ...refreshed.employee,
              company_id: refreshed.company_id,
            } as unknown as Employee)
            setCompany({
              id: refreshed.company.id,
              name: refreshed.company.name,
              code: refreshed.company.code,
              owner_user_id: '',
              industry: null,
              size_range: null,
              address: null,
              created_at: '',
            })
            return
          }
          if (!refreshed) {
            clearCodeSession()
            router.replace(AUTH_ROUTES.idEntry)
          }
        })
        return
      }

      if (existing) clearCodeSession()
      router.replace(AUTH_ROUTES.idEntry)
      setLoading(false)
    }

    void init()
    return () => { cancelled = true }
    // Intentionally once on mount — re-running on every pathname made every nav feel slow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Platform-only users: keep them on /dashboard/platform without re-auth.
  useEffect(() => {
    if (loading || !platformOnly) return
    if (!pathname.startsWith('/dashboard/platform')) {
      router.replace('/dashboard/platform')
    }
  }, [loading, platformOnly, pathname, router])

  // only field employees use employee shell; managers+ use company dashboard
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

  // ── Employee shell (field workers) — drawer on phone, rail on desktop ──
  if (showEmployeeShell) {
    return (
      <DashboardCompanyProvider company={company} employee={employee}>
        <DashboardBootstrapProvider>
          <div className="flex h-screen overflow-hidden">
            <EmployeeSidebar
              open={sidebarOpen}
              onToggle={() => setSidebarOpen(v => !v)}
              onClose={() => setSidebarOpen(false)}
              company={company}
              employee={employee}
            />
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-background">
              {!isDesktop && (
                <div className="flex items-center gap-2 px-3 h-12 border-b border-divider bg-surface shrink-0">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                    aria-label="Open menu"
                  >
                    <span className="material-icons text-[22px]">menu</span>
                  </button>
                  <p className="text-[14px] font-semibold text-text-primary truncate">
                    {company?.name ?? 'KaiSync'}
                  </p>
                </div>
              )}
              <main className="flex-1 overflow-y-auto min-h-0">
                {children}
              </main>
            </div>
          </div>
        </DashboardBootstrapProvider>
      </DashboardCompanyProvider>
    )
  }

  // ── Manager / admin shell — top nav + collapsible left panel ──
  return (
    <DashboardCompanyProvider company={company} employee={employee}>
      <DashboardBootstrapProvider>
        <div className="flex flex-col h-screen overflow-hidden">
          <Sidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen(v => !v)}
            onClose={() => setSidebarOpen(false)}
            company={company}
            employee={employee}
            platformOnly={platformOnly}
          />
          <div className="flex flex-1 min-w-0 overflow-hidden">
            {/* paddingLeft tracks --sidebar-panel-w set by Sidebar (0 on phones — drawer overlays) */}
            <main
              className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-background transition-[padding] duration-200"
              style={{ paddingLeft: 'var(--sidebar-panel-w, 0px)' }}
            >
              {children}
            </main>
          </div>
        </div>
      </DashboardBootstrapProvider>
    </DashboardCompanyProvider>
  )
}
