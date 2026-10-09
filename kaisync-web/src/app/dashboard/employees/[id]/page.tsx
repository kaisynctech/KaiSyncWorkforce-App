'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { cn, formatDate, formatDateTime, formatCurrency, getInitials, localISODate } from '@/lib/utils'
import { labelEmploymentType } from '@/lib/employee-taxonomy'
import { getCompanyAnnualDays, loadLeaveSettings, readCustomLeaveTypes, type LeaveSettingsMap } from '@/lib/leave-settings'
import { LEAVE_TYPES } from '@/lib/leave-policy'
import { listExtraBranchIds } from '@/lib/employee-branches'
import { getEmployee } from '@/lib/employees'
import EditEmployeePage from './edit/page'
import { assessPayrollReadiness } from '@/lib/payroll-readiness'
import type { Employee, LeaveRequest, TimePunch, AccessLevel } from '@/types/database'

type PairSession = {
  punchIn: string
  punchOut: string | null
  hoursWorked: number
  inAddress: string | null
  outAddress: string | null
  notes: string | null
}

function buildPairs(raw: TimePunch[]): PairSession[] {
  const pairs: PairSession[] = []
  let i = 0
  while (i < raw.length) {
    const p = raw[i]
    if (p.type === 'in') {
      const nextOut = raw.slice(i + 1).find(x => x.type === 'out') ?? null
      const hours = nextOut
        ? (new Date(nextOut.date_time).getTime() - new Date(p.date_time).getTime()) / 3600000
        : 0
      const notes = [p.notes, nextOut?.notes].map(note => note?.trim()).filter(Boolean).join(' · ')
      pairs.push({
        punchIn: p.date_time,
        punchOut: nextOut?.date_time ?? null,
        hoursWorked: hours,
        inAddress: placeLabel(p.address, p.latitude, p.longitude),
        outAddress: nextOut ? placeLabel(nextOut.address, nextOut.latitude, nextOut.longitude) : null,
        notes: notes || null,
      })
      i = nextOut ? raw.indexOf(nextOut) + 1 : raw.length
    } else { i++ }
  }
  pairs.sort((a, b) => new Date(b.punchIn).getTime() - new Date(a.punchIn).getTime())
  return pairs
}

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

type Tab = 'overview' | 'edit' | 'attendance' | 'payments' | 'leave' | 'documents'

const EMPLOYEE_TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'edit', label: 'Edit Profile' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'payments', label: 'Payments' },
  { id: 'leave', label: 'Leave' },
  { id: 'documents', label: 'Documents' },
]

function placeLabel(
  address: string | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  if (address?.trim()) return address.trim()
  if (latitude != null && longitude != null) return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
  return null
}
type Period = 'today' | 'week' | 'month' | 'custom'

interface PayrollReady {
  ready: boolean
  statusLabel: string
  issues: string[]
}

function checkPayrollReadiness(emp: Employee): PayrollReady {
  const info = assessPayrollReadiness({
    id: emp.id,
    name: emp.name,
    surname: emp.surname,
    is_active: emp.is_active,
    monthly_salary: emp.monthly_salary,
    hourly_rate: emp.hourly_rate,
    daily_rate: emp.daily_rate,
    shift_template_id: emp.shift_template_id,
    bank_name: emp.bank_name,
    bank_account: emp.bank_account,
    worker_type: emp.worker_type,
    employment_date: emp.employment_date,
  })
  return {
    ready: info.isReady,
    statusLabel: info.statusLabel,
    issues: [...info.issues],
  }
}

const PAYROLL_SUMMARY_MONTHS = 6

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function shiftYearMonth(yearMonth: string, delta: number) {
  const [year, month] = yearMonth.split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

function monthInstantRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return {
    start: new Date(year, month - 1, 1).toISOString(),
    end: new Date(year, month, 0, 23, 59, 59, 999).toISOString(),
  }
}

function recentYearMonths(count: number) {
  return Array.from({ length: count }, (_, index) => shiftYearMonth(currentYearMonth(), -index))
}

type MonthPay = {
  month: string
  days: number
  hours: number
  amount: number
}

