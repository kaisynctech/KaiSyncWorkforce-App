'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Punch {
  id: string
  type: 'in' | 'out'
  date_time: string
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
  const hrs  = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  return `${hrs}h ${mins}m`
}
function toDateStr(d: Date): string { return d.toISOString().split('T')[0] }

function buildSessions(punches: Punch[]): Session[] {
  const sorted = [...punches].sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime())
  const sessions: Session[] = []
  let pending: Punch | null = null

  for (const p of sorted) {
    if (p.type === 'in') {
      pending = p
    } else if (p.type === 'out' && pending) {
      const inMs  = new Date(pending.date_time).getTime()
      const outMs = new Date(p.date_time).getTime()
      sessions.push({
        date:       pending.date_time.split('T')[0],
        clockIn:    pending.date_time,
        clockOut:   p.date_time,
        durationMs: outMs - inMs,
        notes:      pending.notes,
      })
      pending = null
    }
  }
  if (pending) {
    sessions.push({
      date:       pending.date_time.split('T')[0],
      clockIn:    pending.date_time,
      clockOut:   null,
      durationMs: null,
      notes:      pending.notes,
    })
  }
  return sessions.reverse()
}

function exportCSV(sessions: Session[]) {
  const headers = ['Date', 'Clock In', 'Clock Out', 'Duration', 'Notes']
  const rows = sessions.map(s => [
    s.date,
    fmt(s.clockIn),
    s.clockOut ? fmt(s.clockOut) : '',
    s.durationMs != null ? fmtDuration(s.durationMs) : '',
    s.notes ?? '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'attendance.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function printPDF(sessions: Session[], empName: string, fromLabel: string, toLabel: string) {
  const rows = sessions.map(s => `
    <tr>
      <td>${fmtDate(s.clockIn)}</td>
      <td>${fmt(s.clockIn)}</td>
      <td>${s.clockOut ? fmt(s.clockOut) : '—'}</td>
      <td>${s.durationMs != null ? fmtDuration(s.durationMs) : 'In progress'}</td>
      <td>${s.notes ?? ''}</td>
    </tr>
  `).join('')

  const totalMs = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head><title>Attendance Report</title><style>
    body { font-family: sans-serif; font-size: 12px; padding: 20px; }
    h2 { font-size: 16px; margin-bottom: 4px; }
    p { margin: 2px 0 12px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    tfoot td { font-weight: bold; }
    @media print { button { display: none; } }
  </style></head><body>
    <h2>Attendance Report — ${empName}</h2>
    <p>Period: ${fromLabel} to ${toLabel}</p>
    <table>
      <thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Duration</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td>${fmtDuration(totalMs)}</td><td></td></tr></tfoot>
    </table>
    <br><button onclick="window.print()">Print / Save PDF</button>
  </body></html>`)
  w.document.close()
}

export default function EmployeeAttendancePage() {
  const [sessions,   setSessions]   = useState<Session[]>([])
  const [loading,    setLoading]    = useState(true)
  const [range,      setRange]      = useState<Range>('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [empName,    setEmpName]    = useState('Employee')

  useEffect(() => { load() }, [range, customFrom, customTo])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    const { data: { session } } = await supabase.auth.getSession()
    const tok = session?.access_token ?? null

    const now = new Date()
    let fromDate: string
    let toDate: string = toDateStr(now)

    if (range === 'today') {
      fromDate = toDateStr(now)
    } else if (range === '7d') {
      const d = new Date(now); d.setDate(d.getDate() - 7)
      fromDate = toDateStr(d)
    } else if (range === '30d') {
      const d = new Date(now); d.setDate(d.getDate() - 30)
      fromDate = toDateStr(d)
    } else {
      fromDate = customFrom || toDateStr(new Date(now.getTime() - 30 * 86400000))
      toDate   = customTo   || toDateStr(now)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_my_punches', {
      p_employee_id:   member.employeeId,
      p_company_id:    member.companyId,
      p_from:          fromDate,
      p_to:            toDate,
      p_session_token: tok,
    })
    setSessions(buildSessions((data as Punch[]) ?? []))

    // Get name for PDF header
    const { data: empRow } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', member.employeeId)
      .maybeSingle()
    if (empRow?.full_name) setEmpName(empRow.full_name)

    setLoading(false)
  }

  const totalMs = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)

  function rangeLabel(): [string, string] {
    const now = new Date()
    if (range === 'today') return [toDateStr(now), toDateStr(now)]
    if (range === '7d')    return [toDateStr(new Date(now.getTime() - 7 * 86400000)), toDateStr(now)]
    if (range === '30d')   return [toDateStr(new Date(now.getTime() - 30 * 86400000)), toDateStr(now)]
    return [customFrom || '—', customTo || toDateStr(now)]
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">Attendance</h1>
          <div className="flex gap-2">
            <button onClick={() => exportCSV(sessions)} title="Export Excel (CSV)"
              className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors"
              disabled={sessions.length === 0}>
              <span className="material-icons text-[16px]">table_chart</span>
            </button>
            <button onClick={() => { const [f, t] = rangeLabel(); printPDF(sessions, empName, f, t) }}
              title="Export PDF"
              className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors"
              disabled={sessions.length === 0}>
              <span className="material-icons text-[16px]">picture_as_pdf</span>
            </button>
          </div>
        </div>
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
