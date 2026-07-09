'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, timeGreeting } from '@/lib/utils'
import type { Employee, Company, TimesheetPunch, LeaveRequest } from '@/types/database'

interface KpiData {
  headcount: number
  leavePending: number
  onSiteToday: number
}

export default function OverviewPage() {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [kpi, setKpi] = useState<KpiData>({ headcount: 0, leavePending: 0, onSiteToday: 0 })
  const [recentPunches, setRecentPunches] = useState<TimesheetPunch[]>([])
  const [activePunch, setActivePunch] = useState<TimesheetPunch | null>(null)
  const [punchLoading, setPunchLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: emp } = await supabase
      .from('employees')
      .select('*, companies(*)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!emp) { setLoading(false); return }
    setEmployee(emp as Employee)
    const co = (emp as { companies: Company }).companies
    setCompany(co)

    const [hcRes, leaveRes, punchesRes, activeRes] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('company_id', co.id).eq('is_active', true),
      supabase.from('leave_requests').select('id', { count: 'exact', head: true })
        .eq('company_id', co.id).eq('status', 'pending'),
      supabase.from('timesheet_punches').select('*, employees(name,surname,employee_code)')
        .eq('company_id', co.id).not('punch_out', 'is', null)
        .order('punch_out', { ascending: false }).limit(5),
      supabase.from('timesheet_punches').select('*')
        .eq('company_id', co.id).eq('employee_id', emp.id)
        .is('punch_out', null).maybeSingle(),
    ])

    // Count on-site (no punch_out today)
    const today = new Date().toISOString().split('T')[0]
    const { count: onSite } = await supabase
      .from('timesheet_punches')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', co.id)
      .is('punch_out', null)
      .gte('punch_in', today)

    setKpi({
      headcount: hcRes.count ?? 0,
      leavePending: leaveRes.count ?? 0,
      onSiteToday: onSite ?? 0,
    })
    setRecentPunches((punchesRes.data ?? []) as TimesheetPunch[])
    setActivePunch(activeRes.data as TimesheetPunch | null)
    setLoading(false)
  }

  async function handlePunch() {
    if (!employee || !company) return
    setPunchLoading(true)
    const supabase = createClient()
    try {
      if (activePunch) {
        await supabase.from('timesheet_punches')
          .update({ punch_out: new Date().toISOString() })
          .eq('id', activePunch.id)
        setActivePunch(null)
      } else {
        const { data } = await supabase.from('timesheet_punches').insert({
          company_id: company.id,
          employee_id: employee.id,
          punch_in: new Date().toISOString(),
          is_manual: false,
        }).select().single()
        setActivePunch(data as TimesheetPunch)
      }
      await load()
    } finally {
      setPunchLoading(false)
    }
  }

  const greeting = timeGreeting()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-[14px] text-text-secondary">Loading…</span>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Welcome banner */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-text-primary">
          {greeting} {employee?.name ?? 'there'}
        </h1>
        <p className="text-[14px] text-text-secondary mt-0.5">{company?.name}</p>
      </div>

      {/* Self-punch card */}
      <div className="bg-surface rounded-lg border border-divider p-5 mb-5 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${activePunch ? 'bg-success-dark' : 'bg-background'}`}>
          <span className={`material-icons text-[24px] ${activePunch ? 'text-success' : 'text-text-secondary'}`}>
            {activePunch ? 'timer' : 'timer_off'}
          </span>
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-text-primary">
            {activePunch ? 'You are clocked in' : 'Not clocked in'}
          </p>
          {activePunch && (
            <p className="text-[12px] text-text-secondary mt-0.5">
              Since {formatDateTime(activePunch.punch_in)}
            </p>
          )}
        </div>
        <button
          onClick={handlePunch}
          disabled={punchLoading}
          className={`px-5 h-10 rounded-md text-[13px] font-semibold transition-colors disabled:opacity-50 ${
            activePunch
              ? 'bg-error-dark text-error hover:bg-red-100'
              : 'bg-primary text-white hover:bg-primary-dark'
          }`}
        >
          {punchLoading ? '…' : activePunch ? 'Clock Out' : 'Clock In'}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <KpiCard icon="people" label="Total Employees" value={kpi.headcount} color="primary" />
        <KpiCard icon="event_available" label="Leave Pending" value={kpi.leavePending} color="warning" />
        <KpiCard icon="location_on" label="On Site Today" value={kpi.onSiteToday} color="success" />
      </div>

      {/* Recent punches */}
      <div className="bg-surface rounded-lg border border-divider">
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
          <h2 className="text-[15px] font-semibold text-text-primary">Recent Clock-Outs</h2>
        </div>
        {recentPunches.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-text-disabled">
            No punch records yet
          </div>
        ) : (
          <div>
            {recentPunches.map(punch => {
              const emp = punch.employees as { name: string; surname: string; employee_code: string | null } | undefined
              return (
                <div key={punch.id} className="flex items-center gap-3 px-5 py-3 border-b border-divider last:border-0">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="material-icons text-primary text-[16px]">person</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-text-primary">
                      {emp ? `${emp.name} ${emp.surname}` : 'Unknown'}
                    </p>
                    <p className="text-[11px] text-text-secondary">
                      {formatDateTime(punch.punch_in)} → {formatDateTime(punch.punch_out)}
                    </p>
                  </div>
                  {punch.hours_worked != null && (
                    <span className="text-[12px] font-semibold text-text-secondary">
                      {punch.hours_worked.toFixed(1)}h
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, color }: {
  icon: string
  label: string
  value: number
  color: 'primary' | 'warning' | 'success'
}) {
  const colorMap = {
    primary: 'bg-primary/10 text-primary',
    warning: 'bg-warning-dark text-warning',
    success: 'bg-success-dark text-success',
  }
  return (
    <div className="bg-surface rounded-lg border border-divider p-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colorMap[color]}`}>
        <span className="material-icons text-[20px]">{icon}</span>
      </div>
      <p className="text-[24px] font-bold text-text-primary">{value}</p>
      <p className="text-[12px] text-text-secondary mt-0.5">{label}</p>
    </div>
  )
}
