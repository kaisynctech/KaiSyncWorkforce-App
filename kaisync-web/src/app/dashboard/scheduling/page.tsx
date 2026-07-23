'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { CalendarEvent } from '@/types/database'

type ViewMode = 'day' | 'week'
type EventType = 'shift' | 'meeting' | 'reminder'

interface EmpOption { id: string; name: string; surname: string }

const todayStr = () => new Date().toISOString().split('T')[0]

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const fmtShortDate = (dateStr: string) =>
  new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric' }).format(new Date(dateStr + 'T12:00:00'))

const fmtCsvDt = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getWeekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (dt: Date) => dt.toISOString().split('T')[0]
  return { start: fmt(mon), end: fmt(sun) }
}

function getWeekDays(dateStr: string): string[] {
  const { start } = getWeekRange(dateStr)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

export default function SchedulingPage() {
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [employees, setEmployees] = useState<EmpOption[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<EventType>('shift')
  const [newStart, setNewStart] = useState('09:00')
  const [newEnd, setNewEnd] = useState('10:00')
  const [newDesc, setNewDesc] = useState('')
  const [newAssignee, setNewAssignee] = useState('')

  const load = useCallback(async (date: string, mode: ViewMode) => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    let from: string
    let to: string
    if (mode === 'week') {
      const range = getWeekRange(date)
      from = `${range.start}T00:00:00`
      to   = `${range.end}T23:59:59`
    } else {
      const next = new Date(date + 'T12:00:00')
      next.setDate(next.getDate() + 1)
      from = `${date}T00:00:00`
      to   = `${next.toISOString().split('T')[0]}T00:00:00`
    }

    const [{ data }, { data: empData }] = await Promise.all([
      supabase
        .from('calendar_events')
        .select('*')
        .eq('company_id', member.companyId)
        .gte('start_time', from)
        .lt('start_time', to)
        .order('start_time'),
      supabase
        .from('employees')
        .select('id, name, surname')
        .eq('company_id', member.companyId)
        .eq('is_active', true)
        .order('name'),
    ])
    setEvents((data ?? []) as CalendarEvent[])
    setEmployees((empData ?? []) as EmpOption[])
    setLoading(false)
  }, [])

  useEffect(() => { load(selectedDate, viewMode) }, [load, selectedDate, viewMode])

  function downloadCSV() {
    const headers = ['Title', 'Type', 'Start', 'End', 'Description', 'Attendees']
    const empMap = new Map(employees.map(e => [e.id, `${e.name} ${e.surname}`]))
    const rows = events.map(ev => {
      const attendees = (ev.attendee_ids ?? [])
        .map(id => empMap.get(id) ?? id.slice(0, 8))
        .join('; ')
      return [
        ev.title,
        ev.event_type ?? 'shift',
        fmtCsvDt(ev.start_time),
        ev.end_time ? fmtCsvDt(ev.end_time) : '',
        ev.description ?? '',
        attendees,
      ].map(csvEscape)
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedule-${selectedDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function createEvent() {
    if (!newTitle.trim() || !companyId || !employeeId) return
    setBusy(true)
    const supabase = createClient()
    const startIso = `${selectedDate}T${newStart}:00`
    const endIso = `${selectedDate}T${newEnd}:00`

    if (newAssignee) {
      const [{ data: leaveRows }, { data: absenceRows }] = await Promise.all([
        supabase.from('leave_requests')
          .select('id')
          .eq('company_id', companyId)
          .eq('employee_id', newAssignee)
          .eq('status', 'approved')
          .lte('start_date', selectedDate)
          .gte('end_date', selectedDate)
          .limit(1),
        supabase.from('daily_absences')
          .select('id, reason')
          .eq('company_id', companyId)
          .eq('employee_id', newAssignee)
          .eq('date', selectedDate)
          .limit(1),
      ])

      const onLeave = (leaveRows ?? []).length > 0
      const absent = (absenceRows ?? [])[0] as { id: string; reason: string } | undefined
      if (onLeave || absent) {
        const emp = employees.find(e => e.id === newAssignee)
        const name = emp ? `${emp.name} ${emp.surname}` : 'Employee'
        const reason = onLeave
          ? 'on approved leave'
          : `reported absent (${absent?.reason ?? 'absent'})`
        const proceed = window.confirm(
          `${name} is ${reason} on ${selectedDate}. Assign anyway?`,
        )
        if (!proceed) { setBusy(false); return }
      }
    }

    const { data } = await supabase
      .from('calendar_events')
      .insert({
        company_id: companyId,
        title: newTitle.trim(),
        start_time: startIso,
        end_time: endIso,
        description: newDesc.trim() || null,
        event_type: newType,
        attendee_ids: newAssignee ? [newAssignee] : [],
        created_by: employeeId,
      })
      .select()
      .single()
    if (data) {
      setEvents(prev => [...prev, data as CalendarEvent].sort((a, b) => a.start_time.localeCompare(b.start_time)))
    }
    setNewTitle(''); setNewType('shift'); setNewStart('09:00'); setNewEnd('10:00'); setNewDesc(''); setNewAssignee('')
    setShowCreate(false)
    setBusy(false)
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

  const weekDays = viewMode === 'week' ? getWeekDays(selectedDate) : []
  const today = todayStr()
  const empMap = new Map(employees.map(e => [e.id, `${e.name} ${e.surname}`]))

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-dark shrink-0">
        <h1 className="text-[20px] font-semibold text-text-primary">Scheduling</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary h-9 px-3 text-[13px]">
            + Shift
          </button>
          <button
            className="btn-outlined h-9 px-3 text-[13px]"
            onClick={downloadCSV}
            disabled={events.length === 0}
          >
            Export
          </button>
        </div>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-3 bg-surface-dark border-b border-divider shrink-0">
        <label className="text-xs font-medium text-text-secondary">Date:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="bg-surface-dark border border-divider rounded-lg px-3 py-1.5 text-text-primary text-[13px] outline-none"
        />
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setViewMode('day')}
            className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${viewMode === 'day' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
          >
            Day
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${viewMode === 'week' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
          >
            Week
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : viewMode === 'week' ? (
          <div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {weekDays.map(day => {
              const dayEvents = events.filter(ev => ev.start_time.startsWith(day))
              const isToday = day === today
              return (
                <div key={day} className="flex flex-col gap-1 min-h-[120px]">
                  <div
                    className={`text-center py-1 text-[11px] font-semibold rounded ${isToday ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}
                  >
                    {fmtShortDate(day)}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.map(ev => (
                      <div
                        key={ev.id}
                        className="rounded px-1 py-0.5 text-[10px] leading-tight truncate"
                        style={{ backgroundColor: '#1D4ED820', color: '#60A5FA' }}
                      >
                        <span className="font-medium">{fmtTime(ev.start_time)}</span>
                        {' '}{ev.title}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <span className="material-icons text-[56px] text-text-disabled">calendar_month</span>
            <p className="text-text-secondary text-sm font-medium">No events scheduled</p>
            <p className="text-text-secondary text-sm text-center">
              Use the + Shift button to add shifts, meetings or reminders
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map(ev => {
              const assigneeNames = (ev.attendee_ids ?? [])
                .map(id => empMap.get(id))
                .filter(Boolean)
                .join(', ')
              return (
                <div key={ev.id} className="card p-0 overflow-hidden">
                  <div className="grid h-full" style={{ gridTemplateColumns: '4px 1fr' }}>
                    <div className="bg-primary rounded-l-xl" />
                    <div className="p-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-text-primary">{ev.title}</p>
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-elevated text-text-secondary">
                          {ev.event_type ?? 'shift'}
                        </span>
                      </div>
                      <div className="flex gap-2 items-center mt-0.5">
                        <span className="text-xs text-primary">{fmtTime(ev.start_time)}</span>
                        <span className="text-xs text-text-secondary">–</span>
                        <span className="text-xs text-text-secondary">{ev.end_time ? fmtTime(ev.end_time) : ''}</span>
                      </div>
                      {assigneeNames && (
                        <p className="text-xs text-text-secondary mt-1">Assigned: {assigneeNames}</p>
                      )}
                      {ev.description && (
                        <p className="text-xs text-text-secondary mt-1">{ev.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New Event</h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Title *</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Morning shift, Team meeting"
                className="dark-entry w-full" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Type</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as EventType)}
                className="dark-entry w-full"
              >
                <option value="shift">Shift</option>
                <option value="meeting">Meeting</option>
                <option value="reminder">Reminder</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Start time</label>
                <div className="bg-surface-dark rounded-lg px-3 py-1">
                  <input type="time" value={newStart} onChange={e => setNewStart(e.target.value)}
                    className="bg-transparent text-text-primary outline-none h-9 w-full" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">End time</label>
                <div className="bg-surface-dark rounded-lg px-3 py-1">
                  <input type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)}
                    className="bg-transparent text-text-primary outline-none h-9 w-full" />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Assign to (optional)</label>
              <select
                value={newAssignee}
                onChange={e => setNewAssignee(e.target.value)}
                className="dark-entry w-full"
              >
                <option value="">Unassigned</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Description (optional)</label>
              <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)}
                rows={2} placeholder="Notes…"
                className="dark-entry w-full resize-none" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="btn-outlined h-9 px-4 text-[13px]">
                Cancel
              </button>
              <button onClick={createEvent} disabled={!newTitle.trim() || busy}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