function summarizeSessions(pairs: PairSession[], rate: number) {
  const days = new Set(pairs.map(pair => localISODate(new Date(pair.punchIn)))).size
  const hours = pairs.reduce((sum, pair) => sum + pair.hoursWorked, 0)
  return { days, hours, amount: hours * rate }
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
  const [branchName, setBranchName] = useState<string | null>(null)
  const [managerName, setManagerName] = useState<string | null>(null)
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
  const [punches, setPunches] = useState<PairSession[]>([])
  const [punchLoading, setPunchLoading] = useState(false)
  const [overviewMonth, setOverviewMonth] = useState(currentYearMonth)
  const [overviewPunches, setOverviewPunches] = useState<PairSession[]>([])
  const [overviewLoading, setOverviewLoading] = useState(false)
  const overviewRequestRef = useRef(0)

  // Leave
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [leaveSettings, setLeaveSettings] = useState<LeaveSettingsMap>({})
  const [leaveLoaded, setLeaveLoaded] = useState(false)

  // Documents
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [docsLoaded, setDocsLoaded] = useState(false)

  useEffect(() => { loadEmployee() }, [id])
  useEffect(() => {
    if (employee && tab === 'attendance') loadAttendance()
  }, [employee, tab, period, appliedCustomFrom, appliedCustomTo])
  useEffect(() => {
    if (employee && tab === 'overview') void loadOverview()
  }, [employee, tab, overviewMonth])
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

    const [empRes, { data: me }] = await Promise.all([
      getEmployee(supabase, member.companyId, id),
      supabase.from('employees').select('access_level').eq('id', member.employeeId).single(),
    ])

    if (!empRes.ok) {
      setError(empRes.message)
      setLoading(false)
      return
    }
    const employeeRow = empRes.data
    setEmployee(employeeRow)
    setMyAccessLevel(((me as { access_level: AccessLevel } | null)?.access_level) ?? 'employee')

    if (employeeRow) {
      const [branchRes, managerRes, extraRes] = await Promise.all([
        employeeRow.branch_id
          ? supabase.from('branches').select('name').eq('id', employeeRow.branch_id).maybeSingle()
          : Promise.resolve({ data: null }),
        employeeRow.manager_id
          ? supabase.from('employees').select('name, surname').eq('id', employeeRow.manager_id).maybeSingle()
          : Promise.resolve({ data: null }),
        listExtraBranchIds(supabase, member.companyId, employeeRow.id),
      ])
      const homeName = (branchRes.data as { name: string } | null)?.name ?? employeeRow.branch ?? null
      let extraNames: string[] = []
      if (extraRes.ok && extraRes.ids.length > 0) {
        const { data: extraBranches } = await supabase
          .from('branches')
          .select('id, name')
          .in('id', extraRes.ids)
        extraNames = ((extraBranches ?? []) as { name: string }[]).map(b => b.name).filter(Boolean)
      }
      const labels = [
        homeName ? `Main: ${homeName}` : null,
        ...extraNames.map(name => `Second: ${name}`),
      ].filter((name): name is string => Boolean(name))
      setBranchName(labels.length > 0 ? labels.join(' · ') : null)
      const mgr = managerRes.data as { name: string; surname: string } | null
      setManagerName(mgr ? `${mgr.name} ${mgr.surname}`.trim() : null)
    } else {
      setBranchName(null)
      setManagerName(null)
    }
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
      .from('time_punches')
      .select('id, employee_id, type, date_time, address, notes, latitude, longitude')
      .eq('employee_id', employee.id)
      .gte('date_time', from)
      .lt('date_time', nextDay.toISOString().split('T')[0])
      .order('date_time', { ascending: true })

    setPunches(buildPairs((data ?? []) as TimePunch[]))
    setPunchLoading(false)
  }

  async function loadOverview() {
    if (!employee) return
    const requestId = ++overviewRequestRef.current
    setOverviewLoading(true)
    const supabase = createClient()
    const { start, end } = monthInstantRange(overviewMonth)
    const { data } = await supabase
      .from('time_punches')
      .select('id, employee_id, type, date_time')
      .eq('employee_id', employee.id)
      .gte('date_time', start)
      .lte('date_time', end)
      .order('date_time', { ascending: true })
    if (requestId !== overviewRequestRef.current) return
    setOverviewPunches(buildPairs((data ?? []) as TimePunch[]))
    setOverviewLoading(false)
  }

  async function loadLeave() {
    if (!employee || !myCompanyId) return
    const supabase = createClient()
    const [{ data }, settingsRes] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('*')
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false }),
      loadLeaveSettings(supabase, myCompanyId),
    ])
    setLeaveRequests((data ?? []) as LeaveRequest[])
    if (settingsRes.ok) setLeaveSettings(settingsRes.data)
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
  const overviewStats = summarizeSessions(overviewPunches, employee.hourly_rate ?? 0)
  const overviewIsCurrentMonth = overviewMonth >= currentYearMonth()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky tab bar */}
      <div className="bg-surface border-b border-divider px-4 pt-8 pb-3 shrink-0">
        <div className="flex gap-[6px] overflow-x-auto">
          {EMPLOYEE_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'h-10 px-3 rounded-sm font-medium text-[12px] whitespace-nowrap transition-colors',
                tab === t.id ? 'bg-primary text-white' : 'bg-background text-text-secondary hover:text-text-primary'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 pr-5 space-y-4 [scrollbar-gutter:stable]">
        {tab === 'overview' && (
          <>
            <div className="bg-surface border border-divider rounded-lg px-4 py-4 flex items-start gap-[14px]">
              <div className="w-[72px] h-[72px] rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="text-[24px] font-bold text-white">{initials}</span>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-[19px] font-bold text-text-primary truncate">{fullName}</p>
                {employee.position && (
                  <p className="text-[13px] text-text-secondary">{employee.position}</p>
                )}
                <span className={cn(
                  'inline-flex text-[11px] font-semibold px-2 py-[3px] rounded-[10px]',
                  employee.is_active ? 'bg-success-dark text-[#166534]' : 'bg-error-dark text-[#991B1B]'
                )}>
                  {employee.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            <div className={cn(
              'px-3 py-[10px] rounded-[10px] border',
              payrollReadiness.ready ? 'border-success bg-success-dark/40' : 'border-warning bg-warning-dark/40'
            )}>
              <p className={cn('text-[13px] font-semibold', payrollReadiness.ready ? 'text-success' : 'text-warning')}>
                Payroll: {payrollReadiness.statusLabel}
              </p>
              {payrollReadiness.issues.map(issue => (
                <p key={issue} className="text-[12px] text-text-secondary">• {issue}</p>
              ))}
            </div>

            <div className="bg-surface border border-divider rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider">
                <p className="text-[14px] font-semibold text-text-primary">{monthLabel(overviewMonth)}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOverviewMonth(month => shiftYearMonth(month, -1))}
                    className="h-9 w-9 rounded-md border border-border bg-surface text-text-primary"
                    aria-label="Previous month"
                  >
                    <span className="material-icons text-[18px]">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverviewMonth(month => shiftYearMonth(month, 1))}
                    disabled={overviewIsCurrentMonth}
                    className="h-9 w-9 rounded-md border border-border bg-surface text-text-primary disabled:opacity-40"
                    aria-label="Next month"
                  >
                    <span className="material-icons text-[18px]">chevron_right</span>
                  </button>
                </div>
              </div>
              {overviewLoading ? (
                <div className="py-8 text-center text-[13px] text-text-disabled">Loading…</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
                  <KpiCard label="Days worked" value={String(overviewStats.days)} color="text-primary" />
                  <KpiCard label="Hours" value={`${overviewStats.hours.toFixed(1)}h`} color="text-primary" />
                  <KpiCard
                    label="Pay"
                    value={(employee.hourly_rate ?? 0) > 0 ? formatCurrency(overviewStats.amount) : '—'}
                    color="text-success"
                  />
                  <KpiCard label="Punches" value={String(overviewPunches.length)} color="text-text-primary" />
                </div>
              )}
            </div>

            <div className="bg-surface border border-divider rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-divider">
                <p className="text-[14px] font-semibold text-text-primary">General information</p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <InfoCell label="Branch" value={branchName ?? '—'} />
                <InfoCell label="Position" value={employee.position ?? '—'} />
                <InfoCell label="ID number" value={employee.id_number ?? '—'} />
                <InfoCell label="Email" value={employee.email ?? '—'} />
                <InfoCell label="Employment" value={employee.employment_type ? labelEmploymentType(employee.employment_type) : '—'} />
                <InfoCell label="Department" value={employee.department ?? '—'} />
                <InfoCell label="Reports to" value={managerName ?? '—'} />
                <InfoCell label="Phone" value={employee.phone ?? '—'} />
                <InfoCell label="Started" value={employee.employment_date ? formatDate(employee.employment_date) : '—'} />
              </div>
            </div>
          </>
        )}

        {tab === 'edit' && (
          <EditEmployeePage
            embedded
            onSaved={() => {
              void loadEmployee()
              setTab('overview')
            }}
          />
        )}

        {tab === 'attendance' && (
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
            <div className="overflow-x-auto">
              {punchLoading ? (
                <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
              ) : punches.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-text-disabled">No records for this period</div>
              ) : (
                <table className="w-full text-[13px]" style={{ minWidth: 860 }}>
                  <thead>
                    <tr className="border-b border-divider bg-surface-elevated">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Date</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Time in</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">In location</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Time out</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Out location</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Hours</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {punches.map((p, i) => (
                      <tr key={p.punchIn + i} className="border-b border-divider last:border-0">
                        <td className="px-4 py-3 text-text-primary whitespace-nowrap">{formatDate(p.punchIn)}</td>
                        <td className="px-4 py-3 text-success font-medium whitespace-nowrap">{formatDateTime(p.punchIn)}</td>
                        <td className="px-4 py-3 text-text-secondary max-w-[200px] truncate">{p.inAddress ?? '—'}</td>
                        <td className="px-4 py-3 text-text-primary whitespace-nowrap">
                          {p.punchOut ? formatDateTime(p.punchOut) : 'Open'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary max-w-[200px] truncate">{p.outAddress ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-text-primary">
                          {p.hoursWorked > 0 ? p.hoursWorked.toFixed(1) : '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary max-w-[220px] truncate">{p.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === 'payments' && <PaymentsTab employee={employee} />}
        {tab === 'leave' && (
          <LeaveTab
            leaveRequests={leaveRequests}
            employeeId={employee.id}
            leaveSettings={leaveSettings}
          />
        )}
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
      <p className="text-[13px] font-medium text-text-primary break-words">{value}</p>
    </div>
  )
}

function PaymentsTab({ employee }: { employee: Employee }) {
  const [rows, setRows] = useState<MonthPay[]>([])
  const [loading, setLoading] = useState(true)
  const rate = employee.hourly_rate ?? 0

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const months = recentYearMonths(PAYROLL_SUMMARY_MONTHS)
      const supabase = createClient()
      const { start } = monthInstantRange(months[months.length - 1])
      const { end } = monthInstantRange(months[0])
      const { data } = await supabase
        .from('time_punches')
        .select('id, employee_id, type, date_time')
        .eq('employee_id', employee.id)
        .gte('date_time', start)
        .lte('date_time', end)
        .order('date_time', { ascending: true })
      if (cancelled) return
      const pairs = buildPairs((data ?? []) as TimePunch[])
      const byMonth = new Map<string, PairSession[]>()
      for (const pair of pairs) {
        const key = `${new Date(pair.punchIn).getFullYear()}-${String(new Date(pair.punchIn).getMonth() + 1).padStart(2, '0')}`
        const list = byMonth.get(key) ?? []
        list.push(pair)
        byMonth.set(key, list)
      }
      setRows(months.map(month => ({
        month,
        ...summarizeSessions(byMonth.get(month) ?? [], rate),
      })))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [employee.id, rate])

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-semibold text-text-primary">Payroll summary</p>
        <p className="text-[12px] text-text-secondary mt-1">
          Hours times the hourly rate for each of the last {PAYROLL_SUMMARY_MONTHS} months.
        </p>
      </div>
      {loading ? (
        <p className="text-center text-[13px] text-text-disabled py-8">Loading…</p>
      ) : (
        <div className="bg-surface border border-divider rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Month</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Days</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Hours</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.month} className="border-b border-divider last:border-0">
                    <td className="px-4 py-3 text-text-primary whitespace-nowrap">{monthLabel(row.month)}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">{row.days}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">{row.hours.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-text-primary">
                      {rate > 0 ? formatCurrency(row.amount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function LeaveTab({
  leaveRequests,
  employeeId,
  leaveSettings,
}: {
  leaveRequests: LeaveRequest[]
  employeeId: string
  leaveSettings: LeaveSettingsMap
}) {
  const yearStart = `${new Date().getFullYear()}-01-01`

  const byType = leaveRequests
    .filter(r => r.status === 'approved' && r.start_date >= yearStart)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.leave_type] = (acc[r.leave_type] ?? 0) + (r.total_days ?? 0)
      return acc
    }, {})

  const leaveTypes = LEAVE_TYPES.map(t => t.key).filter(
    lt => (byType[lt] ?? 0) > 0 || leaveRequests.some(r => r.leave_type === lt)
  )
  const customNames = readCustomLeaveTypes(leaveSettings).map(t => t.name)
  // Always show core types even with zero usage, plus company policies.
  const balanceTypes = Array.from(new Set([
    ...(leaveTypes.length > 0 ? leaveTypes : LEAVE_TYPES.slice(0, 4).map(t => t.key)),
    ...customNames,
  ]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-text-primary">Leave History</p>
        <Link
          href={`/dashboard/leave/apply?employeeId=${employeeId}`}
          className="h-9 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors inline-flex items-center"
        >
          Apply Leave
        </Link>
      </div>

      {/* Balance summary */}
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
              {balanceTypes.map(lt => {
                const annual = getCompanyAnnualDays(lt, leaveSettings)
                const used = byType[lt] ?? 0
                const remaining = Math.max(0, annual - used)
                return (
                  <tr key={lt} className="border-b border-divider last:border-0">
                    <td className="px-4 py-2.5 font-medium text-text-primary">{lt}</td>
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
                  {formatDate(req.start_date)} – {formatDate(req.end_date)} · {req.total_days} day{req.total_days !== 1 ? 's' : ''}
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
