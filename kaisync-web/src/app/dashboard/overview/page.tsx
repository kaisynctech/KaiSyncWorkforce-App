'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { timeGreeting } from '@/lib/utils'
import type { Employee } from '@/types/database'

interface TimePunch { id: string; employee_id: string; type: string; date_time: string }
interface EmpRow { id: string; name: string; surname: string; position: string | null }

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

  const [kpi, setKpi] = useState({ headcount: 0, clockedIn: 0, activeJobs: 0, pendingLeave: 0, openIncidents: 0, pendingPay: 0 })
  const [allEmployees, setAllEmployees] = useState<EmpRow[]>([])
  const [notClockedInIds, setNotClockedInIds] = useState<Set<string>>(new Set())
  const [markAbsentLoading, setMarkAbsentLoading] = useState<string | null>(null)

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
    const clockedInIds = new Set(
      [...latestByEmp.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
    )
    setKpi(prev => ({ ...prev, clockedIn: clockedInIds.size }))
    setNotClockedInIds(new Set(empList.filter(e => !clockedInIds.has(e.id)).map(e => e.id)))
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
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    cIdRef.current = member.companyId
    eIdRef.current = member.employeeId

    const { data: empData } = await supabase
      .from('employees').select('*, companies(name)').eq('id', member.employeeId).maybeSingle()
    if (!empData) { setLoading(false); return }
    setEmployee(empData as Employee)
    setCompanyName((empData as { companies: { name: string } | null }).companies?.name ?? '')

    // Fetch today's time_punches for whole company (needed for KPIs + attendance)
    const { data: todayPunches } = await supabase
      .from('time_punches').select('id, employee_id, type, date_time')
      .eq('company_id', member.companyId).gte('date_time', todayStart())
      .order('date_time', { ascending: true })

    const punches = (todayPunches ?? []) as TimePunch[]

    // Build latest punch per employee
    const latestByEmp = new Map<string, string>()
    for (const p of punches) latestByEmp.set(p.employee_id, p.type)

    const clockedInIds = new Set([...latestByEmp.entries()].filter(([, t]) => t === 'in').map(([id]) => id))

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

    // Parallel KPI queries
    const [hcRes, jobRes, leaveRes, incRes, payRes, empsRes] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).eq('is_active', true),
      supabase.from('jobs').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).in('status', ['open', 'scheduled', 'in_progress']),
      supabase.from('leave_requests').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).eq('status', 'pending'),
      supabase.from('incident_reports').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).eq('status', 'open'),
      supabase.from('payment_approvals').select('id', { count: 'exact', head: true })
        .eq('company_id', member.companyId).eq('status', 'pending'),
      supabase.from('employees').select('id, name, surname, position')
        .eq('company_id', member.companyId).eq('is_active', true).order('name'),
    ])

    setKpi({
      headcount: hcRes.count ?? 0,
      clockedIn: clockedInIds.size,
      activeJobs: jobRes.count ?? 0,
      pendingLeave: leaveRes.count ?? 0,
      openIncidents: incRes.count ?? 0,
      pendingPay: payRes.count ?? 0,
    })

    const employees = (empsRes.data ?? []) as EmpRow[]
    setAllEmployees(employees)
    empsRef.current = employees
    setNotClockedInIds(new Set(employees.filter(e => !clockedInIds.has(e.id)).map(e => e.id)))

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
    setMarkAbsentLoading(empId)
    const supabase = createClient()
    const today = new Date().toISOString().split('T')[0]
    const { error: err } = await supabase.rpc('employee_report_absence', {
      p_company_id: companyId,
      p_employee_id: empId,
      p_date: today,
      p_reason: 'absent',
      p_note: null,
    })
    if (err) console.error('mark absent:', err.message)
    setMarkAbsentLoading(null)
    await load()
  }

  const greeting = timeGreeting()
  const notSignedInList = allEmployees.filter(e => notClockedInIds.has(e.id))

  if (loading) return (
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

  const pct = kpi.headcount > 0 ? Math.round((kpi.clockedIn / kpi.headcount) * 100) : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 max-w-4xl mx-auto space-y-4">

        {/* ── Greeting header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-text-primary">
              {greeting}
            </h1>
            <p className="text-[16px] font-semibold text-text-primary -mt-0.5">
              {employee?.name} {employee?.surname}
            </p>
            <p className="text-[13px] text-text-secondary mt-0.5">{companyName}</p>
          </div>
          <p className="text-[12px] text-text-secondary shrink-0 pt-1">{formatDate(now)}</p>
        </div>

        {/* ── Clock card ── */}
        <div className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: isClockedIn ? 'linear-gradient(135deg, #052e16, #14532d)' : 'var(--color-surface-card)' ,
                   border: isClockedIn ? '1px solid #166534' : '1px solid var(--color-divider)' }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: isClockedIn ? 'rgba(34,197,94,0.15)' : 'var(--color-surface-elevated)' }}>
            <span className="material-icons text-[22px]"
              style={{ color: isClockedIn ? '#22c55e' : 'var(--color-text-secondary)' }}>
              {isClockedIn ? 'timer' : 'timer_off'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold"
              style={{ color: isClockedIn ? '#86efac' : 'var(--color-text-primary)' }}>
              {isClockedIn ? 'You are Clocked In' : 'You are Clocked Out'}
            </p>
            <p className="text-[12px]" style={{ color: isClockedIn ? '#4ade80' : 'var(--color-text-secondary)' }}>
              Today: {formatElapsed(elapsedMs)}
            </p>
            <Link href="/dashboard/team-punch"
              className="text-[11px] hover:opacity-80 transition-opacity"
              style={{ color: isClockedIn ? '#4ade80' : 'var(--color-primary)' }}>
              Clock in/out for my team →
            </Link>
          </div>
          <button onClick={handlePunch} disabled={punchLoading}
            className="h-10 px-5 rounded-xl text-[13px] font-bold text-white shrink-0 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: isClockedIn ? '#ef4444' : '#22c55e' }}>
            {punchLoading ? '…' : isClockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </div>

        {/* ── 6 KPI tiles ── */}
        <div className="grid grid-cols-3 gap-3">
          <KpiTile icon="people" label="Employees" value={kpi.headcount} href="/dashboard/employees" iconBg="#1e3a5f" iconColor="#60a5fa" />
          <KpiTile icon="timer" label="Clocked In" value={kpi.clockedIn} href="/dashboard/attendance" iconBg="#052e16" iconColor="#22c55e" />
          <KpiTile icon="work" label="Active Jobs" value={kpi.activeJobs} href="/dashboard/jobs" iconBg="#3b1f05" iconColor="#f97316" />
          <KpiTile icon="event_available" label="Pending Leave" value={kpi.pendingLeave} href="/dashboard/leave" iconBg="#2e1a05" iconColor="#fbbf24" />
          <KpiTile icon="warning" label="Open Incidents" value={kpi.openIncidents} href="/dashboard/incidents" iconBg="#3b0a0a" iconColor="#f87171" />
          <KpiTile icon="payments" label="Pending Pay" value={kpi.pendingPay} href="/dashboard/payroll" iconBg="#1a1f05" iconColor="#a3e635" />
        </div>

        {/* ── Today's Attendance ── */}
        <div className="rounded-2xl overflow-hidden border border-divider" style={{ backgroundColor: 'var(--color-surface-card)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
            <div>
              <p className="text-[13px] font-semibold text-text-primary">TODAY&apos;S ATTENDANCE</p>
              <p className="text-[11px] text-text-secondary mt-0.5">employees currently clocked in</p>
            </div>
            <span className="text-[13px] font-bold text-text-secondary">
              {kpi.clockedIn} / {kpi.headcount}
            </span>
          </div>

          {/* Progress bar */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-text-secondary">
                {kpi.clockedIn} of {kpi.headcount} clocked in
              </span>
              <span className="text-[11px] font-semibold text-text-primary">{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${kpi.headcount > 0 ? (kpi.clockedIn / kpi.headcount) * 100 : 0}%`,
                  backgroundColor: kpi.clockedIn === kpi.headcount ? '#22c55e' : '#3b82f6',
                }}
              />
            </div>
          </div>

          {notSignedInList.length === 0 ? (
            <div className="py-8 text-center">
              <span className="material-icons text-[32px] text-text-disabled">check_circle</span>
              <p className="text-[13px] text-text-secondary mt-1">Everyone is clocked in</p>
            </div>
          ) : (
            <div>
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-text-secondary tracking-wide">
                NOT SIGNED IN TODAY
              </p>
              {notSignedInList.map(emp => (
                <div key={emp.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-divider last:border-0">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-[13px] font-bold"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                    {emp.name.charAt(0)}{emp.surname.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-primary truncate">
                      {emp.name} {emp.surname}
                    </p>
                    {emp.position && (
                      <p className="text-[11px] text-text-secondary truncate">{emp.position}</p>
                    )}
                  </div>
                  <button
                    onClick={() => markAbsent(emp.id)}
                    disabled={markAbsentLoading === emp.id}
                    className="h-[28px] px-3 text-[11px] font-medium rounded-lg border transition-opacity disabled:opacity-50"
                    style={{ borderColor: '#d97706', color: '#d97706', backgroundColor: 'rgba(217,119,6,0.08)' }}>
                    {markAbsentLoading === emp.id ? '…' : 'Mark Absent'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Quick Actions ── */}
        <div>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wide mb-2">QUICK ACTIONS</p>
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => router.push('/dashboard/employees/new')}
              className="h-10 px-5 rounded-xl text-[13px] font-semibold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              + Add Employee
            </button>
            <button onClick={() => router.push('/dashboard/jobs/new')}
              className="h-10 px-5 rounded-xl text-[13px] font-semibold text-white"
              style={{ backgroundColor: '#374151' }}>
              + New Job
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

function KpiTile({ icon, label, value, href, iconBg, iconColor }: {
  icon: string; label: string; value: number; href: string; iconBg: string; iconColor: string
}) {
  return (
    <Link href={href}
      className="rounded-2xl p-4 flex flex-col gap-3 border border-divider hover:opacity-80 transition-opacity"
      style={{ backgroundColor: 'var(--color-surface-card)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: iconBg }}>
        <span className="material-icons text-[20px]" style={{ color: iconColor }}>{icon}</span>
      </div>
      <div>
        <p className="text-[24px] font-bold text-text-primary leading-none">{value}</p>
        <p className="text-[11px] text-text-secondary mt-1">{label}</p>
      </div>
    </Link>
  )
}
