'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Punch {
  id: string
  punch_type: 'clock_in' | 'clock_out'
  punched_at: string
  job_id: string | null
  notes: string | null
}

interface Session {
  date: string
  clockIn: string
  clockOut: string | null
  durationMs: number | null
  notes: string | null
}

type Range = 'today' | '7d' | '30d' | 'custom'

function fmt(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDuration(ms: number): string {
  const hrs = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  return `${hrs}h ${mins}m`
}

function buildSessions(punches: Punch[]): Session[] {
  const sorted = [...punches].sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime())
  const sessions: Session[] = []
  let pending: Punch | null = null

  for (const p of sorted) {
    if (p.punch_type === 'clock_in') {
      pending = p
    } else if (p.punch_type === 'clock_out' && pending) {
      const inMs  = new Date(pending.punched_at).getTime()
      const outMs = new Date(p.punched_at).getTime()
      sessions.push({
        date:       new Date(pending.punched_at).toISOString().split('T')[0],
        clockIn:    pending.punched_at,
        clockOut:   p.punched_at,
        durationMs: outMs - inMs,
        notes:      pending.notes,
      })
      pending = null
    }
  }
  if (pending) {
    sessions.push({
      date:       new Date(pending.punched_at).toISOString().split('T')[0],
      clockIn:    pending.punched_at,
      clockOut:   null,
      durationMs: null,
      notes:      pending.notes,
    })
  }
  return sessions.reverse()
}

export default function EmployeeAttendancePage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading]   = useState(true)
  const [range, setRange]       = useState<Range>('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  useEffect(() => { load() }, [range, customFrom, customTo])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    let from: string
    const now = new Date()
    if (range === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    } else if (range === '7d') {
      from = new Date(now.getTime() - 7 * 86400000).toISOString()
    } else if (range === '30d') {
      from = new Date(now.getTime() - 30 * 86400000).toISOString()
    } else {
      from = customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 30 * 86400000).toISOString()
    }
    const to = range === 'custom' && customTo ? new Date(customTo + 'T23:59:59').toISOString() : now.toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_my_punches', {
      p_employee_id: member.employeeId,
      p_company_id:  member.companyId,
      p_from:        from,
      p_to:          to,
    })
    setSessions(buildSessions((data as Punch[]) ?? []))
    setLoading(false)
  }

  const totalMs = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Attendance</h1>
        <div className="flex flex-wrap gap-2 mt-3">
          {(['today', '7d', '30d', 'custom'] as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                range === r ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}>
              {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Custom'}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex gap-3 mt-3">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="input text-[13px]" placeholder="From" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="input text-[13px]" placeholder="To" />
          </div>
        )}
      </div>

      {/* Summary bar */}
      {!loading && sessions.length > 0 && (
        <div className="flex gap-6 px-4 py-3 bg-surface-elevated border-b border-divider shrink-0">
          <div>
            <p className="text-[11px] text-text-disabled uppercase font-semibold">Sessions</p>
            <p className="text-[18px] font-bold text-text-primary">{sessions.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-text-disabled uppercase font-semibold">Total Hours</p>
            <p className="text-[18px] font-bold text-text-primary">{fmtDuration(totalMs)}</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-[14px]">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">schedule</span>
            <p className="text-[14px]">No attendance records</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {sessions.map((s, i) => (
              <div key={i} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">{fmtDate(s.clockIn)}</p>
                    <p className="text-[12px] text-text-secondary mt-1">
                      {fmt(s.clockIn)} → {s.clockOut ? fmt(s.clockOut) : <span className="text-primary font-semibold">Active</span>}
                    </p>
                    {s.notes && <p className="text-[12px] text-text-disabled mt-1 italic">"{s.notes}"</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {s.durationMs != null ? (
                      <span className="text-[13px] font-bold text-text-primary">{fmtDuration(s.durationMs)}</span>
                    ) : (
                      <span className="text-[12px] font-semibold px-2 py-1 rounded-full bg-success/10 text-success">In progress</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
