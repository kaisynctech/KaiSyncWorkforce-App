'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { CalendarEvent } from '@/types/database'

const todayStr = () => new Date().toISOString().split('T')[0]

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export default function SchedulingPage() {
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [newTitle, setNewTitle] = useState('')
  const [newStart, setNewStart] = useState('09:00')
  const [newEnd, setNewEnd] = useState('10:00')
  const [newDesc, setNewDesc] = useState('')

  const load = useCallback(async (date: string) => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('company_id', member.companyId)
      .eq('date', date)
      .order('start_time')
    setEvents((data ?? []) as CalendarEvent[])
    setLoading(false)
  }, [])

  useEffect(() => { load(selectedDate) }, [load, selectedDate])

  async function createEvent() {
    if (!newTitle.trim()) return
    setBusy(true)
    const supabase = createClient()
    const startIso = `${selectedDate}T${newStart}:00`
    const endIso = `${selectedDate}T${newEnd}:00`
    const { data } = await supabase
      .from('calendar_events')
      .insert({
        company_id: companyId,
        title: newTitle.trim(),
        start_time: startIso,
        end_time: endIso,
        description: newDesc.trim() || null,
        date: selectedDate,
      })
      .select()
      .single()
    if (data) setEvents(prev => [...prev, data as CalendarEvent].sort((a, b) => a.start_time.localeCompare(b.start_time)))
    setNewTitle(''); setNewStart('09:00'); setNewEnd('10:00'); setNewDesc('')
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
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
            onClick={async () => {
              const supabase = createClient()
              try { await supabase.rpc('export_schedule', { date: selectedDate }) } catch {}
            }}>
            Export
          </button>
        </div>
      </div>

      {/* Date picker bar */}
      <div className="px-4 py-2.5 flex items-center gap-3 bg-surface-dark border-b border-divider shrink-0">
        <label className="text-xs font-medium text-text-secondary">Date:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="bg-surface-dark border border-divider rounded-lg px-3 py-1.5 text-text-primary text-[13px] outline-none"
        />
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <span className="text-[56px]">📅</span>
            <p className="text-text-secondary text-sm font-medium">No events scheduled</p>
            <p className="text-text-secondary text-sm text-center">
              Use the + Event button to add shifts, meetings or reminders
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map(ev => (
              <div key={ev.id} className="card p-0 overflow-hidden">
                <div className="grid h-full" style={{ gridTemplateColumns: '4px 1fr' }}>
                  <div className="bg-primary rounded-l-xl" />
                  <div className="p-3">
                    <p className="text-sm text-text-primary">{ev.title}</p>
                    <div className="flex gap-2 items-center mt-0.5">
                      <span className="text-xs text-primary">{fmtTime(ev.start_time)}</span>
                      <span className="text-xs text-text-secondary">–</span>
                      <span className="text-xs text-text-secondary">{fmtTime(ev.end_time)}</span>
                    </div>
                    {ev.description && (
                      <p className="text-xs text-text-secondary mt-1">{ev.description}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create event modal */}
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
