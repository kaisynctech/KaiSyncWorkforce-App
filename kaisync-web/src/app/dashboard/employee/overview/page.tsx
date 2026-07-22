'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { type QueuedPunch, getQueue, enqueue, dequeue, shouldQueuePunchFailure } from '@/lib/punch-queue'
import {
  loadCompanyWorkspace,
  loadEmployeeWorkspace,
  moduleFlagsForCompany,
  isPendingMembership,
  type CompanyWorkspace,
} from '@/lib/employee-workspace'
import { countUnreadAppNotifications, mapAppNotification, parseNotificationsRpcJson } from '@/lib/notification-feed'
import { ALL_MODULES_ENABLED, type EmployeeModuleFlags } from '@/lib/company-modules'
import {
  getBranchGeofenceStatus,
  validateBranchClockIn,
  branchSignInRadiusMeters,
  enforceBranchSignInRadius,
  haversineMeters,
  type BranchRow,
  type BranchGeofenceStatus,
} from '@/lib/branch-geofence'

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
  site_id: string | null
  site_radius_mode: boolean | null
  site_radius_meters: number | null
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

interface RecentPunchRow {
  id: string
  type: string
  date_time: string
}

interface DailyAbsenceRow {
  reason?: string
  note?: string | null
  date?: string
}

