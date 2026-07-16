'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { cn, formatDate, formatDateTime, formatCurrency, getInitials } from '@/lib/utils'
import type { Employee, LeaveRequest, TimesheetPunch, AccessLevel } from '@/types/database'

type EmployeeDocument = {
  id: string
  company_id: string
  employee_id: string
  document_type: string
  document_name: string
  file_url: string
  uploaded_by_role: string
  created_at: string | null
}

type Tab = 'overview' | 'payments' | 'leave' | 'documents'
type Period = 'today' | 'week' | 'month' | 'custom'

interface PayrollReady {
  ready: boolean
  statusLabel: string
  issues: string[]
}

function checkPayrollReadiness(emp: Employee): PayrollReady {
  const issues: string[] = []
  if (!emp.monthly_salary && !emp.hourly_rate) issues.push('No salary or rate configured')
  if (!emp.bank_name || !emp.account_number) issues.push('Banking details missing')
  if (!emp.id_number) issues.push('ID / Passport number missing')
  return {
    ready: issues.length === 0,
    statusLabel: issues.length === 0 ? 'Ready' : 'Incomplete',
    issues,
  }
}

function periodRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  if (period === 'today') {
    const d = now.toISOString().split('T')[0]
    return { from: d, to: d }
  }
  if (period === 'week') {
    const mon = new Date(now)
    mon.setDate(now.getDate() - now.getDay() + 1)
    return { from: mon.toISOString().split('T')[0], to: now.toISOString().split('T')[0] }
  }
  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    return { from, to: now.toISOString().split('T')[0] }
  }
  return { from: customFrom, to: customTo }
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [myCompanyId, setMyCompanyId] = useState<string | null>(null)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [myAccessLevel, setMyAccessLevel] = useState<AccessLevel>('employee')
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Attendance
  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [appliedCustomFrom, setAppliedCustomFrom] = useState('')
  const [appliedCustomTo, setAppliedCustomTo] = useState('')
  const [punches, setPunches] = useState<TimesheetPunch[]>([])
  const [punchLoading, setPunchLoading] = useState(false)

  // Leave
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [leaveLoaded, setLeaveLoaded] = useState(false)

  // Documents
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [docsLoaded, setDocsLoaded] = useState(false)

  useEffect(() => { loadEmployee() }, [id])
  useEffect(() => {
    if (employee && tab === 'overview') loadAttendance()
  }, [employee, period, appliedCustomFrom, appliedCustomTo])
  useEffect(() => {
    if (employee && tab === 'leave' && !leaveLoaded) loadLeave()
  }, [employee, tab])
  useEffect(() => {
    if (employee && myCompanyId && tab === 'documents' && !docsLoaded) loadDocs()
  }, [employee, tab, myCompanyId])

  async function loadEmployee() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setMyCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    const [{ data: emp }, { data: me }] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).eq('company_id', member.companyId).maybeSingle(),
      supabase.from('employees').select('access_level').eq('id', member.employeeId).single(),
    ])

    setEmployee(emp as Employee | null)
    setMyAccessLevel(((me as { access_level: AccessLevel } | null)?.access_level) ?? 'employee')
    setLoading(false)
  }

  async function loadDocs() {
    if (!employee || !myCompanyId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('company_id', myCompanyId)
      .order('created_at', { ascending: false })
    setDocs((data ?? []) as EmployeeDocument[])
    setDocsLoaded(true)
  }

  async function loadAttendance() {
    if (!employee) return
    setPunchLoading(true)
    const supabase = createClient()
    const { from, to } = periodRange(period, appliedCustomFrom, appliedCustomTo)
    const nextDay = new Date(to)
    nextDay.setDate(nextDay.getDate() + 1)

    const { data } = await supabase
      .from('timesheet_punches')
      .select('*')
      .eq('employee_id', employee.id)
      .gte('punch_in', from)
      .lt('punch_in', nextDay.toISOString().split('T')[0])
      .order('punch_in', { ascending: false })

    setPunches((data ?? []) as TimesheetPunch[])
    setPunchLoading(false)
  }

  async function loadLeave() {
    if (!employee) return
    const supabase = createClient()
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
    setLeaveRequests((data ?? []) as LeaveRequest[])
    setLeaveLoaded(true)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[14px] text-text-secondary">Loading…</div>
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] text-text-secondary">Employee not found</p>
        <Link href="/dashboard/employees" className="text-primary text-[13px] hover:underline">Back to list</Link>
      </div>
    )
  }

  const fullName = `${employee.name} ${employee.surname}`
  const initials = getInitials(fullName)
  const payrollReadiness = checkPayrollReadiness(employee)

  const totalHours = punches.reduce((s, p) => s + (p.hours_worked ?? 0), 0)
  const sessions = punches.length
  const payDue = (employee.hourly_rate ?? 0) * totalHours

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky hero header */}
      <div className="bg-surface border-b border-divider">
        <div className="px-4 pt-[18px] pb-3 flex items-start gap-[14px]">
          <div className="w-[72px] h-[72px] rounded-full bg-primary flex items-center justify-center shrink-0">
            <span className="text-[24px] font-bold text-white">{initials}</span>
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-[19px] font-bold text-text-primary truncate">{fullName}</p>
            {employee.position && (
              <p className="text-[13px] text-text-secondary">{employee.position}</p>
            )}
            <div className="flex gap-[6px] flex-wrap">
              <span className={cn(
                'text-[11px] font-semibold px-2 py-[3px] rounded-[10px]',
                employee.is_active ? 'bg-success-dark text-[#166534]' : 'bg-error-dark text-[#991B1B]'
              )}>
                {employee.is_active ? 'Active' : 'Inactive'}
              </span>
              {employee.employment_type && (
                <span className="text-[11px] text-text-secondary bg-surface-elevated border border-divider px-2 py-[3px] rounded-[10px]">
                  {employee.employment_type}
                </span>
              )}
              <span className="text-[11px] text-text-secondary bg-surface-elevated border border-divider px-2 py-[3px] rounded-[10px] capitalize">
                {employee.access_level}
              </span>
            </div>
          </div>
          <Link
            href={`/dashboard/employees/${employee.id}/edit`}
            className="border border-primary text-primary rounded-sm h-10 px-[14px] text-[13px] font-medium flex items-center whitespace-nowrap hover:bg-primary/5 transition-colors"
          >
            Edit Profile
          </Link>
        </div>

        {/* Payroll readiness banner */}
        <div className={cn(
          'mx-4 mb-3 px-3 py-[10px] rounded-[10px] border',
          payrollReadiness.ready ? 'border-success bg-success-dark/40' : 'border-warning bg-warning-dark/40'
        )}>
          <p className={cn('text-[13px] font-semibold', payrollReadiness.ready ? 'text-success' : 'text-warning')}>
            Payroll: {payrollReadiness.statusLabel}
          </p>
          {payrollReadiness.issues.map(issue => (
            <p key={issue} className="text-[12px] text-text-secondary">• {issue}</p>
          ))}
        </div>

        {/* Info chips */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
          {[
            employee.id_number && { label: 'ID', value: employee.id_number },
            employee.employment_date && { label: 'Since', value: formatDate(employee.employment_date) },
            employee.email && { label: 'Email', value: employee.email },
            employee.phone && { label: 'Phone', value: employee.phone },
          ].filter(Boolean).map((chip) => {
            const c = chip as { label: string; value: string }
            return (
              <div key={c.label} className="flex items-center gap-[5px] bg-surface-elevated border border-divider rounded-sm px-2 py-[5px] shrink-0">
                <span className="text-[11px] text-text-secondary">{c.label}</span>
                <span className="text-[11px] font-medium text-text-primary">{c.value}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sticky tab bar */}
      <div className="bg-surface border-b border-divider px-3 py-2 shrink-0">
        <div className="grid grid-cols-4 gap-[6px]">
          {(['overview', 'payments', 'leave', 'documents'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'h-10 rounded-sm font-medium text-[12px] capitalize transition-colors',
                tab === t ? 'bg-primary text-white' : 'bg-background text-text-secondary hover:text-text-primary'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'overview' && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label="Hours / Month" value={`${totalHours.toFixed(1)}h`} color="text-primary" />
              <KpiCard label="Pay Due" value={formatCurrency(payDue)} color="text-success" />
              <KpiCard label="Punches" value={String(sessions)} color="text-text-primary" />
            </div>

            {/* Banking details */}
            <div className="bg-surface border border-divider rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
                <p className="text-[14px] font-semibold text-text-primary">Banking Details</p>
                <Link
                  href={`/dashboard/employees/${employee.id}/edit`}
                  className="bg-surface-elevated text-primary h-9 px-[14px] rounded-sm text-[12px] font-medium flex items-center hover:bg-primary/5 transition-colors"
                >
                  Edit Banking
                </Link>
              </div>
              {employee.bank_name ? (
                <div className="p-4 grid grid-cols-2 gap-3">
                  <InfoCell label="Account" value={employee.account_number ? `****${employee.account_number.slice(-4)}` : '—'} />
                  <InfoCell label="Bank" value={employee.bank_name} />
                  <InfoCell label="Branch code" value={employee.bank_branch_code ?? '—'} />
                  <InfoCell label="Type" value={employee.account_type ?? '—'} />
                </div>
              ) : (
                <p className="px-4 py-4 text-[12px] text-text-disabled">No banking details on file yet.</p>
              )}
            </div>

            {/* Attendance section */}
            <div className="bg-surface border border-divider rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-divider">
                <p className="text-[14px] font-semibold text-text-primary mb-2">Attendance</p>
                <div className="flex gap-2 flex-wrap">
                  {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={cn(
                        'h-8 px-3 rounded-sm text-[12px] font-medium capitalize transition-colors',
                        period === p ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
                      )}
                    >
                      {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
                {period === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                      className="h-9 px-2 rounded-sm border border-border bg-surface-elevated text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary" />
                    <span className="text-text-secondary">–</span>
                    <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                      className="h-9 px-2 rounded-sm border border-border bg-surface-elevated text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary" />
                    <button
                      onClick={() => { setAppliedCustomFrom(customFrom); setAppliedCustomTo(customTo) }}
                      className="h-9 px-3 bg-primary text-white rounded-sm text-[12px] font-medium hover:bg-primary-dark transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 divide-x divide-divider border-b border-divider">
                <div className="p-3 text-center">
                  <p className="text-[18px] font-bold text-text-primary">{sessions}</p>
                  <p className="text-[10px] text-text-secondary">Sessions</p>
                </div>
                <div className="p-3 text-center">
                  <p className="text-[18px] font-bold text-primary">{totalHours.toFixed(1)}h</p>
                  <p className="text-[10px] text-text-secondary">Hours</p>
                </div>
                <div className="p-3 text-center">
                  <p className="text-[18px] font-bold text-text-primary">0</p>
                  <p className="text-[10px] text-text-secondary">Late</p>
                </div>
              </div>

              {punchLoading ? (
                <div className="py-8 text-center text-[13px] text-text-disabled">Loading…</div>
              ) : punches.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-text-disabled">No records for this period</div>
              ) : (
                punches.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-divider last:border-0">
                    <span className="material-icons text-text-disabled text-[18px]">schedule</span>
                    <div className="flex-1">
                      <p className="text-[13px] text-text-primary">{formatDateTime(p.punch_in)}</p>
                      {p.punch_out && <p className="text-[11px] text-text-secondary">→ {formatDateTime(p.punch_out)}</p>}
                    </div>
                    {p.hours_worked != null && (
                      <span className="text-[12px] font-semibold text-text-secondary">{p.hours_worked.toFixed(1)}h</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {tab === 'payments' && <PaymentsTab employee={employee} />}
        {tab === 'leave' && <LeaveTab leaveRequests={leaveRequests} employeeId={employee.id} />}
        {tab === 'documents' && (
          <DocumentsTab
            employeeId={employee.id}
            companyId={myCompanyId!}
            myAccessLevel={myAccessLevel}
            docs={docs}
            setDocs={setDocs}
            reloadDocs={loadDocs}
          />
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface border border-divider rounded-lg p-3 text-center">
      <p className={`text-[18px] font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-text-secondary mt-0.5">{label}</p>
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-[13px] font-medium text-text-primary">{value}</p>
    </div>
  )
}

function PaymentsTab({ employee }: { employee: Employee }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [punches, setPunches] = useState<TimesheetPunch[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const [year, mon] = month.split('-').map(Number)
      const start = new Date(year, mon - 1, 1).toISOString()
      const end = new Date(year, mon, 0, 23, 59, 59).toISOString()
      const { data } = await supabase
        .from('timesheet_punches')
        .select('*')
        .eq('employee_id', employee.id)
        .gte('punch_in', start)
        .lte('punch_in', end)
        .not('hours_worked', 'is', null)
      setPunches((data ?? []) as TimesheetPunch[])
      setLoading(false)
    }
    load()
  }, [employee.id, month])

  const totalHours = punches.reduce((s, p) => s + (p.hours_worked ?? 0), 0)
  const rate = employee.hourly_rate ?? 0
  const gross = rate * totalHours

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-text-primary">Payroll Summary</p>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="h-9 px-3 rounded-sm border border-border bg-surface text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Hours" value={`${totalHours.toFixed(1)}h`} color="text-primary" />
        <KpiCard label="Rate/hr" value={rate > 0 ? formatCurrency(rate) : '—'} color="text-text-primary" />
        <KpiCard label="Gross Pay" value={gross > 0 ? formatCurrency(gross) : '—'} color="text-success" />
      </div>
      {loading ? (
        <p className="text-center text-[13px] text-text-disabled py-8">Loading…</p>
      ) : punches.length === 0 ? (
        <p className="text-center text-[13px] text-text-disabled py-8">No payroll data for this period</p>
      ) : (
        <div className="bg-surface border border-divider rounded-lg overflow-hidden">
          {punches.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-divider last:border-0">
              <span className="material-icons text-text-disabled text-[16px]">schedule</span>
              <div className="flex-1">
                <p className="text-[13px] text-text-primary">{formatDateTime(p.punch_in)}</p>
              </div>
              <span className="text-[13px] font-semibold text-text-secondary">
                {p.hours_worked?.toFixed(1)}h = {formatCurrency((p.hours_worked ?? 0) * rate)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const LEAVE_STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-warning-dark text-warning' },
  approved: { label: 'Approved', cls: 'bg-success-dark text-success' },
  declined: { label: 'Declined', cls: 'bg-error-dark text-error' },
  cancelled: { label: 'Cancelled', cls: 'bg-background text-text-disabled' },
}

const LEAVE_ANNUAL_DEFAULTS: Record<string, number> = {
  annual_leave:          15,
  sick_leave:            30,
  family_responsibility:  3,
  maternity_leave:       90,
  study_leave:            5,
}

function LeaveTab({ leaveRequests, employeeId }: { leaveRequests: LeaveRequest[]; employeeId: string }) {
  const yearStart = `${new Date().getFullYear()}-01-01`

  const byType = leaveRequests
    .filter(r => r.status === 'approved' && r.start_date >= yearStart)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.leave_type] = (acc[r.leave_type] ?? 0) + r.days_requested
      return acc
    }, {})

  const leaveTypes = Array.from(new Set(leaveRequests.map(r => r.leave_type))).sort()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-text-primary">Leave History</p>
        <button className="h-9 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors">
          Apply Leave
        </button>
      </div>

      {/* Balance summary */}
      {leaveTypes.length > 0 && (
        <div className="bg-surface border border-divider rounded-lg overflow-hidden">
          <p className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary border-b border-divider uppercase tracking-wide">
            {new Date().getFullYear()} Balances
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-divider">
                  <th className="text-left px-4 py-2 text-text-secondary font-medium">Leave Type</th>
                  <th className="text-center px-4 py-2 text-text-secondary font-medium">Annual</th>
                  <th className="text-center px-4 py-2 text-text-secondary font-medium">Used</th>
                  <th className="text-center px-4 py-2 text-text-secondary font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {leaveTypes.map(lt => {
                  const annual    = LEAVE_ANNUAL_DEFAULTS[lt] ?? 5
                  const used      = byType[lt] ?? 0
                  const remaining = Math.max(0, annual - used)
                  return (
                    <tr key={lt} className="border-b border-divider last:border-0">
                      <td className="px-4 py-2.5 font-medium text-text-primary capitalize">
                        {lt.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-center text-text-secondary">{annual}</td>
                      <td className="px-4 py-2.5 text-center text-text-secondary">{used}</td>
                      <td className="px-4 py-2.5 text-center font-semibold">
                        <span className={
                          remaining <= 0 ? 'text-error' : remaining <= 3 ? 'text-warning' : 'text-success'
                        }>
                          {remaining}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Request history */}
      {leaveRequests.length === 0 ? (
        <div className="py-12 text-center">
          <span className="material-icons text-[40px] text-text-disabled block mb-1">event_available</span>
          <p className="text-[13px] text-text-secondary">No leave requests</p>
        </div>
      ) : (
        <div className="bg-surface border border-divider rounded-lg overflow-hidden">
          {leaveRequests.map(req => {
            const badge = LEAVE_STATUS_BADGES[req.status] ?? LEAVE_STATUS_BADGES.cancelled
            return (
              <div key={req.id} className="px-4 py-3 border-b border-divider last:border-0">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-[13px] font-medium text-text-primary capitalize">
                    {req.leave_type.replace(/_/g, ' ')}
                  </p>
                  <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  {formatDate(req.start_date)} – {formatDate(req.end_date)} · {req.days_requested} day{req.days_requested !== 1 ? 's' : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Document types ───────────────────────────────────────────────────────────

const DOC_TYPES = [
  'ID Document', 'Passport', 'Employment Contract', 'NDA',
  'Certificate', 'Qualification', 'Bank Letter', 'Tax Certificate', 'Other',
]

type DocumentsTabProps = {
  employeeId: string
  companyId: string
  myAccessLevel: AccessLevel
  docs: EmployeeDocument[]
  setDocs: React.Dispatch<React.SetStateAction<EmployeeDocument[]>>
  reloadDocs: () => Promise<void>
}

function DocumentsTab({ employeeId, companyId, myAccessLevel, docs, setDocs, reloadDocs }: DocumentsTabProps) {
  const fileRef     = useRef<HTMLInputElement>(null)
  const [docType,        setDocType]        = useState(DOC_TYPES[0])
  const [uploading,      setUploading]      = useState(false)
  const [uploadError,    setUploadError]    = useState<string | null>(null)
  const [confirmDelete,  setConfirmDelete]  = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setUploadError(null)

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path     = `employee-docs/${companyId}/${employeeId}/${Date.now()}_${safeName}`
    const supabase = createClient()

    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file)

    if (upErr) {
      setUploadError(upErr.message)
      setUploading(false)
      return
    }

    await supabase.from('employee_documents').insert({
      employee_id:      employeeId,
      company_id:       companyId,
      document_name:    file.name,
      document_type:    docType,
      file_url:         path,
      uploaded_by_role: myAccessLevel,
    })

    await reloadDocs()
    setUploading(false)
  }

  async function openDocument(doc: EmployeeDocument) {
    const supabase = createClient()
    const { data } = await supabase.storage
      .from('workforce-media')
      .createSignedUrl(doc.file_url, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDocument(docId: string) {
    const doc = docs.find(d => d.id === docId)
    if (!doc) return
    const supabase = createClient()
    await supabase.storage.from('workforce-media').remove([doc.file_url])
    await supabase.from('employee_documents').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== docId))
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-4">
      {/* Upload bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={docType}
          onChange={e => setDocType(e.target.value)}
          className="h-10 px-3 bg-surface border border-border rounded-sm text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none flex-1 min-w-[160px]"
        >
          {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          <span className="material-icons text-[16px]">upload_file</span>
          {uploading ? 'Uploading…' : 'Upload Document'}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {uploadError && (
        <p className="text-[12px] text-error bg-error/10 px-3 py-2 rounded-sm">{uploadError}</p>
      )}

      {/* Document list */}
      {docs.length === 0 ? (
        <div className="py-16 text-center">
          <span className="material-icons text-[48px] text-text-disabled block mb-2">description</span>
          <p className="text-[13px] text-text-secondary">No documents uploaded yet</p>
        </div>
      ) : (
        <div className="bg-surface border border-divider rounded-lg overflow-hidden">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3 border-b border-divider last:border-0">
              <span className="material-icons text-text-disabled text-[22px] shrink-0">
                {doc.document_name.match(/\.pdf$/i) ? 'picture_as_pdf' : 'insert_drive_file'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-text-primary truncate">{doc.document_name}</p>
                <p className="text-[11px] text-text-secondary">
                  {doc.document_type}
                  {doc.created_at && ` · ${formatDate(doc.created_at)}`}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => openDocument(doc)}
                  className="h-8 px-3 rounded-sm bg-primary/10 text-primary text-[12px] font-medium hover:bg-primary/20 transition-colors"
                >
                  Open
                </button>
                <button
                  onClick={() => setConfirmDelete(doc.id)}
                  className="h-8 px-3 rounded-sm bg-error/10 text-error text-[12px] font-medium hover:bg-error/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-[16px] font-semibold text-text-primary">Delete document?</h2>
            <p className="text-[13px] text-text-secondary">
              {docs.find(d => d.id === confirmDelete)?.document_name} will be permanently removed
              from storage and cannot be recovered.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 h-10 rounded-sm border border-border text-[13px] text-text-secondary hover:bg-background transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteDocument(confirmDelete)}
                className="flex-1 h-10 rounded-sm bg-error text-white text-[13px] font-semibold hover:bg-error/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
