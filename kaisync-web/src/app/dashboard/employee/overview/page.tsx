'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

// ── Interfaces ─────────────────────────────────────────────────────────────
interface LastPunch {
  id: string
  type: 'in' | 'out'
  date_time: string
  job_id: string | null
  notes: string | null
}

interface Job {
  id: string
  title: string
  status: string | null
}

interface LeaveRequest {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  status: string
}

interface Incident {
  id: string
  title: string | null
  description: string | null
  severity: string | null
  status: string | null
  occurred_at: string | null
  created_at: string
}

interface PATask {
  id: string
  title: string
  priority: string
  status: string
  due_at: string | null
}

interface ColleagueOnLeave {
  employee_id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string }
}


// ── Helpers ────────────────────────────────────────────────────────────────
function fmtElapsed(ms: number): string {
  const hrs  = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtLeaveType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const PRIORITY_CLASSES: Record<string, string> = {
  low:    'bg-surface-elevated text-text-secondary border border-divider',
  medium: 'bg-primary/10 text-primary',
  high:   'bg-warning/10 text-warning',
  urgent: 'bg-error/10 text-error',
}

const STATUS_STYLES: Record<string, string> = {
  open:         'bg-primary/10 text-primary',
  in_progress:  'bg-warning/10 text-warning',
  completed:    'bg-success/10 text-success',
  cancelled:    'bg-surface-elevated text-text-secondary',
}

const ABSENCE_REASONS = ['sick', 'personal', 'family_emergency', 'other']

// ── Component ──────────────────────────────────────────────────────────────
export default function EmployeeOverviewPage() {
  const router = useRouter()

  const [loading, setLoading]           = useState(true)
  const [initError, setInitError]       = useState(false)
  const [registrationStatus, setRegStatus] = useState<string | null>(null)
  const [hasMissedSignOut, setHasMissedSignOut] = useState(false)

  // Clock state
  const [lastPunch,      setLastPunch]      = useState<LastPunch | null>(null)
  const [isClockedIn,    setIsClockedIn]    = useState(false)
  const [elapsedMs,      setElapsedMs]      = useState(0)
  const [showClockModal, setShowClockModal] = useState(false)
  const [clockNote,      setClockNote]      = useState('')
  const [clockJobId,     setClockJobId]     = useState<string | null>(null)
  const [geoLat,         setGeoLat]         = useState<number | null>(null)
  const [geoLng,         setGeoLng]         = useState<number | null>(null)
  const [clockLoading,   setClockLoading]   = useState(false)
  const [clockError,     setClockError]     = useState<string | null>(null)

  // Absence modal
  const [showAbsenceModal,  setShowAbsenceModal]  = useState(false)
  const [absenceDate,       setAbsenceDate]       = useState('')
  const [absenceReason,     setAbsenceReason]     = useState('sick')
  const [absenceNote,       setAbsenceNote]       = useState('')
  const [absenceSubmitting, setAbsenceSubmitting] = useState(false)
  const [absenceError,      setAbsenceError]      = useState<string | null>(null)
  const [absenceSuccess,    setAbsenceSuccess]    = useState(false)

  // Data
  const [jobs,          setJobs]          = useState<Job[]>([])
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [incidents,     setIncidents]     = useState<Incident[]>([])
  const [paTasks,       setPATasks]       = useState<PATask[]>([])
  const [colleagues,    setColleagues]    = useState<ColleagueOnLeave[]>([])
  const [isOnLeave,     setIsOnLeave]     = useState(false)
  const [punchesToday,  setPunchesToday]  = useState(0)

  const baseElapsedRef  = useRef<number>(0)
  const clockInTimeRef  = useRef<string | null>(null)
  const empIdRef        = useRef<string | null>(null)
  const companyIdRef    = useRef<string | null>(null)
  const tokRef          = useRef<string | null>(null)
  const tickerRef       = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (isClockedIn && clockInTimeRef.current) {
      tickerRef.current = setInterval(() => {
        setElapsedMs(baseElapsedRef.current + (Date.now() - new Date(clockInTimeRef.current!).getTime()))
      }, 1000)
    } else {
      if (tickerRef.current) clearInterval(tickerRef.current)
    }
    return () => { if (tickerRef.current) clearInterval(tickerRef.current) }
  }, [isClockedIn])

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    setLoading(true)
    setInitError(false)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    empIdRef.current     = member.employeeId
    companyIdRef.current = member.companyId

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)
      const todayStr = new Date().toISOString().split('T')[0]

      const [
        lastPunchRes, jobsRes, leaveRes,
        onLeaveRes, incRes, punchesRes,
        paRes,
      ] = await Promise.all([
        rpc('employee_get_last_punch', { p_employee_id: member.employeeId, p_session_token: tok }),
        rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
        rpc('employee_get_leave_requests', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
        rpc('employee_is_on_leave_today', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
        rpc('employee_get_own_incidents', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
        rpc('employee_get_my_punches', {
          p_company_id:    member.companyId,
          p_employee_id:   member.employeeId,
          p_from:          todayStr,
          p_to:            todayStr,
          p_session_token: tok,
        }),
        rpc('employee_get_pa_tasks', { p_company_id: member.companyId, p_employee_id: member.employeeId, p_session_token: tok }),
      ])

      // Last punch
      const lp = lastPunchRes.data as LastPunch | null
      setLastPunch(lp)

      if (lp?.type === 'in') {
        setIsClockedIn(true)
        clockInTimeRef.current = lp.date_time
        baseElapsedRef.current = 0
        setElapsedMs(Date.now() - new Date(lp.date_time).getTime())
        const punchDate = lp.date_time.split('T')[0]
        if (punchDate < todayStr) {
          setHasMissedSignOut(true)
        }
      } else {
        setIsClockedIn(false)
        clockInTimeRef.current = null
        baseElapsedRef.current = 0
        setElapsedMs(0)
      }

      setJobs((jobsRes.data as Job[]) ?? [])
      setLeaveRequests((leaveRes.data as LeaveRequest[]) ?? [])
      setIsOnLeave(onLeaveRes.data === true || (Array.isArray(onLeaveRes.data) && onLeaveRes.data?.[0]?.is_on_leave === true))
      setIncidents((incRes.data as Incident[]) ?? [])
      setPunchesToday(((punchesRes.data as unknown[] | null) ?? []).length)
      setRegStatus(null)

      // PA tasks: due today, not done/snoozed
      const allTasks = (paRes.data as PATask[]) ?? []
      const todayTasks = allTasks.filter(t =>
        t.status !== 'done' && t.status !== 'snoozed' &&
        (!t.due_at || t.due_at.split('T')[0] === todayStr)
      )
      setPATasks(todayTasks)

      // Colleagues on leave — JWT employees only (code-auth users can't read leave_requests via RLS)
      if (member.sessionToken === null) {
        try {
          const { data: colleaguesData } = await supabase
            .from('leave_requests')
            .select('employee_id, leave_type, end_date, employees!inner(name, surname)')
            .eq('company_id', member.companyId)
            .eq('status', 'approved')
            .lte('start_date', todayStr)
            .gte('end_date', todayStr)
            .neq('employee_id', member.employeeId)
            .limit(10)
          setColleagues((colleaguesData as unknown as ColleagueOnLeave[]) ?? [])
        } catch { /* non-critical */ }
      }

    } catch (e) {
      console.error('[Dashboard] init failed:', e)
      setInitError(true)
    } finally {
      setLoading(false)
    }
  }

  // ── Clock modal ────────────────────────────────────────────────────────
  function openClockModal() {
    setClockError(null)
    setClockNote('')
    setClockJobId(null)
    setGeoLat(null)
    setGeoLng(null)
    setShowClockModal(true)

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { setGeoLat(pos.coords.latitude); setGeoLng(pos.coords.longitude) },
        () => {}
      )
    }
  }

  async function submitClock() {
    const empId  = empIdRef.current
    const compId = companyIdRef.current
    if (!empId || !compId) return
    setClockLoading(true)
    setClockError(null)

    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)

    const { error } = await rpc('employee_insert_punch', {
      p_company_id:            compId,
      p_employee_id:           empId,
      p_type:                  isClockedIn ? 'out' : 'in',
      p_date_time:             new Date().toISOString(),
      p_latitude:              geoLat,
      p_longitude:             geoLng,
      p_address:               null,
      p_job_id:                clockJobId || null,
      p_notes:                 clockNote || null,
      p_punched_by_manager_id: null,
      p_idempotency_key:       crypto.randomUUID(),
      p_session_token:         tokRef.current,
    })

    if (error) { setClockError(error.message); setClockLoading(false); return }

    setShowClockModal(false)
    setHasMissedSignOut(false)
    setClockLoading(false)
    await init()
  }

  // ── Absence modal ──────────────────────────────────────────────────────
  function openAbsenceModal() {
    setAbsenceDate(new Date().toISOString().split('T')[0])
    setAbsenceReason('sick')
    setAbsenceNote('')
    setAbsenceError(null)
    setAbsenceSuccess(false)
    setShowAbsenceModal(true)
  }

  async function submitAbsence() {
    const empId  = empIdRef.current
    const compId = companyIdRef.current
    if (!empId || !compId || !absenceDate) return
    setAbsenceSubmitting(true)
    setAbsenceError(null)

    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)

    try {
      const { error: rpcErr } = await rpc('employee_report_absence', {
        p_company_id:    compId,
        p_employee_id:   empId,
        p_date:          absenceDate,
        p_reason:        absenceReason,
        p_note:          absenceNote.trim() || null,
        p_session_token: tokRef.current,
      })
      if (rpcErr) throw rpcErr
      setAbsenceSuccess(true)
      setTimeout(() => setShowAbsenceModal(false), 1500)
    } catch (e: unknown) {
      setAbsenceError(e instanceof Error ? e.message : 'Failed to report absence.')
    }
    setAbsenceSubmitting(false)
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const pendingLeave  = leaveRequests.filter(r => r.status === 'pending').length
  const openIncidents = incidents.filter(i => i.status === 'open' || i.status === 'under_review').length
  const activeJobs    = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled')

  // Recent Activity feed (leave + incidents, max 5, sorted by date)
  type ActivityItem =
    | { kind: 'leave'; id: string; date: string; leave: LeaveRequest }
    | { kind: 'incident'; id: string; date: string; inc: Incident }

  const activityItems: ActivityItem[] = [
    ...leaveRequests.map(r => ({
      kind: 'leave' as const,
      id:   r.id,
      date: r.start_date,
      leave: r,
    })),
    ...incidents.map(i => ({
      kind: 'incident' as const,
      id:   i.id,
      date: i.occurred_at ?? i.created_at,
      inc:  i,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  if (initError) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <span className="material-icons text-[48px] text-text-disabled">error_outline</span>
      <p className="text-[14px] text-text-secondary">Failed to load dashboard. Please refresh.</p>
      <button
        onClick={() => init()}
        className="text-[13px] font-semibold text-primary hover:underline"
      >
        Try again
      </button>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Dashboard</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Registration pending banner */}
        {registrationStatus === 'pending' && (
          <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
            <span className="material-icons text-warning text-[20px]">pending</span>
            <p className="text-[13px] text-warning font-medium">
              Your account is pending HR approval. Some features may be limited.
            </p>
          </div>
        )}

        {/* On leave banner */}
        {isOnLeave && (
          <div className="flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-3">
            <span className="material-icons text-primary text-[20px]">beach_access</span>
            <p className="text-[13px] text-primary font-medium">You are currently on approved leave.</p>
          </div>
        )}

        {/* Missed sign-out banner */}
        {hasMissedSignOut && lastPunch && (
          <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
            <span className="material-icons text-warning text-[20px]">alarm</span>
            <p className="text-[13px] text-warning font-medium">
              You forgot to clock out yesterday. Your last punch was {fmtDate(lastPunch.date_time)}. Please clock out now.
            </p>
          </div>
        )}

        {/* Clock card */}
        <div className="bg-surface border border-divider rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">
                {isClockedIn ? 'Clocked In' : 'Not Clocked In'}
              </p>
              {isClockedIn && (
                <p className="text-[32px] font-bold text-text-primary font-mono tracking-tight mt-0.5">
                  {fmtElapsed(elapsedMs)}
                </p>
              )}
              {!isClockedIn && lastPunch?.date_time && (
                <p className="text-[12px] text-text-secondary mt-1">
                  Last: {new Date(lastPunch.date_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <button
              onClick={openClockModal}
              className={`flex flex-col items-center justify-center w-20 h-20 rounded-full font-bold text-[14px] shadow-lg transition-all active:scale-95 ${
                isClockedIn
                  ? 'bg-error text-white hover:bg-error/90'
                  : 'bg-primary text-white hover:bg-primary-dark'
              }`}
            >
              <span className="material-icons text-[28px]">{isClockedIn ? 'stop' : 'play_arrow'}</span>
              <span className="text-[10px] font-bold mt-0.5">{isClockedIn ? 'OUT' : 'IN'}</span>
            </button>
          </div>
          <div className="h-px bg-divider mb-3" />
          <p className="text-[11px] text-text-disabled">
            Today: <span className="text-text-secondary font-medium">{punchesToday} punch{punchesToday !== 1 ? 'es' : ''}</span>
          </p>
          {!isClockedIn && (
            <button onClick={openAbsenceModal}
              className="flex items-center gap-1.5 mt-3 text-[12px] font-semibold text-text-secondary border border-divider px-3 py-1.5 rounded-lg hover:border-warning hover:text-warning transition-colors">
              <span className="material-icons text-[16px]">sick</span>Report Absence
            </button>
          )}
        </div>

        {/* Today's PA Tasks strip */}
        {paTasks.length > 0 && (
          <div>
            <p className="section-label mb-2">Today&apos;s Tasks</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {paTasks.map(t => (
                <button key={t.id} onClick={() => router.push('/dashboard/employee/pa')}
                  className="flex items-center gap-2 bg-surface border border-divider rounded-xl px-3 py-2 shrink-0 hover:border-primary transition-colors max-w-[200px]">
                  <span className="text-[13px] font-medium text-text-primary truncate">{t.title}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full capitalize shrink-0 ${PRIORITY_CLASSES[t.priority] ?? 'bg-surface-elevated text-text-secondary'}`}>
                    {t.priority}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/dashboard/employee/jobs"
            className="bg-surface border border-divider rounded-xl p-4 hover:border-primary transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-primary text-[20px]">work</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Active Jobs</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{activeJobs.length}</p>
          </Link>
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-warning text-[20px]">beach_access</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Pending Leave</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{pendingLeave}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-text-disabled text-[20px]">notifications</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">PA Tasks Today</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{paTasks.length}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-error text-[20px]">warning</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Open Incidents</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{openIncidents}</p>
          </div>
        </div>

        {/* Active Jobs strip */}
        {activeJobs.length > 0 && (
          <div>
            <p className="section-label mb-2">Active Jobs</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {activeJobs.slice(0, 5).map(j => (
                <Link key={j.id} href={`/dashboard/employee/jobs/${j.id}`}
                  className="bg-surface border border-divider rounded-xl px-3 py-2.5 shrink-0 hover:border-primary transition-colors min-w-[140px]">
                  <p className="text-[13px] font-semibold text-text-primary truncate max-w-[160px]">{j.title}</p>
                  {j.status && (
                    <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded-full capitalize ${STATUS_STYLES[j.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                      {j.status.replace(/_/g,' ')}
                    </span>
                  )}
                </Link>
              ))}
              {activeJobs.length > 5 && (
                <Link href="/dashboard/employee/jobs"
                  className="bg-surface border border-dashed border-divider rounded-xl px-3 py-2.5 shrink-0 flex items-center text-[12px] font-semibold text-primary hover:border-primary transition-colors">
                  View all
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Colleagues on leave */}
        {colleagues.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Colleagues on Leave</p>
            </div>
            <div className="divide-y divide-divider">
              {colleagues.map((c, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">{c.employees ? `${c.employees.name} ${c.employees.surname}` : '—'}</p>
                    <p className="text-[11px] text-text-secondary">{fmtLeaveType(c.leave_type)}</p>
                  </div>
                  <p className="text-[11px] text-text-disabled">Back: {fmtDate(c.end_date + 'T12:00:00')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {activityItems.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Recent Activity</p>
            </div>
            <div className="divide-y divide-divider">
              {activityItems.map(item => {
                if (item.kind === 'leave') {
                  const r = item.leave
                  return (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-text-primary">Leave: {fmtLeaveType(r.leave_type)}</p>
                        <p className="text-[11px] text-text-disabled">
                          {fmtDate(r.start_date + 'T12:00:00')} – {fmtDate(r.end_date + 'T12:00:00')}
                        </p>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${
                        r.status === 'approved' ? 'bg-success/10 text-success' :
                        r.status === 'pending'  ? 'bg-warning/10 text-warning' :
                        r.status === 'rejected' ? 'bg-error/10 text-error' :
                        'bg-surface-elevated text-text-secondary'
                      }`}>{r.status}</span>
                    </div>
                  )
                }
                const i = item.inc
                return (
                  <Link key={item.id} href={`/dashboard/employee/incidents/${i.id}`}
                    className="px-4 py-3 flex items-center justify-between hover:bg-surface-elevated transition-colors">
                    <div>
                      <p className="text-[13px] font-semibold text-text-primary">
                        Incident: {i.title ?? i.description ?? 'Untitled'}
                      </p>
                      <p className="text-[11px] text-text-disabled">{fmtDate(i.occurred_at ?? i.created_at)}</p>
                    </div>
                    {i.severity && (
                      <span className="text-[11px] font-semibold text-error capitalize">{i.severity}</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>

      {/* Clock modal */}
      {showClockModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">
                {isClockedIn ? 'Clock Out' : 'Clock In'}
              </h2>
              <button onClick={() => setShowClockModal(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>

            {clockError && (
              <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
                <p className="text-[13px] text-error font-semibold">{clockError}</p>
              </div>
            )}

            {!isClockedIn && activeJobs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Job (optional)</label>
                <select className="input" value={clockJobId ?? ''} onChange={e => setClockJobId(e.target.value || null)}>
                  <option value="">No job selected</option>
                  {activeJobs.map(j => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Notes (optional)</label>
              <input className="input" type="text" placeholder="Any notes…"
                value={clockNote} onChange={e => setClockNote(e.target.value)} />
            </div>

            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <span className={`material-icons text-[16px] ${geoLat != null ? 'text-success' : 'text-text-disabled'}`}>
                {geoLat != null ? 'location_on' : 'location_off'}
              </span>
              {geoLat != null ? `GPS: ${geoLat.toFixed(4)}, ${geoLng!.toFixed(4)}` : 'Location not available'}
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowClockModal(false)} disabled={clockLoading}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitClock} disabled={clockLoading}
                className={`flex-1 h-11 rounded-xl text-white text-[14px] font-bold transition-colors disabled:opacity-60 ${
                  isClockedIn ? 'bg-error hover:bg-error/90' : 'bg-primary hover:bg-primary-dark'
                }`}>
                {clockLoading ? '…' : isClockedIn ? 'Clock Out' : 'Clock In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Absence modal */}
      {showAbsenceModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">Report Absence</h2>
              <button onClick={() => setShowAbsenceModal(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>

            {absenceError && (
              <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
                <p className="text-[13px] text-error font-semibold">{absenceError}</p>
              </div>
            )}

            {absenceSuccess && (
              <div className="rounded-xl px-4 py-3 bg-success/10 border border-success/30">
                <p className="text-[13px] text-success font-semibold">Absence reported.</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Date</label>
              <input className="input" type="date" value={absenceDate} onChange={e => setAbsenceDate(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Reason</label>
              <select className="input" value={absenceReason} onChange={e => setAbsenceReason(e.target.value)}>
                {ABSENCE_REASONS.map(r => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Notes (optional)</label>
              <input className="input" type="text" placeholder="Any additional notes…"
                value={absenceNote} onChange={e => setAbsenceNote(e.target.value)} />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowAbsenceModal(false)} disabled={absenceSubmitting}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitAbsence} disabled={absenceSubmitting || !absenceDate}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-bold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {absenceSubmitting ? '…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