interface WorkTeam {
  id: string
  name: string
  description: string | null
  member_ids: string[] | null
  is_active?: boolean | null
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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function fmtLeaveType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtAbsenceReason(raw: string): string {
  const map: Record<string, string> = {
    sick: 'Sick',
    personal: 'Personal',
    emergency: 'Emergency',
    other: 'Other',
  }
  return map[raw] ?? fmtLeaveType(raw)
}

function isoDateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
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

const ABSENCE_REASONS = ['sick', 'personal', 'emergency', 'other']

// ── Component ──────────────────────────────────────────────────────────────
export default function EmployeeOverviewPage() {
  const router = useRouter()

  const [loading, setLoading]           = useState(true)
  const [initError, setInitError]       = useState(false)
  const [hasMissedSignOut, setHasMissedSignOut] = useState(false)

  const [companyWs, setCompanyWs]   = useState<CompanyWorkspace | null>(null)
  const [modules, setModules]       = useState<EmployeeModuleFlags>(ALL_MODULES_ENABLED)
  const [isPending, setIsPending]   = useState(false)

  // Clock state
  const [lastPunch,      setLastPunch]      = useState<LastPunch | null>(null)
  const [isClockedIn,    setIsClockedIn]    = useState(false)
  const [elapsedMs,      setElapsedMs]      = useState(0)
  const [showClockModal, setShowClockModal] = useState(false)
  const [clockNote,      setClockNote]      = useState('')
  const [clockJobId,     setClockJobId]     = useState<string | null>(null)
  const [geoLat,         setGeoLat]         = useState<number | null>(null)
  const [geoLng,         setGeoLng]         = useState<number | null>(null)
  const [geoAddress,     setGeoAddress]     = useState<string | null>(null)
  const [geofenceData,   setGeofenceData]   = useState<{
    latitude: number
    longitude: number
    radius_meters: number
  } | null>(null)
  const [clockLoading,   setClockLoading]   = useState(false)
  const [clockError,     setClockError]     = useState<string | null>(null)

  // Branch geofence
  const [branchStatus, setBranchStatus] = useState<BranchGeofenceStatus | null>(null)
  const [liveLat, setLiveLat] = useState<number | null>(null)
  const [liveLng, setLiveLng] = useState<number | null>(null)

  // Absence
  const [isOnLeave, setIsOnLeave] = useState(false)
  const [isAbsentToday, setIsAbsentToday] = useState(false)
  const [absenceReasonLabel, setAbsenceReasonLabel] = useState('')
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
  const [punchesToday,  setPunchesToday]  = useState(0)
  const [recentPunches, setRecentPunches] = useState<RecentPunchRow[]>([])
  const [pendingPunches, setPendingPunches] = useState<QueuedPunch[]>([])
  const [notificationCount, setNotificationCount] = useState(0)
  const [myTeams, setMyTeams] = useState<WorkTeam[]>([])

  const baseElapsedRef  = useRef<number>(0)
  const clockInTimeRef  = useRef<string | null>(null)
  const empIdRef        = useRef<string | null>(null)
  const companyIdRef    = useRef<string | null>(null)
  const tokRef          = useRef<string | null>(null)
  const tickerRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const employeeBranchRef = useRef<string | null>(null)
  const dispatchSettingsRef = useRef<CompanyWorkspace['dispatch_settings']>({})
  const branchesRef = useRef<BranchRow[]>([])
  const realtimeCleanupRef = useRef<(() => void) | null>(null)
  const isPendingRef = useRef(false)

  useEffect(() => {
    void init()
    return () => {
      realtimeCleanupRef.current?.()
      realtimeCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    setPendingPunches(getQueue())
    const handleOnline = () => { syncQueue() }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

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

  // ── Apply last punch to clock state ────────────────────────────────────
  function applyLastPunch(lp: LastPunch | null, todayStr: string) {
    setLastPunch(lp)
    if (lp?.type === 'in') {
      setIsClockedIn(true)
      clockInTimeRef.current = lp.date_time
      baseElapsedRef.current = 0
      setElapsedMs(Date.now() - new Date(lp.date_time).getTime())
      const punchDate = lp.date_time.split('T')[0]
      setHasMissedSignOut(punchDate < todayStr)
    } else {
      setIsClockedIn(false)
      clockInTimeRef.current = null
      baseElapsedRef.current = 0
      setElapsedMs(0)
      setHasMissedSignOut(false)
    }
  }

  async function reloadLastPunch() {
    const empId = empIdRef.current
    if (!empId) return
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_last_punch', {
      p_employee_id: empId,
      p_session_token: tokRef.current,
    })
    applyLastPunch((data as LastPunch | null) ?? null, new Date().toISOString().split('T')[0])
  }

  async function refreshMembership() {
    const empId = empIdRef.current
    if (!empId) return
    const supabase = createClient()
    const emp = await loadEmployeeWorkspace(supabase, empId)
    if (!emp) return
    employeeBranchRef.current = emp.branch
    const pending = isPendingMembership(emp)
    const wasPending = isPendingRef.current
    isPendingRef.current = pending
    setIsPending(pending)
    if (wasPending && !pending) {
      void init({ soft: true })
    }
  }

  function subscribeRealtime(companyId: string, employeeId: string) {
    realtimeCleanupRef.current?.()
    const supabase = createClient()
    const punchChannel = supabase
      .channel(`emp-overview-punches-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_punches',
          filter: `company_id=eq.${companyId}`,
        },
        () => { void reloadLastPunch() },
      )
      .subscribe()

    const empChannel = supabase
      .channel(`emp-overview-member-${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employees',
          filter: `id=eq.${employeeId}`,
        },
        () => { void refreshMembership() },
      )
      .subscribe()

    realtimeCleanupRef.current = () => {
      supabase.removeChannel(punchChannel)
      supabase.removeChannel(empChannel)
    }
  }

  function refreshBranchStatus(
    lat: number | null,
    lng: number | null,
    branchName?: string | null,
  ) {
    const status = getBranchGeofenceStatus({
      enforce: enforceBranchSignInRadius(dispatchSettingsRef.current),
      employeeBranch: branchName ?? employeeBranchRef.current,
      branches: branchesRef.current,
      radiusMeters: branchSignInRadiusMeters(dispatchSettingsRef.current),
      latitude: lat,
      longitude: lng,
    })
    setBranchStatus(status)
  }

  async function loadColleaguesOnLeave(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    companyId: string,
    employeeId: string,
    todayStr: string,
    tok: string | null,
  ) {
    // Prefer RPC (code-auth + JWT); fallback to JWT direct query
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('employee_get_company_approved_leave', {
        p_company_id: companyId,
        p_employee_id: employeeId,
        p_session_token: tok,
      })
      if (!error && Array.isArray(data)) {
        const rows = (data as Array<{
          employee_id: string
          leave_type: string
          start_date: string
          end_date: string
          status?: string
        }>).filter(r =>
          r.employee_id !== employeeId
          && r.start_date <= todayStr
          && r.end_date >= todayStr
          && (r.status == null || r.status === 'approved')
        )
        if (rows.length === 0) {
          setColleagues([])
          return
        }
        const ids = [...new Set(rows.map(r => r.employee_id))]
        const { data: emps } = await supabase
          .from('employees')
          .select('id, name, surname')
          .in('id', ids)
        const map = new Map<string, { name: string; surname: string }>(
          ((emps as Array<{ id: string; name: string; surname: string }> | null) ?? [])
            .map(e => [e.id, { name: e.name, surname: e.surname }])
        )
        setColleagues(rows.slice(0, 10).map(r => ({
          employee_id: r.employee_id,
          leave_type: r.leave_type,
          end_date: r.end_date,
          employees: map.get(r.employee_id) ?? { name: 'Colleague', surname: '' },
        })))
        return
      }
    } catch { /* fall through */ }

    try {
      const { data: colleaguesData } = await supabase
        .from('leave_requests')
        .select('employee_id, leave_type, end_date, employees!inner(name, surname)')
        .eq('company_id', companyId)
        .eq('status', 'approved')
        .lte('start_date', todayStr)
        .gte('end_date', todayStr)
        .neq('employee_id', employeeId)
        .limit(10)
      setColleagues((colleaguesData as unknown as ColleagueOnLeave[]) ?? [])
    } catch { /* non-critical */ }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init(options?: { soft?: boolean }) {
    if (!options?.soft) setLoading(true)
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
      const weekFrom = isoDateOffset(-7)

      const [emp, company] = await Promise.all([
        loadEmployeeWorkspace(supabase, member.employeeId),
        loadCompanyWorkspace(supabase, member.companyId),
      ])
      setCompanyWs(company)
      const flags = moduleFlagsForCompany(company)
      setModules(flags)
      employeeBranchRef.current = emp?.branch ?? null
      dispatchSettingsRef.current = company?.dispatch_settings ?? {}

      const pending = isPendingMembership(emp)
      isPendingRef.current = pending
      setIsPending(pending)

      // Branches for geofence (even if later gated — cheap)
      const { data: branchRows } = await supabase
        .from('branches')
        .select('id,name,latitude,longitude,is_active')
        .eq('company_id', member.companyId)
      const branchList = (branchRows as BranchRow[] | null) ?? []
      branchesRef.current = branchList

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            setLiveLat(pos.coords.latitude)
            setLiveLng(pos.coords.longitude)
            refreshBranchStatus(pos.coords.latitude, pos.coords.longitude, emp?.branch)
          },
          () => refreshBranchStatus(null, null, emp?.branch),
        )
      } else {
        refreshBranchStatus(null, null, emp?.branch)
      }

