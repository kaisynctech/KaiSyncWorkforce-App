'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface LastPunch {
  punch_type: 'clock_in' | 'clock_out'
  punched_at: string
  job_title:  string | null
}

interface Job {
  id: string
  title: string
}

interface LeaveRequest {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  status: string
  days_requested: number
}

interface Notification {
  id: string
  title: string
  is_read: boolean
  created_at: string
}

interface Incident {
  id: string
  title: string
  severity: string | null
  status: string | null
}

interface RegistrationStatus {
  registration_status: string | null
}

function fmtElapsed(ms: number): string {
  const hrs  = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
}

export default function EmployeeOverviewPage() {
  const [loading, setLoading]           = useState(true)
  const [registrationStatus, setRegStatus] = useState<string | null>(null)

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

  // Data
  const [jobs,           setJobs]           = useState<Job[]>([])
  const [leaveRequests,  setLeaveRequests]  = useState<LeaveRequest[]>([])
  const [notifications,  setNotifications]  = useState<Notification[]>([])
  const [incidents,      setIncidents]      = useState<Incident[]>([])
  const [isOnLeave,      setIsOnLeave]      = useState(false)
  const [punchesToday,   setPunchesToday]   = useState(0)

  const baseElapsedRef  = useRef<number>(0)
  const clockInTimeRef  = useRef<string | null>(null)
  const empIdRef        = useRef<string | null>(null)
  const companyIdRef    = useRef<string | null>(null)
  const tickerRef       = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { init() }, [])

  // Ticker
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

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    empIdRef.current     = member.employeeId
    companyIdRef.current = member.companyId

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabase.rpc as any
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

    const [
      lastPunchRes, jobsRes, leaveRes,
      onLeaveRes, notifRes, incRes,
      punchesRes, regRes,
    ] = await Promise.all([
      rpc('employee_get_last_punch',    { p_employee_id: member.employeeId, p_company_id: member.companyId }),
      rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId }),
      rpc('employee_get_leave_requests',{ p_employee_id: member.employeeId, p_company_id: member.companyId }),
      rpc('employee_is_on_leave_today', { p_employee_id: member.employeeId, p_company_id: member.companyId }),
      rpc('employee_get_my_notifications_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId }),
      rpc('employee_get_own_incidents', { p_employee_id: member.employeeId, p_company_id: member.companyId }),
      rpc('employee_get_my_punches',    { p_employee_id: member.employeeId, p_company_id: member.companyId, p_from: todayStart, p_to: now.toISOString() }),
      supabase.from('employees').select('registration_status').eq('id', member.employeeId).maybeSingle(),
    ])

    const lp = (lastPunchRes.data as LastPunch[] | null)?.[0] ?? null
    setLastPunch(lp)

    if (lp?.punch_type === 'clock_in') {
      setIsClockedIn(true)
      clockInTimeRef.current = lp.punched_at
      baseElapsedRef.current = 0
      setElapsedMs(Date.now() - new Date(lp.punched_at).getTime())
    } else {
      setIsClockedIn(false)
      clockInTimeRef.current = null
      baseElapsedRef.current = 0
      setElapsedMs(0)
    }

    setJobs((jobsRes.data as Job[]) ?? [])
    setLeaveRequests((leaveRes.data as LeaveRequest[]) ?? [])
    setIsOnLeave(onLeaveRes.data === true || (Array.isArray(onLeaveRes.data) && onLeaveRes.data?.[0]?.is_on_leave === true))
    setNotifications((notifRes.data as Notification[]) ?? [])
    setIncidents((incRes.data as Incident[]) ?? [])
    setPunchesToday(((punchesRes.data as unknown[] | null) ?? []).length)
    setRegStatus((regRes.data as RegistrationStatus | null)?.registration_status ?? null)

    setLoading(false)
  }

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
    const empId    = empIdRef.current
    const compId   = companyIdRef.current
    if (!empId || !compId) return
    setClockLoading(true)
    setClockError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabase.rpc as any

    if (isClockedIn) {
      const { error } = await rpc('employee_clock_out', {
        p_employee_id: empId,
        p_company_id:  compId,
        p_notes:       clockNote || null,
        p_latitude:    geoLat,
        p_longitude:   geoLng,
      })
      if (error) { setClockError(error.message); setClockLoading(false); return }
    } else {
      const { error } = await rpc('employee_clock_in', {
        p_employee_id: empId,
        p_company_id:  compId,
        p_job_id:      clockJobId || null,
        p_notes:       clockNote || null,
        p_latitude:    geoLat,
        p_longitude:   geoLng,
      })
      if (error) { setClockError(error.message); setClockLoading(false); return }
    }

    setShowClockModal(false)
    setClockLoading(false)
    await init()
  }

  const unreadCount = notifications.filter(n => !n.is_read).length
  const pendingLeave = leaveRequests.filter(r => r.status === 'pending').length
  const openIncidents = incidents.filter(i => i.status === 'open' || i.status === 'under_review').length
  const activeJobs = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled').length

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Dashboard</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Pending banner */}
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
              {isClockedIn && lastPunch?.job_title && (
                <p className="text-[12px] text-text-secondary mt-0.5">{lastPunch.job_title}</p>
              )}
              {!isClockedIn && lastPunch?.punched_at && (
                <p className="text-[12px] text-text-secondary mt-1">
                  Last: {new Date(lastPunch.punched_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
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
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-primary text-[20px]">work</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Active Jobs</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{activeJobs}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-warning text-[20px]">beach_access</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Pending Leave</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{pendingLeave}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={`material-icons text-[20px] ${unreadCount > 0 ? 'text-primary' : 'text-text-disabled'}`}>notifications</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Unread</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{unreadCount}</p>
          </div>
          <div className="bg-surface border border-divider rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-error text-[20px]">warning</span>
              <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Open Incidents</p>
            </div>
            <p className="text-[28px] font-bold text-text-primary">{openIncidents}</p>
          </div>
        </div>

        {/* Recent leave */}
        {leaveRequests.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Recent Leave Requests</p>
            </div>
            <div className="divide-y divide-divider">
              {leaveRequests.slice(0, 3).map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary capitalize">{r.leave_type.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-text-disabled">
                      {new Date(r.start_date + 'T12:00:00').toLocaleDateString('en-ZA', { day:'2-digit', month:'short' })} –{' '}
                      {new Date(r.end_date   + 'T12:00:00').toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' })}
                    </p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${
                    r.status === 'approved' ? 'bg-success/10 text-success' :
                    r.status === 'pending'  ? 'bg-warning/10 text-warning' :
                    r.status === 'rejected' ? 'bg-error/10 text-error' :
                    'bg-surface-elevated text-text-secondary'
                  }`}>{r.status}</span>
                </div>
              ))}
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

            {!isClockedIn && jobs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Job (optional)</label>
                <select className="input" value={clockJobId ?? ''} onChange={e => setClockJobId(e.target.value || null)}>
                  <option value="">No job selected</option>
                  {jobs.map(j => (
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
    </div>
  )
}
