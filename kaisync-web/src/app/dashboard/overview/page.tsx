'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { timeGreeting, localISODate } from '@/lib/utils'
import { EMPLOYEE_SAFE_SELECT } from '@/lib/employee-columns'
import type { Employee } from '@/types/database'
import { PwaInstallButton } from '@/components/PwaInstallButton'
import {
  hiddenCommercial,
  initialCommercial,
  overviewPresentation,
  readyCommercial,
  type CommercialSnapshot,
} from '@/lib/overview-loading'
import {
  ATTENDANCE_PAGE_SIZE,
  attendancePageCount,
  attendancePageItems,
  attendanceRangeLabel,
} from '@/lib/attendance-page'

interface TimePunch { id: string; employee_id: string; type: string; date_time: string }
interface EmpRow {
  id: string
  name: string
  surname: string
  position: string | null
  /** When true, employee is paid full salary without clocking — exclude from attendance gaps. */
  pay_full_monthly_salary?: boolean | null
}

function requiresDailyClockIn(e: EmpRow): boolean {
  return !e.pay_full_monthly_salary
}

function todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}

function formatElapsed(ms: number) {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function OverviewPage() {
  const router = useRouter()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [employeeId, setEmployeeId] = useState('')

  const [isClockedIn, setIsClockedIn] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [punchLoading, setPunchLoading] = useState(false)
  const clockInTimeRef  = useRef<string | null>(null)
  const baseElapsedRef  = useRef<number>(0)
  const cIdRef          = useRef<string>('')
  const eIdRef          = useRef<string>('')
  const empsRef         = useRef<EmpRow[]>([])

  const [kpi, setKpi] = useState({
    /** Active employees who must clock in (excludes pay-full-monthly / no-clock staff). */
    attendanceExpected: 0,
    clockedIn: 0,
    pendingLeave: 0,
    openIncidents: 0,
  })
  const [allEmployees, setAllEmployees] = useState<EmpRow[]>([])
  const [notClockedInIds, setNotClockedInIds] = useState<Set<string>>(new Set())
  const [onLeaveToday, setOnLeaveToday] = useState<{ id: string; name: string }[]>([])
  const [absentToday, setAbsentToday] = useState<{ id: string; name: string; reason: string }[]>([])
  const [markAbsentLoading, setMarkAbsentLoading] = useState<string | null>(null)
  const [noClockLoading, setNoClockLoading] = useState<string | null>(null)
  const [markAbsentError, setMarkAbsentError] = useState<string | null>(null)
  const [markAbsentSuccess, setMarkAbsentSuccess] = useState<string | null>(null)
  const [markAllConfirm, setMarkAllConfirm] = useState(false)
  const [markAllProgress, setMarkAllProgress] = useState<{ done: number; total: number } | null>(null)
  const [unsignedPage, setUnsignedPage] = useState(1)
  const [absentPage, setAbsentPage] = useState(1)

  const [commercial, setCommercial] = useState<CommercialSnapshot>(initialCommercial)
  const loadIdRef = useRef(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  // Tick clock every minute
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Recalc elapsed whenever now changes — uses base + live delta
  useEffect(() => {
    if (!isClockedIn || !clockInTimeRef.current) return
    setElapsedMs(
      baseElapsedRef.current + (now.getTime() - new Date(clockInTimeRef.current).getTime())
    )
  }, [now, isClockedIn])

  async function refreshPunchData(cid: string, empList: EmpRow[]) {
    const supabase = createClient()
    const { data } = await supabase
      .from('time_punches')
      .select('id, employee_id, type, date_time')
      .eq('company_id', cid)
      .gte('date_time', todayStart())
      .order('date_time', { ascending: true })
    const punches = (data ?? []) as TimePunch[]
    const latestByEmp = new Map<string, string>()
    for (const p of punches) latestByEmp.set(p.employee_id, p.type)
    const attendanceEmpIds = new Set(empList.filter(requiresDailyClockIn).map(e => e.id))
    const clockedInIds = new Set(
      [...latestByEmp.entries()]
        .filter(([id, t]) => t === 'in' && attendanceEmpIds.has(id))
        .map(([id]) => id),
    )
    setKpi(prev => ({
      ...prev,
      clockedIn: clockedInIds.size,
      attendanceExpected: attendanceEmpIds.size,
    }))
    const punchedTodayIds = new Set(punches.map(p => p.employee_id))
    setNotClockedInIds(new Set(
      empList
        .filter(e => requiresDailyClockIn(e) && !punchedTodayIds.has(e.id))
        .map(e => e.id),
    ))
    const selfClockedIn = latestByEmp.get(eIdRef.current) === 'in'
    setIsClockedIn(selfClockedIn)
  }

  // Realtime subscription for punch events
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel('overview-punches-rt')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'time_punches',
        filter: `company_id=eq.${companyId}`,
      }, () => {
        if (cIdRef.current && empsRef.current.length > 0) {
          refreshPunchData(cIdRef.current, empsRef.current)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyId])

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current
    const stillCurrent = () => loadIdRef.current === loadId
    setLoading(true)
    setCommercial(initialCommercial())
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!stillCurrent()) return
    if (!member) { setError('not_linked'); setLoading(false); return }

    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    cIdRef.current = member.companyId
    eIdRef.current = member.employeeId

    // Everything below only needs the company/employee ids, so it starts in one parallel
    // wave (own row, today's punches, KPIs, and the quotes.view permission check).
    // The permission result still gates the commercial figures further down.
    const todayDate = localISODate()
    const empPromise = supabase
      .from('employees').select(`${EMPLOYEE_SAFE_SELECT}, companies(name)`).eq('id', member.employeeId).maybeSingle()
    // Fetch today's time_punches for whole company (needed for KPIs + attendance)
    const punchesPromise = supabase
      .from('time_punches').select('id, employee_id, type, date_time')
      .eq('company_id', member.companyId).gte('date_time', todayStart())
      .order('date_time', { ascending: true })
    const kpiPromise = Promise.all([
      supabase.from('leave_requests').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).eq('status', 'pending'),
      supabase.from('incident_reports').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).eq('status', 'open'),
      supabase.from('employees').select('id, name, surname, position, pay_full_monthly_salary')
        .eq('company_id', member.companyId).eq('is_active', true).order('name'),
      supabase.from('leave_requests')
        .select('id, employee_id, employees(name, surname)')
        .eq('company_id', member.companyId)
        .eq('status', 'approved')
        .lte('start_date', todayDate)
        .gte('end_date', todayDate),
      supabase.from('daily_absences')
        .select('id, employee_id, reason, employees(name, surname)')
        .eq('company_id', member.companyId)
        .eq('date', todayDate),
    ])
    /** true / false = permission answer; null = the check failed (treated as hidden). */
    const quotesPermissionPromise: Promise<boolean | null> = (async () => {
      try {
        const { data: canViewQuotes, error: permissionError } = await supabase.rpc('user_has_permission', {
          p_company_id: member.companyId,
          p_permission_key: 'quotes.view',
        })
        return !permissionError && Boolean(canViewQuotes)
      } catch {
        return null
      }
    })()

    const [{ data: empData }, { data: todayPunches }, kpiResults] = await Promise.all([
      empPromise, punchesPromise, kpiPromise,
    ])
    if (!stillCurrent()) return
    if (!empData) { setLoading(false); return }
    setEmployee(empData as unknown as Employee)
    setCompanyName((empData as unknown as { companies: { name: string } | null }).companies?.name ?? '')

    const punches = (todayPunches ?? []) as TimePunch[]

    // Build latest punch per employee
    const latestByEmp = new Map<string, string>()
    for (const p of punches) latestByEmp.set(p.employee_id, p.type)

    // Self punch status — base (completed sessions) stored separately from live delta
    const selfPunches = punches.filter(p => p.employee_id === member.employeeId)
    let baseMs = 0
    let lastInTime: string | null = null
    for (const p of selfPunches) {
      if (p.type === 'in') {
        lastInTime = p.date_time
      } else if (p.type === 'out' && lastInTime) {
        baseMs += new Date(p.date_time).getTime() - new Date(lastInTime).getTime()
        lastInTime = null
      }
    }
    const selfClockedIn = latestByEmp.get(member.employeeId) === 'in'
    if (selfClockedIn && lastInTime) {
      clockInTimeRef.current = lastInTime
      baseElapsedRef.current = baseMs
      setElapsedMs(baseMs + (Date.now() - new Date(lastInTime).getTime()))
    } else {
      clockInTimeRef.current = null
      baseElapsedRef.current = baseMs
      setElapsedMs(baseMs)
    }
    setIsClockedIn(selfClockedIn)

    // KPI results (requests already ran in the parallel wave above)
    const [leaveRes, incRes, empsRes, onLeaveRes, absentRes] = kpiResults

    const employees = (empsRes.data ?? []) as EmpRow[]
    const attendanceEmployees = employees.filter(requiresDailyClockIn)
    const attendanceEmpIds = new Set(attendanceEmployees.map(e => e.id))
    const clockedInIds = new Set(
      [...latestByEmp.entries()]
        .filter(([id, t]) => t === 'in' && attendanceEmpIds.has(id))
        .map(([id]) => id),
    )

    setKpi({
      attendanceExpected: attendanceEmployees.length,
      clockedIn: clockedInIds.size,
      pendingLeave: leaveRes.count ?? 0,
      openIncidents: incRes.count ?? 0,
    })

    setAllEmployees(employees)
    empsRef.current = employees
    const punchedTodayIds = new Set(punches.map(p => p.employee_id))
    const onLeaveIds = new Set((onLeaveRes.data ?? []).map((r: { employee_id: string }) => r.employee_id))
    const absentIds = new Set((absentRes.data ?? []).map((r: { employee_id: string }) => r.employee_id))
    setNotClockedInIds(new Set(
      attendanceEmployees
        .filter(e => !punchedTodayIds.has(e.id) && !onLeaveIds.has(e.id) && !absentIds.has(e.id))
        .map(e => e.id),
    ))

    setOnLeaveToday((onLeaveRes.data ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees as { name: string; surname: string } | null
      return {
        id: r.employee_id as string,
        name: emp ? `${emp.name} ${emp.surname}` : 'Employee',
      }
    }))
    setAbsentToday((absentRes.data ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees as { name: string; surname: string } | null
      return {
        id: r.employee_id as string,
        name: emp ? `${emp.name} ${emp.surname}` : 'Employee',
        reason: (r.reason as string) || 'absent',
      }
    }))

    // Core attendance and focus metrics are ready. Finance KPIs live on Money —
    // here we only keep quotes.view so Quick Actions can offer New Quote / Invoice.
    setLoading(false)

    const permissionAnswer = await quotesPermissionPromise
    if (!stillCurrent()) return
    if (!permissionAnswer) {
      setCommercial(hiddenCommercial())
      return
    }
    setCommercial(readyCommercial(0, 0, 0))
  }, [])

  useEffect(() => {
    // Data load on mount (unchanged pattern: load() sets its loading flags before its first
    // await). The rule started flagging it once the load became one parallel wave.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => { loadIdRef.current += 1 }
  }, [load])

  async function handlePunch() {
    if (!companyId || !employeeId) return
    setPunchLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('time_punches').insert({
      company_id: companyId,
      employee_id: employeeId,
      type: isClockedIn ? 'out' : 'in',
      date_time: new Date().toISOString(),
    })
    if (err) console.error('punch error:', err.message)
    await load()
    setPunchLoading(false)
  }

  async function markAbsent(empId: string) {
    if (!companyId) return
    setMarkAbsentLoading(empId)
    setMarkAbsentError(null)
    setMarkAbsentSuccess(null)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const today = localISODate()
    const target = allEmployees.find(e => e.id === empId)
    const targetName = target ? `${target.name} ${target.surname}` : 'Employee'
    const { error: err } = await supabase.rpc('employee_report_absence', {
      p_company_id:    companyId,
      p_employee_id:   empId,
      p_date:          today,
      p_reason:        'absent',
      p_note:          'Marked absent by HR from overview',
      p_session_token: session?.access_token ?? null,
    })
    setMarkAbsentLoading(null)
    if (err) {
      setMarkAbsentError(`Could not mark ${targetName} absent: ${err.message}`)
      return
    }
    setMarkAbsentSuccess(`${targetName} marked absent for today.`)
    await load()
  }

  async function markAllAbsent(targets: EmpRow[]) {
    if (!companyId || targets.length === 0 || markAllProgress) return
    setMarkAllConfirm(false)
    setMarkAbsentError(null)
    setMarkAbsentSuccess(null)
    setMarkAllProgress({ done: 0, total: targets.length })
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const today = localISODate()
    const token = session?.access_token ?? null
    const failed: string[] = []
    let firstError: string | null = null
    const batchSize = 5
    for (let i = 0; i < targets.length; i += batchSize) {
      const slice = targets.slice(i, i + batchSize)
      const results = await Promise.all(slice.map(async (emp) => {
        const { error: err } = await supabase.rpc('employee_report_absence', {
          p_company_id: companyId,
          p_employee_id: emp.id,
          p_date: today,
          p_reason: 'absent',
          p_note: 'Marked absent by HR from overview',
          p_session_token: token,
        })
        return { name: `${emp.name} ${emp.surname}`.trim(), err }
      }))
      for (const result of results) {
        if (!result.err) continue
        failed.push(result.name)
        if (!firstError) firstError = result.err.message
      }
      setMarkAllProgress({ done: Math.min(i + slice.length, targets.length), total: targets.length })
    }
    const marked = targets.length - failed.length
    setMarkAllProgress(null)
    if (failed.length === 0) {
      setMarkAbsentSuccess(
        marked === 1 ? 'Marked 1 person absent for today.' : `Marked ${marked} people absent for today.`,
      )
    } else if (marked === 0) {
      setMarkAbsentError(firstError ? `Could not mark anyone absent: ${firstError}` : 'Could not mark anyone absent.')
    } else {
      const shown = failed.slice(0, 3).join(', ')
      const more = failed.length > 3 ? ` and ${failed.length - 3} more` : ''
      setMarkAbsentError(
        `Marked ${marked} absent. Could not mark ${shown}${more}${firstError ? `: ${firstError}` : '.'}`,
      )
    }
    await load()
  }

  async function excuseClockIn(empId: string) {
    if (!companyId) return
    setNoClockLoading(empId)
    setMarkAbsentError(null)
    setMarkAbsentSuccess(null)
    const supabase = createClient()
    const target = allEmployees.find(e => e.id === empId)
    const targetName = target ? `${target.name} ${target.surname}` : 'Employee'
    const { error: err } = await supabase
      .from('employees')
      .update({ pay_full_monthly_salary: true })
      .eq('id', empId)
      .eq('company_id', companyId)
    setNoClockLoading(null)
    if (err) {
      setMarkAbsentError(`Could not excuse ${targetName} from clock-in: ${err.message}`)
      return
    }
    setMarkAbsentSuccess(`${targetName} does not have to clock in. Payroll still pays the full salary.`)
    await load()
  }

  const greeting = timeGreeting()
  const notSignedInList = allEmployees.filter(e => notClockedInIds.has(e.id))
  const unsignedPages = attendancePageCount(notSignedInList.length)
  const unsignedCurrent = Math.min(unsignedPage, unsignedPages)
  const unsignedRows = attendancePageItems(notSignedInList, unsignedCurrent)
  const absentPages = attendancePageCount(absentToday.length)
  const absentCurrent = Math.min(absentPage, absentPages)
  const absentRows = attendancePageItems(absentToday, absentCurrent)
  const presentation = overviewPresentation(loading, commercial.phase)

  if (presentation.showCoreLoading) return (
    <div className="flex items-center justify-center h-64">
      <span className="text-[14px] text-text-secondary">Loading…</span>
    </div>
  )

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>Please contact your administrator.
        </p>
      </div>
    </div>
  )

  const attendanceDenom = kpi.attendanceExpected
  const pct = attendanceDenom > 0 ? Math.round((kpi.clockedIn / attendanceDenom) * 100) : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 max-w-4xl mx-auto space-y-4">

        {/* ── Greeting header ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-primary/80">{greeting}</p>
            <h1 className="text-[20px] font-bold text-text-primary tracking-tight truncate">
              {employee?.name} {employee?.surname}
            </h1>
            <p className="text-[12px] text-text-secondary mt-0.5 truncate">{companyName}</p>
          </div>
          <p className="text-[11px] text-text-secondary shrink-0 pt-1 text-right leading-snug max-w-[9rem]">
            {formatDate(now)}
          </p>
        </div>

        {/* ── Clock card ── */}
        <div
          className="rounded-xl px-3.5 py-3 flex items-center gap-3 border"
          style={{
            background: isClockedIn
              ? 'linear-gradient(135deg, #052e16, #14532d)'
              : 'linear-gradient(135deg, #F8FAFF, #EEF3FF)',
            borderColor: isClockedIn ? '#166534' : 'color-mix(in srgb, var(--color-primary) 18%, var(--color-divider))',
          }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: isClockedIn ? 'rgba(34,197,94,0.18)' : 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
          >
            <span
              className="material-icons text-[18px]"
              style={{ color: isClockedIn ? '#22c55e' : 'var(--color-primary)' }}
            >
              {isClockedIn ? 'timer' : 'timer_off'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[13px] font-semibold"
              style={{ color: isClockedIn ? '#86efac' : 'var(--color-text-primary)' }}
            >
              {isClockedIn ? 'You are Clocked In' : 'You are Clocked Out'}
            </p>
            <p className="text-[11px]" style={{ color: isClockedIn ? '#4ade80' : 'var(--color-text-secondary)' }}>
              Today: {formatElapsed(elapsedMs)}
            </p>
            <Link
              href="/dashboard/team-punch"
              className="text-[11px] font-medium hover:opacity-80 transition-opacity"
              style={{ color: isClockedIn ? '#4ade80' : 'var(--color-primary)' }}
            >
              Clock in/out for my team →
            </Link>
          </div>
          <button
            onClick={handlePunch}
            disabled={punchLoading}
            className="h-9 px-4 rounded-lg text-[12px] font-bold text-white shrink-0 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: isClockedIn ? '#ef4444' : '#22c55e' }}
          >
            {punchLoading ? '…' : isClockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </div>

        <PwaInstallButton
          variant="banner"
          className="flex w-full items-center justify-center gap-1.5 h-8 rounded-lg border border-primary/35 bg-primary/10 text-primary text-[11px] font-semibold transition-colors"
        />

        {/* ── Focus metrics (lean ops strip) ── */}
        <div className="grid grid-cols-3 gap-2">
          <FocusMetric
            href="/dashboard/attendance"
            icon="timer"
            label="Clocked In"
            value={kpi.clockedIn}
            hint={attendanceDenom > 0 ? `of ${attendanceDenom}` : undefined}
            accent="emerald"
          />
          <FocusMetric
            href="/dashboard/leave"
            icon="event_available"
            label="Pending Leave"
            value={kpi.pendingLeave}
            accent="amber"
          />
          <FocusMetric
            href="/dashboard/incidents"
            icon="warning"
            label="Open Incidents"
            value={kpi.openIncidents}
            accent="rose"
          />
        </div>

        {/* ── Quick Actions (above attendance so they stay reachable) ── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/55 mb-2">Quick Actions</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => router.push('/dashboard/employees/new')}
              className="h-9 px-3.5 rounded-lg text-[12px] font-semibold text-white shadow-sm shadow-primary/20"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              + Add Employee
            </button>
            <button
              onClick={() => router.push('/dashboard/jobs/new')}
              className="h-9 px-3.5 rounded-lg text-[12px] font-semibold text-text-primary bg-white border border-divider hover:bg-surface-elevated"
            >
              + New Job
            </button>
            {presentation.showCommercialActions && (
              <>
                <button
                  onClick={() => router.push('/dashboard/money/quotes/new')}
                  className="h-9 px-3.5 rounded-lg text-[12px] font-semibold text-text-primary bg-white border border-divider hover:bg-surface-elevated"
                >
                  + New Quote
                </button>
                <button
                  onClick={() => router.push('/dashboard/money/invoices/new')}
                  className="h-9 px-3.5 rounded-lg text-[12px] font-semibold text-text-primary bg-white border border-divider hover:bg-surface-elevated"
                >
                  + New Invoice
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Today's Attendance ── */}
        <div className="rounded-xl overflow-hidden border border-divider bg-surface">
          <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
            <div>
              <p className="text-[13px] font-semibold text-text-primary">TODAY&apos;S ATTENDANCE</p>
              <p className="text-[11px] text-text-secondary mt-0.5">employees currently clocked in</p>
            </div>
            <span className="text-[13px] font-bold text-text-secondary">
              {kpi.clockedIn} / {attendanceDenom}
            </span>
          </div>

          {/* Progress bar */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-text-secondary">
                {kpi.clockedIn} of {attendanceDenom} clocked in
              </span>
              <span className="text-[11px] font-semibold text-text-primary">{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${attendanceDenom > 0 ? (kpi.clockedIn / attendanceDenom) * 100 : 0}%`,
                  backgroundColor: kpi.clockedIn === attendanceDenom && attendanceDenom > 0 ? '#22c55e' : '#3b82f6',
                }}
              />
            </div>
          </div>

          {onLeaveToday.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-text-secondary tracking-wide">
                ON LEAVE TODAY
              </p>
              {onLeaveToday.map(row => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-2 border-b border-divider">
                  <span className="material-icons text-[18px] text-warning">event_available</span>
                  <p className="text-[13px] text-text-primary">{row.name}</p>
                </div>
              ))}
            </div>
          )}

          {absentToday.length > 0 && (
            <div className="border-t border-divider mt-3">
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <p className="text-[11px] font-semibold text-text-secondary tracking-wide">REPORTED ABSENT TODAY</p>
                <p className="text-[12px] text-text-secondary">{attendanceRangeLabel(absentToday.length, absentCurrent)}</p>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-y border-divider">
                    <th className="data-th" style={{ padding: '6px 16px' }}>Name</th>
                    <th className="data-th" style={{ padding: '6px 16px' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {absentRows.map(row => (
                    <tr key={row.id} className="border-b border-divider last:border-0">
                      <td className="data-td" style={{ padding: '6px 16px' }}>
                        <p className="text-[13px] text-text-primary truncate">{row.name}</p>
                      </td>
                      <td className="data-td" style={{ padding: '6px 16px' }}>
                        <p className="text-[12px] text-text-secondary capitalize">{row.reason.replace(/_/g, ' ')}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <AttendancePager page={absentCurrent} pages={absentPages} total={absentToday.length} onPage={setAbsentPage} />
            </div>
          )}

          {(markAbsentError || markAbsentSuccess) && (
            <div
              className="mx-4 mt-3 px-3 py-2 rounded-lg text-[12px]"
              style={{
                backgroundColor: markAbsentError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                border: `1px solid ${markAbsentError ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'}`,
                color: markAbsentError ? '#f87171' : '#4ade80',
              }}
            >
              {markAbsentError ?? markAbsentSuccess}
            </div>
          )}

          {notSignedInList.length === 0 ? (
            <div className="py-8 text-center">
              <span className="material-icons text-[32px] text-text-disabled">check_circle</span>
              <p className="text-[13px] text-text-secondary mt-1">
                {onLeaveToday.length || absentToday.length
                  ? 'Everyone else is accounted for'
                  : 'Everyone is clocked in'}
              </p>
            </div>
          ) : (
            <div className="border-t border-divider mt-3">
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <p className="text-[11px] font-semibold text-text-secondary tracking-wide">NOT SIGNED IN TODAY</p>
                  <p className="text-[12px] text-text-secondary">{attendanceRangeLabel(notSignedInList.length, unsignedCurrent)}</p>
                </div>
                {markAllConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-text-primary">
                      Mark all {notSignedInList.length} absent?
                    </span>
                    <button
                      type="button"
                      onClick={() => void markAllAbsent(notSignedInList)}
                      className="h-8 px-3 text-[12px] font-semibold rounded-lg text-white disabled:opacity-50"
                      style={{ backgroundColor: '#d97706' }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setMarkAllConfirm(false)}
                      className="btn-outlined h-8 px-3 text-[12px]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMarkAllConfirm(true)}
                    disabled={markAllProgress !== null || markAbsentLoading !== null || noClockLoading !== null}
                    className="h-8 px-3 text-[12px] font-semibold rounded-lg border transition-opacity disabled:opacity-50"
                    style={{ borderColor: '#d97706', color: '#d97706', backgroundColor: 'rgba(217,119,6,0.08)' }}
                  >
                    {markAllProgress
                      ? `Marking ${markAllProgress.done} of ${markAllProgress.total}`
                      : 'Mark all absent'}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-y border-divider">
                    <th className="data-th" style={{ padding: '6px 16px' }}>Name</th>
                    <th className="data-th" style={{ padding: '6px 16px' }}>Position</th>
                    <th className="data-th" style={{ padding: '6px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {unsignedRows.map(emp => (
                    <tr key={emp.id} className="border-b border-divider last:border-0">
                      <td className="data-td" style={{ padding: '6px 16px' }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-semibold"
                            style={{ backgroundColor: 'var(--color-primary)' }}
                          >
                            {emp.name.charAt(0)}{emp.surname.charAt(0)}
                          </div>
                          <p className="text-[13px] font-medium text-text-primary truncate">
                            {emp.name} {emp.surname}
                          </p>
                        </div>
                      </td>
                      <td className="data-td" style={{ padding: '6px 16px' }}>
                        <p className="text-[12px] text-text-secondary truncate">{emp.position || '—'}</p>
                      </td>
                      <td className="data-td" style={{ padding: '6px 16px' }}>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => excuseClockIn(emp.id)}
                            disabled={noClockLoading === emp.id || markAbsentLoading !== null || markAllProgress !== null}
                            className="h-8 px-2.5 text-[12px] font-medium rounded-lg border transition-opacity disabled:opacity-50"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' }}
                          >
                            {noClockLoading === emp.id ? '…' : 'No clock-in'}
                          </button>
                          <button
                            type="button"
                            onClick={() => markAbsent(emp.id)}
                            disabled={markAbsentLoading !== null || noClockLoading !== null || markAllProgress !== null}
                            className="h-8 px-2.5 text-[12px] font-medium rounded-lg border transition-opacity disabled:opacity-50"
                            style={{ borderColor: '#d97706', color: '#d97706', backgroundColor: 'rgba(217,119,6,0.08)' }}
                          >
                            {markAbsentLoading === emp.id ? '…' : 'Mark Absent'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <AttendancePager page={unsignedCurrent} pages={unsignedPages} total={notSignedInList.length} onPage={setUnsignedPage} />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function AttendancePager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number
  pages: number
  total: number
  onPage: (page: number) => void
}) {
  if (total <= ATTENDANCE_PAGE_SIZE) return null
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-divider">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-[12px] text-text-secondary">{page} of {pages}</span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="btn-outlined h-7 px-2.5 text-[12px] disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}

const FOCUS_ACCENT = {
  emerald: {
    wrap: 'bg-emerald-500/[0.08] border-emerald-500/20 hover:bg-emerald-500/[0.12]',
    iconWrap: 'bg-emerald-500/15 text-emerald-600',
    value: 'text-emerald-700',
  },
  amber: {
    wrap: 'bg-amber-500/[0.08] border-amber-500/20 hover:bg-amber-500/[0.12]',
    iconWrap: 'bg-amber-500/15 text-amber-600',
    value: 'text-amber-700',
  },
  rose: {
    wrap: 'bg-rose-500/[0.08] border-rose-500/20 hover:bg-rose-500/[0.12]',
    iconWrap: 'bg-rose-500/15 text-rose-600',
    value: 'text-rose-700',
  },
} as const

function FocusMetric({
  href,
  icon,
  label,
  value,
  hint,
  accent,
}: {
  href: string
  icon: string
  label: string
  value: number
  hint?: string
  accent: keyof typeof FOCUS_ACCENT
}) {
  const tone = FOCUS_ACCENT[accent]
  return (
    <Link
      href={href}
      className={`rounded-xl border px-2.5 py-2.5 transition-colors ${tone.wrap}`}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${tone.iconWrap}`}>
        <span className="material-icons text-[15px]">{icon}</span>
      </div>
      <p className={`text-[20px] font-bold leading-none tracking-tight ${tone.value}`}>
        {value}
        {hint ? (
          <span className="text-[10px] font-semibold text-text-secondary ml-1">{hint}</span>
        ) : null}
      </p>
      <p className="text-[10px] font-medium text-text-secondary mt-1 leading-tight">{label}</p>
    </Link>
  )
}
