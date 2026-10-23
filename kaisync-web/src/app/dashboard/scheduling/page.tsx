'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { listWorkTeams, memberIdsOf } from '@/lib/work-teams'
import { localISODate } from '@/lib/utils'
import { localDayOf, localDayRangeIso, localTimeOf, repeatDates, shiftTimesIso, WEEKDAYS } from '@/lib/schedule-times'
import { EmployeePicker, personLabel, type PickedEmployee } from '@/components/EmployeePicker'
import type { CalendarEvent } from '@/types/database'

type ViewMode = 'day' | 'week'
type EventType = 'shift' | 'meeting' | 'reminder'

type TeamOption = { id: string; name: string; memberIds: string[] }

// Local calendar date (it used the UTC date, which is yesterday between 00:00 and 02:00 in South Africa).
const todayStr = () => localISODate()

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
  return { start: localISODate(mon), end: localISODate(sun) }
}

function getWeekDays(dateStr: string): string[] {
  const { start } = getWeekRange(dateStr)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return localISODate(d)
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
  /** Names of people on the loaded schedule (looked up only for them, not the whole company). */
  const [people, setPeople] = useState<Map<string, PickedEmployee>>(new Map())
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<EventType>('shift')
  const [newStart, setNewStart] = useState('09:00')
  const [newEnd, setNewEnd] = useState('10:00')
  const [newDesc, setNewDesc] = useState('')
  const [assignees, setAssignees] = useState<PickedEmployee[]>([])
  const [repeatUntil, setRepeatUntil] = useState('')
  const [repeatDays, setRepeatDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))
  const [teamToAdd, setTeamToAdd] = useState('')

  const load = useCallback(async (date: string, mode: ViewMode) => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const range = mode === 'week' ? getWeekRange(date) : { start: date, end: date }
    const { fromIso, toIso } = localDayRangeIso(range.start, range.end)

    const [{ data, error: evErr }, teamRes] = await Promise.all([
      supabase
        .from('calendar_events')
        .select('*')
        .eq('company_id', member.companyId)
        .gte('start_time', fromIso)
        .lt('start_time', toIso)
        .order('start_time'),
      listWorkTeams(supabase, member.companyId, { activeOnly: true }),
    ])
    const rows = evErr ? [] : ((data ?? []) as CalendarEvent[])
    if (evErr) setError(evErr.message)
    setEvents(rows)
    if (teamRes.ok) setTeams(teamRes.data.map(t => ({ id: t.id, name: t.name, memberIds: memberIdsOf(t) })))
    await loadPeople(rows.flatMap(ev => ev.attendee_ids ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { void load(selectedDate, viewMode) }, [load, selectedDate, viewMode])

  /** Looks up names and employee numbers for these people (200 at a time) and keeps them. */
  async function loadPeople(ids: string[]): Promise<PickedEmployee[]> {
    const wanted = [...new Set(ids)].filter(Boolean)
    if (wanted.length === 0) return []
    const supabase = createClient()
    const found: PickedEmployee[] = []
    for (let i = 0; i < wanted.length; i += 200) {
      const { data } = await supabase
        .from('employees')
        .select('id, name, surname, employee_number, position, department')
        .in('id', wanted.slice(i, i + 200))
      found.push(...((data ?? []) as PickedEmployee[]))
    }
    setPeople(prev => {
      const next = new Map(prev)
      for (const p of found) next.set(p.id, p)
      return next
    })
    return found
  }

  async function addTeam(teamId: string) {
    const team = teams.find(t => t.id === teamId)
    if (!team) return
    const already = new Set(assignees.map(a => a.id))
    const missing = team.memberIds.filter(id => !already.has(id))
    const known = missing.map(id => people.get(id)).filter((p): p is PickedEmployee => Boolean(p))
    const toFetch = missing.filter(id => !people.has(id))
    const fetched = await loadPeople(toFetch)
    setAssignees(prev => [...prev, ...known, ...fetched])
    setTeamToAdd('')
  }

  function resetForm() {
    setNewTitle('')
    setNewType('shift')
    setNewStart('09:00')
    setNewEnd('10:00')
    setNewDesc('')
    setAssignees([])
    setRepeatUntil('')
    setRepeatDays(new Set([1, 2, 3, 4, 5]))
    setTeamToAdd('')
    setEditingId(null)
    setFormError(null)
  }

  function openCreate() {
    resetForm()
    setShowEditor(true)
  }

  function openEdit(ev: CalendarEvent) {
    setEditingId(ev.id)
    setNewTitle(ev.title)
    setNewType((ev.event_type as EventType) || 'shift')
    setNewStart(localTimeOf(ev.start_time, '09:00'))
    setNewEnd(localTimeOf(ev.end_time, '10:00'))
    setNewDesc(ev.description ?? '')
    setAssignees((ev.attendee_ids ?? []).map(id => people.get(id) ?? { id, name: 'Unknown', surname: '' }))
    setRepeatUntil('')
    setFormError(null)
    const day = localDayOf(ev.start_time)
    if (day) setSelectedDate(day)
    setShowEditor(true)
  }

  function downloadCSV() {
    const headers = ['Title', 'Type', 'Start', 'End', 'Description', 'Attendees']
    const empMap = new Map([...people.values()].map(e => [e.id, personLabel(e)]))
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

  async function saveEvent() {
    if (!newTitle.trim() || !companyId || !employeeId) return
    setBusy(true)
    setFormError(null)
    const supabase = createClient()
    const dates = editingId ? [selectedDate] : repeatDates(selectedDate, repeatUntil, repeatDays)
    if (dates.length === 0) { setFormError('No days match the repeat settings.'); setBusy(false); return }
    const attendeeIds = assignees.map(a => a.id)

    // Warn about anyone on approved leave or reported absent on these days.
    if (attendeeIds.length > 0) {
      const first = dates[0]
      const last = dates[dates.length - 1]
      const [{ data: leaveRows }, { data: absenceRows }] = await Promise.all([
        supabase.from('leave_requests')
          .select('employee_id, start_date, end_date')
          .eq('company_id', companyId)
          .in('employee_id', attendeeIds)
          .eq('status', 'approved')
          .lte('start_date', last)
          .gte('end_date', first),
        supabase.from('daily_absences')
          .select('employee_id, date, reason')
          .eq('company_id', companyId)
          .in('employee_id', attendeeIds)
          .in('date', dates),
      ])
      const clashes: string[] = []
      for (const l of (leaveRows ?? []) as { employee_id: string; start_date: string; end_date: string }[]) {
        const days = dates.filter(d => d >= l.start_date && d <= l.end_date)
        if (days.length) clashes.push(`${personLabel(people.get(l.employee_id) ?? { name: 'Someone', surname: '' })} is on leave (${days.join(', ')})`)
      }
      for (const a of (absenceRows ?? []) as { employee_id: string; date: string; reason: string }[]) {
        clashes.push(`${personLabel(people.get(a.employee_id) ?? { name: 'Someone', surname: '' })} is reported absent on ${a.date} (${a.reason})`)
      }
      if (clashes.length > 0) {
        const shown = clashes.slice(0, 8).join('\n')
        const more = clashes.length > 8 ? `\n…and ${clashes.length - 8} more.` : ''
        if (!window.confirm(`${shown}${more}\n\nSchedule anyway?`)) { setBusy(false); return }
      }
    }

    const rows = dates.map(day => {
      const { startIso, endIso } = shiftTimesIso(day, newStart, newEnd)
      return {
        title: newTitle.trim(),
        start_time: startIso,
        end_time: endIso,
        description: newDesc.trim() || null,
        event_type: newType,
        attendee_ids: attendeeIds,
      }
    })

    if (editingId) {
      const { data, error: updErr } = await supabase
        .from('calendar_events')
        .update(rows[0])
        .eq('id', editingId)
        .eq('company_id', companyId)
        .select()
        .single()
      if (updErr) {
        setFormError(updErr.message)
        setBusy(false)
        return
      }
      if (data) {
        setEvents(prev =>
          prev
            .map(e => (e.id === editingId ? (data as CalendarEvent) : e))
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
        )
      }
    } else {
      const { error: insErr } = await supabase
        .from('calendar_events')
        .insert(rows.map(r => ({ company_id: companyId, created_by: employeeId, ...r })))
      if (insErr) {
        setFormError(insErr.message)
        setBusy(false)
        return
      }
      await load(selectedDate, viewMode)
    }

    resetForm()
    setShowEditor(false)
    setBusy(false)
  }

  async function deleteEvent() {
    if (!editingId || !companyId) return
    if (!window.confirm('Delete this schedule event?')) return
    setBusy(true)
    setFormError(null)
    const supabase = createClient()
    const { error: delErr } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', editingId)
      .eq('company_id', companyId)
    if (delErr) {
      setFormError(delErr.message)
      setBusy(false)
      return
    }
    setEvents(prev => prev.filter(e => e.id !== editingId))
    resetForm()
    setShowEditor(false)
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
  const empMap = new Map([...people.values()].map(e => [e.id, personLabel(e)]))
  const overnight = shiftTimesIso(selectedDate, newStart, newEnd).overnight
  const repeatCount = editingId ? 1 : repeatDates(selectedDate, repeatUntil, repeatDays).length

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-dark shrink-0">
        <h1 className="text-[20px] font-semibold text-text-primary">Scheduling</h1>
        <div className="flex gap-2">
          <button
            onClick={openCreate}
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

      {error && error !== 'not_linked' && (
        <p className="px-4 py-2 text-error text-[13px]">{error}</p>
      )}

      <div className="px-4 py-2.5 flex items-center gap-3 bg-surface-dark border-b border-divider shrink-0">
        <label htmlFor="schedule-date" className="text-xs font-medium text-text-secondary">Date:</label>
        <input
          id="schedule-date"
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
              const dayEvents = events.filter(ev => localDayOf(ev.start_time) === day)
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
                      <button
                        type="button"
                        key={ev.id}
                        onClick={() => openEdit(ev)}
                        className="rounded px-1 py-0.5 text-[10px] leading-tight truncate text-left"
                        style={{ backgroundColor: '#1D4ED820', color: '#60A5FA' }}
                      >
                        <span className="font-medium">{fmtTime(ev.start_time)}</span>
                        {' '}{ev.title}
                      </button>
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
                <button
                  type="button"
                  key={ev.id}
                  onClick={() => openEdit(ev)}
                  className="card p-0 overflow-hidden text-left w-full hover:ring-1 hover:ring-primary/30 transition"
                >
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
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showEditor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-text-primary">
              {editingId ? 'Edit Event' : 'New Event'}
            </h3>
            {formError && (
              <p className="text-[13px] text-error">{formError}</p>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="ev-title" className="text-xs text-text-secondary">Title *</label>
              <input id="ev-title" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Morning shift, Team meeting"
                className="dark-entry w-full" autoFocus />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ev-type" className="text-xs text-text-secondary">Type</label>
              <select
                id="ev-type"
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
                <label htmlFor="ev-start" className="text-xs text-text-secondary">Start time</label>
                <div className="bg-surface-dark rounded-lg px-3 py-1">
                  <input id="ev-start" type="time" value={newStart} onChange={e => setNewStart(e.target.value)}
                    className="bg-transparent text-text-primary outline-none h-9 w-full" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="ev-end" className="text-xs text-text-secondary">End time</label>
                <div className="bg-surface-dark rounded-lg px-3 py-1">
                  <input id="ev-end" type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)}
                    className="bg-transparent text-text-primary outline-none h-9 w-full" />
                </div>
              </div>
            </div>
            {overnight && (
              <p className="text-[12px] text-text-secondary">Ends the next day (night shift).</p>
            )}
            {!editingId && (
              <fieldset className="flex flex-col gap-1.5 border border-divider rounded-lg p-2">
                <legend className="text-xs text-text-secondary px-1">Repeat (optional)</legend>
                <label htmlFor="ev-repeat-until" className="text-xs text-text-secondary">Repeat until</label>
                <input id="ev-repeat-until" type="date" value={repeatUntil} min={selectedDate}
                  onChange={e => setRepeatUntil(e.target.value)} className="dark-entry w-full" />
                {repeatUntil && repeatUntil > selectedDate && (
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Repeat on these days">
                    {WEEKDAYS.map(w => {
                      const on = repeatDays.has(w.day)
                      return (
                        <button key={w.day} type="button" aria-pressed={on}
                          onClick={() => setRepeatDays(prev => {
                            const next = new Set(prev)
                            if (next.has(w.day)) next.delete(w.day); else next.add(w.day)
                            return next
                          })}
                          className={`h-8 px-2 rounded text-[12px] border ${on ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary'}`}>
                          {w.short}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="text-[11px] text-text-secondary">
                  {repeatCount === 1 ? 'One day.' : `${repeatCount} days. Repeats can run up to about 3 months ahead.`}
                </p>
              </fieldset>
            )}
            {companyId && (
              <EmployeePicker
                companyId={companyId}
                multiple
                label="Assign to (optional)"
                value={assignees}
                onChange={setAssignees}
              />
            )}
            {teams.length > 0 && (
              <div className="flex flex-col gap-1">
                <label htmlFor="ev-team" className="text-xs text-text-secondary">Add a whole team</label>
                <select id="ev-team" value={teamToAdd}
                  onChange={e => { setTeamToAdd(e.target.value); if (e.target.value) void addTeam(e.target.value) }}
                  className="dark-entry w-full">
                  <option value="">Choose a team…</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.memberIds.length})</option>
                  ))}
                </select>
              </div>
            )}
            {assignees.length > 0 && (
              <p className="text-[12px] text-text-secondary">
                {assignees.length === 1 ? '1 person' : `${assignees.length} people`} assigned: {assignees.slice(0, 5).map(personLabel).join(', ')}
                {assignees.length > 5 ? ` and ${assignees.length - 5} more` : ''}
              </p>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="ev-desc" className="text-xs text-text-secondary">Description (optional)</label>
              <textarea id="ev-desc" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                rows={2} placeholder="Notes…"
                className="dark-entry w-full resize-none" />
            </div>
            <div className="flex gap-2 justify-between">
              {editingId ? (
                <button
                  type="button"
                  onClick={() => void deleteEvent()}
                  disabled={busy}
                  className="h-9 px-3 text-[13px] text-error hover:opacity-80 disabled:opacity-50"
                >
                  Delete
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { resetForm(); setShowEditor(false) }}
                  className="btn-outlined h-9 px-4 text-[13px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEvent()}
                  disabled={!newTitle.trim() || busy}
                  className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
                >
                  {busy ? 'Saving…' : repeatCount > 1 ? `Save ${repeatCount} days` : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
