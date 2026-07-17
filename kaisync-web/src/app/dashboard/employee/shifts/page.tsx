'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import Link from 'next/link'

interface CalendarEvent {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  is_all_day: boolean
  location: string | null
  event_type: string | null
  linked_job_id: string | null
  attendance_responses: Record<string, string> | null
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  const r = new Date(d)
  r.setDate(r.getDate() + diff)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmtWeekLabel(start: Date): string {
  const end = addDays(start, 6)
  return `${start.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

function fmtDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function isPast(iso: string): boolean {
  return new Date(iso) < new Date()
}

const RESPONSE_STYLES: Record<string, string> = {
  accepted: 'bg-success/10 text-success',
  declined: 'bg-error/10 text-error',
}

export default function EmployeeShiftsPage() {
  const [events,    setEvents]    = useState<CalendarEvent[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
  const [empId,     setEmpId]     = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [responding, setResponding] = useState<string | null>(null)
  const tokRef = useRef<string | null>(null)

  useEffect(() => { init() }, [])
  useEffect(() => { if (empId && companyId) loadEvents() }, [weekStart, empId, companyId])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setEmpId(member.employeeId)
    setCompanyId(member.companyId)
    tokRef.current = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    await loadEventsFor(member.employeeId, member.companyId, weekStart)
    setLoading(false)
  }

  async function loadEvents() {
    if (!empId || !companyId) return
    setLoading(true)
    await loadEventsFor(empId, companyId, weekStart)
    setLoading(false)
  }

  async function loadEventsFor(eid: string, cid: string, ws: Date) {
    const supabase = createClient()
    const from = addDays(ws, -7).toISOString().split('T')[0]
    const to   = addDays(ws, 13).toISOString().split('T')[0]

    try {
      const token = tokRef.current
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcErr } = await (supabase.rpc as any)('employee_get_calendar_events_for_worker', {
        p_company_id:    cid,
        p_employee_id:   eid,
        p_from:          from,
        p_to:            to,
        p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      setEvents((data as CalendarEvent[]) ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load shifts.')
    }
  }

  async function respond(eventId: string, response: 'accepted' | 'declined') {
    if (!empId || !companyId) return
    setResponding(eventId)
    const supabase = createClient()
    try {
      const token = tokRef.current
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_update_calendar_event_attendance', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_event_id:      eventId,
        p_response:      response,
        p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      setEvents(prev => prev.map(e => {
        if (e.id !== eventId) return e
        const updated = { ...(e.attendance_responses ?? {}), [empId]: response }
        return { ...e, attendance_responses: updated }
      }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update response.')
    }
    setResponding(null)
  }

  // Group events by date (YYYY-MM-DD) within this week
  const weekEnd = addDays(weekStart, 6)
  const thisWeekEvents = events.filter(e => {
    const d = new Date(e.start_time)
    return d >= weekStart && d <= weekEnd
  })

  const grouped: Record<string, CalendarEvent[]> = {}
  for (const e of thisWeekEvents) {
    const day = new Date(e.start_time).toISOString().split('T')[0]
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(e)
  }
  const sortedDays = Object.keys(grouped).sort()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">My Shifts</h1>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="text-[12px] font-semibold text-primary hover:underline">Today</button>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => setWeekStart(d => addDays(d, -7))}
            className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">chevron_left</span>
          </button>
          <p className="flex-1 text-center text-[13px] font-semibold text-text-primary">{fmtWeekLabel(weekStart)}</p>
          <button onClick={() => setWeekStart(d => addDays(d, 7))}
            className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">chevron_right</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-4 mt-4 rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-[14px]">Loading…</div>
        ) : sortedDays.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">event_busy</span>
            <p className="text-[14px]">No shifts scheduled in this period.</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {sortedDays.map(day => (
              <div key={day}>
                <div className="px-4 py-2 bg-surface-elevated sticky top-0">
                  <p className="text-[12px] font-semibold text-text-secondary">{fmtDayHeading(day + 'T12:00:00')}</p>
                </div>
                {grouped[day].map(ev => {
                  const myResponse = ev.attendance_responses?.[empId ?? '']
                  const past = isPast(ev.end_time ?? ev.start_time)
                  return (
                    <div key={ev.id} className={`px-4 py-4 ${past ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[14px] font-semibold text-text-primary">{ev.title}</p>
                            {past && <span className="text-[10px] font-bold text-text-disabled uppercase">Past</span>}
                            {ev.event_type && (
                              <span className="text-[11px] px-2 py-[2px] rounded-full bg-surface-elevated border border-divider text-text-secondary capitalize">{ev.event_type}</span>
                            )}
                          </div>
                          <p className="text-[12px] text-text-secondary mt-0.5">
                            {ev.is_all_day ? 'All day' : `${fmtTime(ev.start_time)} – ${ev.end_time ? fmtTime(ev.end_time) : '?'}`}
                          </p>
                          {ev.location && <p className="text-[12px] text-text-disabled mt-0.5">{ev.location}</p>}
                          {ev.linked_job_id && (
                            <Link href={`/dashboard/employee/jobs/${ev.linked_job_id}`}
                              className="inline-flex items-center gap-1 mt-1 text-[12px] text-primary hover:underline">
                              <span className="material-icons text-[14px]">work</span>View job
                            </Link>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          {myResponse ? (
                            <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${RESPONSE_STYLES[myResponse] ?? 'bg-surface-elevated text-text-secondary'}`}>
                              {myResponse}
                            </span>
                          ) : (
                            <span className="text-[11px] px-2 py-[2px] rounded-full bg-surface-elevated text-text-disabled border border-divider">No response</span>
                          )}
                          {!past && (
                            <div className="flex gap-1.5">
                              <button onClick={() => respond(ev.id, 'accepted')} disabled={responding === ev.id}
                                className="text-[12px] font-semibold px-3 py-1 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-50">
                                Accept
                              </button>
                              <button onClick={() => respond(ev.id, 'declined')} disabled={responding === ev.id}
                                className="text-[12px] font-semibold px-3 py-1 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors disabled:opacity-50">
                                Decline
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