      // Always subscribe — membership realtime matters while pending
      subscribeRealtime(member.companyId, member.employeeId)

      if (pending) {
        applyLastPunch(null, todayStr)
        setJobs([])
        setLeaveRequests([])
        setIncidents([])
        setPATasks([])
        setColleagues([])
        setPunchesToday(0)
        setRecentPunches([])
        setIsOnLeave(false)
        setIsAbsentToday(false)
        setAbsenceReasonLabel('')
        setNotificationCount(0)
        setMyTeams([])
        return
      }

      const [
        lastPunchRes, jobsRes, leaveRes,
        onLeaveRes, incRes, punchesTodayRes,
        punchesWeekRes, paRes, absencesRes, notifRes, teamsRes,
      ] = await Promise.all([
        rpc('employee_get_last_punch', { p_employee_id: member.employeeId, p_session_token: tok }),
        flags.jobs
          ? rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok })
          : Promise.resolve({ data: [] }),
        flags.leave
          ? rpc('employee_get_leave_requests', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok })
          : Promise.resolve({ data: [] }),
        flags.leave
          ? rpc('employee_is_on_leave_today', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok })
          : Promise.resolve({ data: false }),
        flags.incidents
          ? rpc('employee_get_incidents', {
              p_employee_id: member.employeeId,
              p_company_id: member.companyId,
              p_job_id: null,
              p_include_closed: true,
              p_session_token: tok,
            })
          : Promise.resolve({ data: [] }),
        flags.attendance
          ? rpc('employee_get_my_punches', {
              p_company_id:    member.companyId,
              p_employee_id:   member.employeeId,
              p_from:          todayStr,
              p_to:            todayStr,
              p_session_token: tok,
            })
          : Promise.resolve({ data: [] }),
        flags.attendance
          ? rpc('employee_get_my_punches', {
              p_company_id:    member.companyId,
              p_employee_id:   member.employeeId,
              p_from:          weekFrom,
              p_to:            todayStr,
              p_session_token: tok,
            })
          : Promise.resolve({ data: [] }),
        flags.myPa
          ? rpc('employee_get_pa_tasks', { p_company_id: member.companyId, p_employee_id: member.employeeId, p_session_token: tok })
          : Promise.resolve({ data: [] }),
        flags.attendance
          ? rpc('employee_get_daily_absences', {
              p_company_id:    member.companyId,
              p_employee_id:   member.employeeId,
              p_from:          todayStr,
              p_to:            todayStr,
              p_session_token: tok,
            })
          : Promise.resolve({ data: [] }),
        rpc('employee_get_my_notifications_for_employee', {
          p_employee_id: member.employeeId,
          p_session_token: tok,
        }),
        rpc('employee_get_work_teams', {
          p_company_id: member.companyId,
          p_employee_id: member.employeeId,
          p_session_token: tok,
        }).catch(() => ({ data: [] })),
      ])

      applyLastPunch((lastPunchRes.data as LastPunch | null) ?? null, todayStr)
      setJobs((jobsRes.data as Job[]) ?? [])
      setLeaveRequests((leaveRes.data as LeaveRequest[]) ?? [])
      setIsOnLeave(
        onLeaveRes.data === true
        || (Array.isArray(onLeaveRes.data) && onLeaveRes.data?.[0]?.is_on_leave === true)
      )
      setIncidents((incRes.data as Incident[]) ?? [])
      setPunchesToday(((punchesTodayRes.data as unknown[] | null) ?? []).length)
      setNotificationCount(
        countUnreadAppNotifications(parseNotificationsRpcJson(notifRes.data).map(mapAppNotification)),
      )

      const weekPunches = ((punchesWeekRes.data as RecentPunchRow[] | null) ?? [])
        .slice()
        .sort((a, b) => b.date_time.localeCompare(a.date_time))
      setRecentPunches(weekPunches)

      const absences = (absencesRes.data as DailyAbsenceRow[] | null) ?? []
      if (absences.length > 0) {
        setIsAbsentToday(true)
        setAbsenceReasonLabel(fmtAbsenceReason(absences[0].reason ?? 'other'))
      } else {
        setIsAbsentToday(false)
        setAbsenceReasonLabel('')
      }

      const allTasks = (paRes.data as PATask[]) ?? []
      const todayTasks = allTasks.filter(t =>
        t.status !== 'done' && t.status !== 'snoozed'
        && (!t.due_at || t.due_at.split('T')[0] === todayStr)
      )
      setPATasks(todayTasks)

      const teams = ((teamsRes.data as WorkTeam[]) ?? []).filter(t => {
        if (t.is_active === false) return false
        const ids = (t.member_ids ?? []).map(String)
        return ids.includes(member.employeeId)
      })
      setMyTeams(teams)

      if (flags.leave) {
        await loadColleaguesOnLeave(supabase, member.companyId, member.employeeId, todayStr, tok)
      } else {
        setColleagues([])
      }
    } catch (e) {
      console.error('[Dashboard] init failed:', e)
      setInitError(true)
    } finally {
      setLoading(false)
      syncQueue()
    }
  }

  const showClockCard = !isPending && modules.attendance
  const showWorkspace = !isPending

  function clockButtonLabel(): string {
    if (isClockedIn) return 'Clock Out'
    if (isOnLeave) return 'On Leave'
    if (isAbsentToday) return 'Absent Today'
    return 'Clock In'
  }

  // ── Clock modal ────────────────────────────────────────────────────────
  function openClockModal() {
    if (isPending) {
      window.alert('Clock in and other company features unlock once HR approves your account.')
      return
    }
    if (!modules.attendance) return

    // Block clock-IN when on leave / absent (MAUI parity)
    if (!isClockedIn && isOnLeave) {
      window.alert('You are on approved leave today and cannot clock in.')
      return
    }
    if (!isClockedIn && isAbsentToday) {
      window.alert('You are marked absent today and cannot clock in.')
      return
    }

    setClockError(null)
    setClockNote('')
    setClockJobId(null)
    setGeoLat(null)
    setGeoLng(null)
    setGeoAddress(null)
    setGeofenceData(null)
    setShowClockModal(true)

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async pos => {
          const lat = pos.coords.latitude
          const lng = pos.coords.longitude
          setGeoLat(lat)
          setGeoLng(lng)
          setLiveLat(lat)
          setLiveLng(lng)
          refreshBranchStatus(lat, lng)
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              { headers: { 'Accept-Language': 'en' } }
            )
            const json = await res.json()
            setGeoAddress((json as { display_name?: string }).display_name ?? null)
          } catch {
            // reverse geocode failed — address stays null, punch still goes through
          }
        },
        () => {
          refreshBranchStatus(null, null)
        }
      )
    }
  }

  async function onJobSelect(jobId: string | null) {
    setClockJobId(jobId)
    setGeofenceData(null)
    if (!jobId) return
    const job = jobs.find(j => j.id === jobId)
    if (!job?.site_radius_mode || !job?.site_id) return
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_job_geofence', {
      p_company_id:    companyIdRef.current,
      p_employee_id:   empIdRef.current,
      p_job_id:        jobId,
      p_session_token: tokRef.current,
    })
    if (data) {
      setGeofenceData(data as { latitude: number; longitude: number; radius_meters: number })
    }
  }

  function applyOptimisticPunch(type: 'in' | 'out', punchDateTime: string) {
    const optimistic: LastPunch = {
      id: `queued-${punchDateTime}`,
      type,
      date_time: punchDateTime,
      job_id: clockJobId || null,
      notes: clockNote || null,
    }
    applyLastPunch(optimistic, new Date().toISOString().split('T')[0])
  }

  async function syncQueue() {
    const queue = getQueue()
    if (queue.length === 0) return
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
    for (const punch of queue) {
      const { error } = await rpc('employee_insert_punch', {
        p_company_id:            punch.company_id,
        p_employee_id:           punch.employee_id,
        p_type:                  punch.type,
        p_date_time:             punch.date_time,
        p_latitude:              punch.latitude,
        p_longitude:             punch.longitude,
        p_address:               punch.address,
        p_job_id:                punch.job_id,
        p_notes:                 punch.notes,
        p_punched_by_manager_id: null,
        p_idempotency_key:       punch.idempotency_key,
        p_session_token:         tokRef.current,
      })
      if (!error) {
        dequeue(punch.idempotency_key)
      }
    }
    setPendingPunches(getQueue())
  }

  async function submitClock() {
    const empId  = empIdRef.current
    const compId = companyIdRef.current
    if (!empId || !compId) return
    setClockLoading(true)
    setClockError(null)

    // Leave / absence hard-block on clock-IN submit (defence in depth)
    if (!isClockedIn && isOnLeave) {
      setClockError('You are on approved leave today and cannot clock in.')
      setClockLoading(false)
      return
    }
    if (!isClockedIn && isAbsentToday) {
      setClockError('You are marked absent today and cannot clock in.')
      setClockLoading(false)
      return
    }

    // Branch geofence hard-block on clock-IN (MAUI)
    if (!isClockedIn) {
      const branchResult = validateBranchClockIn({
        enforce: enforceBranchSignInRadius(dispatchSettingsRef.current),
        employeeBranch: employeeBranchRef.current,
        branches: branchesRef.current,
        radiusMeters: branchSignInRadiusMeters(dispatchSettingsRef.current),
        latitude: geoLat ?? liveLat,
        longitude: geoLng ?? liveLng,
      })
      if (!branchResult.allowed) {
        setClockError(branchResult.message || 'Cannot Clock In')
        setClockLoading(false)
        refreshBranchStatus(geoLat ?? liveLat, geoLng ?? liveLng)
        return
      }
    }

    // Job-site geofence: soft warning only — do NOT hard-block (MAUI job On Site is separate)
    // Display handled in modal UI below.

    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)

    const idempotencyKey = crypto.randomUUID()
    const punchDateTime  = new Date().toISOString()
    const punchType: 'in' | 'out' = isClockedIn ? 'out' : 'in'

    const queueAndOptimistic = () => {
      enqueue({
        idempotency_key: idempotencyKey,
        company_id:      compId,
        employee_id:     empId,
        type:            punchType,
        date_time:       punchDateTime,
        latitude:        geoLat,
        longitude:       geoLng,
        address:         geoAddress,
        job_id:          clockJobId || null,
        notes:           clockNote || null,
        queued_at:       new Date().toISOString(),
      })
      setPendingPunches(getQueue())
      applyOptimisticPunch(punchType, punchDateTime)
      setShowClockModal(false)
      setHasMissedSignOut(false)
      setClockLoading(false)
    }

    if (!navigator.onLine) {
      queueAndOptimistic()
      return
    }

    const { error } = await rpc('employee_insert_punch', {
      p_company_id:            compId,
      p_employee_id:           empId,
      p_type:                  punchType,
      p_date_time:             punchDateTime,
      p_latitude:              geoLat,
      p_longitude:             geoLng,
      p_address:               geoAddress,
      p_job_id:                clockJobId || null,
      p_notes:                 clockNote || null,
      p_punched_by_manager_id: null,
      p_idempotency_key:       idempotencyKey,
      p_session_token:         tokRef.current,
    })

    if (error) {
      if (shouldQueuePunchFailure(error.message)) {
        queueAndOptimistic()
        return
      }
      setClockError(error.message)
      setClockLoading(false)
      return
    }

    setShowClockModal(false)
    setHasMissedSignOut(false)
    setClockLoading(false)
    await init({ soft: true })
  }

  // ── Absence modal ──────────────────────────────────────────────────────
  function openAbsenceModal() {
    if (isPending) {
      window.alert('Clock in and other company features unlock once HR approves your account.')
      return
    }
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
      setIsAbsentToday(true)
      setAbsenceReasonLabel(fmtAbsenceReason(absenceReason))
      setTimeout(() => setShowAbsenceModal(false), 1500)
    } catch (e: unknown) {
      setAbsenceError(e instanceof Error ? e.message : 'Failed to report absence.')
    }
    setAbsenceSubmitting(false)
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const pendingLeave  = leaveRequests.filter(r => r.status === 'pending').length
  const openIncidents = incidents.filter(i => i.status === 'open' || i.status === 'investigating').length
  const activeJobs    = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled')
  const showBranchBanner = showClockCard && !isClockedIn && !!branchStatus?.enforcementActive && !!branchStatus.displayMessage
  const companyName = companyWs?.name ?? 'your company'
  const pendingBannerText = companyWs
    ? `Awaiting HR approval at ${companyName}. You can upload documents below — only this company can see them.`
    : 'Awaiting HR approval. You can upload documents for this company while you wait.'

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
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface flex items-center justify-between gap-3">
        <h1 className="text-[18px] font-semibold text-text-primary">Dashboard</h1>
        <div className="flex items-center gap-1">
          <Link
            href="/auth/company-selector"
            className="text-[12px] font-semibold text-primary px-2.5 py-1.5 rounded-lg hover:bg-primary/10 transition-colors"
            title="Switch company"
          >
            My Companies
          </Link>
          <Link
            href="/dashboard/employee/notifications"
            className="relative flex items-center justify-center w-10 h-10 rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors"
            title="Notifications"
          >
            <span className="material-icons text-[22px]">notifications</span>
            {notificationCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center">
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Offline punch queue banner */}
      {pendingPunches.length > 0 && (
        <div className="mx-4 mt-3 shrink-0 rounded-xl px-4 py-3 bg-warning/10 border border-warning/30 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-warning">
              {pendingPunches.length} punch{pendingPunches.length > 1 ? 'es' : ''} saved offline
            </p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Will sync automatically when you reconnect.
            </p>
          </div>
          <button
            onClick={syncQueue}
            className="text-[12px] font-semibold text-warning border border-warning/40 px-3 py-1.5 rounded-lg hover:bg-warning/10 transition-colors">
            Retry now
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Pending membership banner */}
        {isPending && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
              <span className="material-icons text-warning text-[20px] mt-0.5">pending</span>
              <p className="text-[13px] text-warning font-medium">{pendingBannerText}</p>
            </div>
            <Link
              href="/dashboard/employee/documents"
              className="flex items-center gap-3 bg-surface border border-divider rounded-xl px-4 py-3 hover:border-primary transition-colors"
            >
              <span className="material-icons text-primary text-[28px]">folder</span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-text-primary">Upload Documents</p>
                <p className="text-[12px] text-text-secondary">
                  Share ID, contracts, and other files with this company&apos;s HR team.
                </p>
              </div>
              <span className="material-icons text-text-disabled">chevron_right</span>
            </Link>
          </div>
        )}

        {/* On leave banner */}
        {showWorkspace && isOnLeave && !isClockedIn && (
          <div className="flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-3">
            <span className="material-icons text-primary text-[20px]">beach_access</span>
            <p className="text-[13px] text-primary font-medium">You are currently on approved leave.</p>
          </div>
        )}

        {/* Absence reported pill */}
        {showWorkspace && modules.attendance && isAbsentToday && (
          <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
            <span className="material-icons text-warning text-[20px]">sick</span>
            <div>
              <p className="text-[13px] text-warning font-semibold">Absence Reported</p>
              {absenceReasonLabel && (
                <p className="text-[12px] text-text-secondary mt-0.5">{absenceReasonLabel}</p>
              )}
            </div>
          </div>
        )}

        {/* Missed sign-out banner */}
        {showClockCard && hasMissedSignOut && lastPunch && (
          <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
            <span className="material-icons text-warning text-[20px]">alarm</span>
            <p className="text-[13px] text-warning font-medium">
              You forgot to clock out yesterday. Your last punch was {fmtDate(lastPunch.date_time)}. Please clock out now.
            </p>
          </div>
        )}

        {/* Branch geofence banner */}
        {showBranchBanner && (
          <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
            <span className="material-icons text-warning text-[20px]">my_location</span>
            <p className="text-[13px] text-warning font-medium">{branchStatus?.displayMessage}</p>
          </div>
        )}

        {/* Clock card */}
        {showClockCard && (
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
                    Last: {fmtTime(lastPunch.date_time)}
                  </p>
                )}
              </div>
              <button
                onClick={openClockModal}
                className={`flex flex-col items-center justify-center w-20 h-20 rounded-full font-bold text-[14px] shadow-lg transition-all active:scale-95 ${
                  isClockedIn
                    ? 'bg-error text-white hover:bg-error/90'
                    : (isOnLeave || isAbsentToday)
                      ? 'bg-warning text-white hover:bg-warning/90'
                      : 'bg-primary text-white hover:bg-primary-dark'
                }`}
              >
                <span className="material-icons text-[28px]">
                  {isClockedIn ? 'stop' : (isOnLeave || isAbsentToday) ? 'block' : 'play_arrow'}
                </span>
                <span className="text-[9px] font-bold mt-0.5 leading-tight text-center px-1">
                  {clockButtonLabel()}
                </span>
              </button>
            </div>
            <div className="h-px bg-divider mb-3" />
            <p className="text-[11px] text-text-disabled">
              Today: <span className="text-text-secondary font-medium">{punchesToday} punch{punchesToday !== 1 ? 'es' : ''}</span>
            </p>
            {!isClockedIn && !isAbsentToday && (
              <button onClick={openAbsenceModal}
                className="flex items-center gap-1.5 mt-3 text-[12px] font-semibold text-text-secondary border border-divider px-3 py-1.5 rounded-lg hover:border-warning hover:text-warning transition-colors">
                <span className="material-icons text-[16px]">sick</span>Report Absence
              </button>
            )}
          </div>
        )}

        {/* Today's PA Tasks strip */}
        {showWorkspace && modules.myPa && paTasks.length > 0 && (
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
        <div className={`grid grid-cols-2 gap-3 ${isPending ? 'opacity-60' : ''}`}>
          {modules.jobs ? (
            <Link href={showWorkspace ? '/dashboard/employee/jobs' : '#'}
              onClick={e => { if (!showWorkspace) e.preventDefault() }}
              className="bg-surface border border-divider rounded-xl p-4 hover:border-primary transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-primary text-[20px]">work</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Active Jobs</p>
              </div>
              <p className="text-[28px] font-bold text-text-primary">{activeJobs.length}</p>
            </Link>
          ) : (
            <div className="bg-surface border border-divider rounded-xl p-4 opacity-40">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-text-disabled text-[20px]">work</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Active Jobs</p>
              </div>
              <p className="text-[28px] font-bold text-text-disabled">—</p>
            </div>
          )}
          {modules.leave ? (
            <Link href={showWorkspace ? '/dashboard/employee/leave' : '#'}
              onClick={e => { if (!showWorkspace) e.preventDefault() }}
              className="bg-surface border border-divider rounded-xl p-4 hover:border-primary transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-warning text-[20px]">beach_access</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Pending Leave</p>
              </div>
              <p className="text-[28px] font-bold text-text-primary">{pendingLeave}</p>
            </Link>
          ) : (
            <div className="bg-surface border border-divider rounded-xl p-4 opacity-40">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-text-disabled text-[20px]">beach_access</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Pending Leave</p>
              </div>
              <p className="text-[28px] font-bold text-text-disabled">—</p>
            </div>
          )}
          {modules.myPa ? (
            <Link href={showWorkspace ? '/dashboard/employee/pa' : '#'}
              onClick={e => { if (!showWorkspace) e.preventDefault() }}
              className="bg-surface border border-divider rounded-xl p-4 hover:border-primary transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-text-disabled text-[20px]">notifications</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">PA Tasks Today</p>
              </div>
              <p className="text-[28px] font-bold text-text-primary">{paTasks.length}</p>
            </Link>
          ) : (
            <div className="bg-surface border border-divider rounded-xl p-4 opacity-40">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-text-disabled text-[20px]">notifications</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">PA Tasks Today</p>
              </div>
              <p className="text-[28px] font-bold text-text-disabled">—</p>
            </div>
          )}
          {modules.incidents ? (
            <Link href={showWorkspace ? '/dashboard/employee/incidents' : '#'}
              onClick={e => { if (!showWorkspace) e.preventDefault() }}
              className="bg-surface border border-divider rounded-xl p-4 hover:border-primary transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-error text-[20px]">warning</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Open Incidents</p>
              </div>
              <p className="text-[28px] font-bold text-text-primary">{openIncidents}</p>
            </Link>
          ) : (
            <div className="bg-surface border border-divider rounded-xl p-4 opacity-40">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-icons text-text-disabled text-[20px]">warning</span>
                <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Open Incidents</p>
              </div>
              <p className="text-[28px] font-bold text-text-disabled">—</p>
            </div>
          )}
        </div>

        {/* Quick links — MAUI More / Home discoverability */}
        {showWorkspace && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Quick Links</p>
            </div>
            <div className="divide-y divide-divider">
              {modules.scheduling && (
                <Link href="/dashboard/employee/shifts" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors">
                  <span className="material-icons text-primary text-[22px]">event</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-text-primary">My Shifts</p>
                    <p className="text-[12px] text-text-secondary">View schedule and RSVP</p>
                  </div>
                  <span className="material-icons text-text-disabled">chevron_right</span>
                </Link>
              )}
              {modules.paperless && (
                <Link href="/dashboard/employee/forms" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors">
                  <span className="material-icons text-primary text-[22px]">description</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-text-primary">Forms</p>
                    <p className="text-[12px] text-text-secondary">Fill company forms</p>
                  </div>
                  <span className="material-icons text-text-disabled">chevron_right</span>
                </Link>
              )}
              {modules.payroll && (
                <Link href="/dashboard/employee/payslips" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors">
                  <span className="material-icons text-primary text-[22px]">payments</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-text-primary">My Payslips</p>
                    <p className="text-[12px] text-text-secondary">View released payslips</p>
                  </div>
                  <span className="material-icons text-text-disabled">chevron_right</span>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Home attendance (compact, last 7 days) */}
        {showClockCard && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <p className="section-label">Recent Attendance</p>
              <Link href="/dashboard/employee/attendance"
                className="text-[12px] font-semibold text-primary hover:underline">
                View all / Export
              </Link>
            </div>
            {recentPunches.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-text-secondary">No punches in the last 7 days.</p>
            ) : (
              <div className="divide-y divide-divider">
                {recentPunches.slice(0, 8).map(p => (
                  <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <p className="text-[12px] text-text-secondary w-[88px] shrink-0">{fmtDate(p.date_time)}</p>
                    <p className="text-[12px] font-semibold text-text-primary capitalize flex-1">{p.type === 'in' ? 'In' : p.type === 'out' ? 'Out' : p.type}</p>
                    <p className="text-[12px] text-text-disabled tabular-nums">{fmtTime(p.date_time)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* My Teams — MAUI overview section */}
        {showWorkspace && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">My Teams</p>
            </div>
            {myTeams.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-text-secondary">You&apos;re not a member of any teams yet.</p>
            ) : (
              <div className="divide-y divide-divider">
                {myTeams.map(t => (
                  <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-text-primary truncate">{t.name}</p>
                      {t.description && (
                        <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">{t.description}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-text-disabled shrink-0 tabular-nums">
                      {(t.member_ids ?? []).length} members
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active Jobs strip */}
        {showWorkspace && modules.jobs && activeJobs.length > 0 && (
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
        {showWorkspace && modules.leave && colleagues.length > 0 && (
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
        {showWorkspace && activityItems.length > 0 && (
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

            {!isClockedIn && modules.jobs && activeJobs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Job (optional)</label>
                <select className="input" value={clockJobId ?? ''} onChange={e => onJobSelect(e.target.value || null)}>
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

            {/* Location feedback */}
            <div className="mb-3">
              {geoLat ? (
                <p className="text-[12px] text-text-secondary flex items-center gap-1">
                  <span className="material-icons text-[14px] text-success">location_on</span>
                  {geoAddress ?? `${geoLat.toFixed(5)}, ${geoLng?.toFixed(5)}`}
                </p>
              ) : (
                <p className="text-[12px] text-text-disabled flex items-center gap-1">
                  <span className="material-icons text-[14px]">location_searching</span>
                  Getting location…
                </p>
              )}
            </div>

            {/* Duplicate shift warning */}
            {!isClockedIn && punchesToday >= 2 && (
              <div className="rounded-lg px-3 py-2.5 bg-warning/10 border border-warning/30 mb-3">
                <p className="text-[12px] font-semibold text-warning">Shift already recorded today</p>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  You have {punchesToday} punches today. Clock in again only if starting a second shift.
                </p>
              </div>
            )}

            {/* Branch geofence status in modal */}
            {!isClockedIn && branchStatus?.enforcementActive && (
              <div className={`rounded-lg px-3 py-2.5 mb-3 ${
                branchStatus.isWithinRadius
                  ? 'bg-success/10 border border-success/30'
                  : 'bg-error/10 border border-error/30'
              }`}>
                <p className={`text-[12px] font-semibold ${branchStatus.isWithinRadius ? 'text-success' : 'text-error'}`}>
                  {branchStatus.isWithinRadius ? 'Within branch sign-in area' : 'Cannot Clock In'}
                </p>
                <p className="text-[12px] text-text-secondary mt-0.5">{branchStatus.displayMessage}</p>
              </div>
            )}

            {/* Job-site geofence — soft warning only (not a hard block) */}
            {geofenceData && geoLat !== null && geoLng !== null && (() => {
              const distM = haversineMeters(geoLat, geoLng!, geofenceData.latitude, geofenceData.longitude)
              const inside = distM <= geofenceData.radius_meters
              return (
                <div className={`rounded-lg px-3 py-2.5 mb-3 ${
                  inside
                    ? 'bg-success/10 border border-success/30'
                    : 'bg-warning/10 border border-warning/30'
                }`}>
                  <p className={`text-[12px] font-semibold ${inside ? 'text-success' : 'text-warning'}`}>
                    {inside ? 'Within work zone' : 'Outside job site zone'}
                  </p>
                  <p className="text-[12px] text-text-secondary mt-0.5">
                    {Math.round(distM)}m from site center · limit {Math.round(geofenceData.radius_meters)}m
                    {!inside && ' — you can still clock in; use On Site on the job card for site presence.'}
                  </p>
                </div>
              )
            })()}

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
                  <option key={r} value={r}>{fmtAbsenceReason(r)}</option>
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
