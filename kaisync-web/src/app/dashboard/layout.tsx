'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from '@/components/Sidebar'
import EmployeeSidebar from '@/components/EmployeeSidebar'
import type { Company, Employee } from '@/types/database'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      // ── Path 1: Supabase JWT session (HR users + email-auth employees) ──
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: emp } = await supabase
          .from('employees')
          .select('*, companies(*)')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle()
        if (emp) {
          setEmployee(emp as Employee)
          setCompany((emp as { companies: Company }).companies)
        }
        setLoading(false)
        return
      }
      // ── Path 2: Code session (code-authenticated employees) ──
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('kf_cs') : null
        if (raw) {
          const cs = JSON.parse(raw) as {
            employee?: { id: string; name: string; surname: string; access_level: string; employee_code?: string; position?: string }
            company?:  { id: string; name: string; code: string }
            employee_id?: string
            company_id?: string
          }
          if (cs.employee?.id && cs.company?.id) {
            setEmployee(cs.employee as unknown as Employee)
            setCompany(cs.company as unknown as Company)
            setLoading(false)
            return
          }
        }
      } catch {
        // Corrupt localStorage — clear and fall through to redirect
        localStorage.removeItem('kf_cs')
      }
      // ── No valid session ──
      router.replace('/auth/id-entry')
      setLoading(false)
    }

    init()
  }, [router])

  const isEmployee = employee?.access_level === 'employee'

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
      {isEmployee ? (
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
        />
      )}

      <div className="flex flex-col flex-1 overflow-hidden bg-background">
        {/* Top bar */}
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
                {employee ? `${employee.name} ${employee.surname}` : ''}
              </p>
              <p className="text-[11px] text-text-secondary capitalize mt-0.5">
                {employee?.access_level}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-white text-[12px] font-semibold">
                {employee ? `${employee.name[0]}${employee.surname[0]}` : '?'}
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
