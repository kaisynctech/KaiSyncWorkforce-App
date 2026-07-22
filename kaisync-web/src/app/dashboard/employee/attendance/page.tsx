'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { loadCompanyWorkspace, loadEmployeeWorkspace } from '@/lib/employee-workspace'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import {
  buildPunchSessions,
  earlyFlag,
  fmtSessionDate,
  fmtSessionTime,
  lateFlag,
  locationDisplay,
  mergeNonWorkDays,
  totalHrsDisplay,
  type PunchLike,
  type PunchSessionRow,
  type ShiftTemplateLike,
} from '@/lib/punch-session'

type Range = 'today' | 'week' | 'month' | 'custom'

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cur <= end) {
    out.push(toDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function exportSessionsCSV(sessions: PunchSessionRow[]) {
  const headers = ['Date', 'Time In', 'In Location', 'Time Out', 'Out Location', 'Reg hrs', 'OT hrs', 'Total hrs', 'Flags', 'Notes']
  const rows = sessions.map(s => {
    const kind = s.isAbsentDay ? 'absent' : s.isLeaveDay ? 'leave' : 'in'
    const flags = [lateFlag(s), earlyFlag(s)].filter(Boolean).join('; ')
    return [
      fmtSessionDate(s.clockIn),
      fmtSessionTime(s.clockIn, kind as 'in' | 'absent' | 'leave'),
      s.isAbsentDay || s.isLeaveDay ? '—' : locationDisplay(s.clockInAddress, s.clockInLat, s.clockInLng),
      fmtSessionTime(s.clockOut, s.isAbsentDay || s.isLeaveDay ? 'out' : 'out'),
      s.isAbsentDay || s.isLeaveDay ? '—' : locationDisplay(s.clockOutAddress, s.clockOutLat, s.clockOutLng),
      s.regularHours.toFixed(2),
      s.overtimeHours.toFixed(2),
      totalHrsDisplay(s),
      flags,
      s.notes ?? s.statusNote ?? '',
    ]
  })
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'my_attendance.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function printSessionsPDF(sessions: PunchSessionRow[], empName: string, fromLabel: string, toLabel: string) {
  const rows = sessions.map(s => {
    const kind = s.isAbsentDay ? 'absent' : s.isLeaveDay ? 'leave' : 'in'
    const flags = [lateFlag(s), earlyFlag(s)].filter(Boolean).join('; ')
    return `<tr>
      <td>${fmtSessionDate(s.clockIn)}</td>
      <td>${fmtSessionTime(s.clockIn, kind as 'in' | 'absent' | 'leave')}</td>
      <td>${s.isAbsentDay || s.isLeaveDay ? '—' : locationDisplay(s.clockInAddress, s.clockInLat, s.clockInLng)}</td>
      <td>${fmtSessionTime(s.clockOut, 'out')}</td>
      <td>${s.isAbsentDay || s.isLeaveDay ? '—' : locationDisplay(s.clockOutAddress, s.clockOutLat, s.clockOutLng)}</td>
      <td>${totalHrsDisplay(s)}</td>
      <td>${flags || (s.notes ?? s.statusNote ?? '')}</td>
    </tr>`
  }).join('')
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head><title>Attendance Report</title><style>
    body{font-family:sans-serif;font-size:12px;padding:20px}
    h2{font-size:16px;margin-bottom:4px}
    p{margin:2px 0 12px;color:#555}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
    th{background:#f5f5f5;font-weight:600}
    @media print{button{display:none}}
  </style></head><body>
    <h2>Attendance Report — ${empName}</h2>
    <p>Period: ${fromLabel} to ${toLabel}</p>
    <table>
      <thead><tr><th>Date</th><th>Time In</th><th>In Location</th><th>Time Out</th><th>Out Location</th><th>Total hrs</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <br><button onclick="window.print()">Print / Save PDF</button>
  </body></html>`)
  w.document.close()
}

export default function EmployeeAttendancePage() {
  const allowed = useEmployeeModuleGate('attendance')
  const [sessions, setSessions] = useState<PunchSessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [empName, setEmpName] = useState('Employee')

  useEffect(() => {
    if (allowed !== true) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, range, customFrom, customTo])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null

    const now = new Date()
    let fromDate: string
    let toDate = toDateStr(now)
    if (range === 'today') fromDate = toDateStr(now)
    else if (range === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7); fromDate = toDateStr(d)
    } else if (range === 'month') {
      const d = new Date(now); d.setDate(d.getDate() - 30); fromDate = toDateStr(d)
    } else {
      fromDate = customFrom || toDateStr(new Date(now.getTime() - 30 * 86400000))
      toDate = customTo || toDateStr(now)
    }

    const [company, emp] = await Promise.all([
      loadCompanyWorkspace(supabase, member.companyId),
      loadEmployeeWorkspace(supabase, member.employeeId),
    ])

    const name = emp
      ? `${emp.name} ${emp.surname}`.trim()
      : (() => {
          const cs = getCodeSession()
          return cs?.employee ? `${cs.employee.name} ${cs.employee.surname}`.trim() : 'Employee'
        })()
    setEmpName(name)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = ((company as any)?.custom_settings
      ?? (company as { dispatch_settings?: Record<string, unknown> } | null)?.dispatch_settings
      ?? {}) as Record<string, unknown>

    // custom_settings may live on companies — try select if needed
    let lateMin = 30
    let otMin = 30
    try {
      const { data: co } = await supabase
        .from('companies')
        .select('custom_settings')
        .eq('id', member.companyId)
        .maybeSingle()
      const cs = (co?.custom_settings ?? settings) as Record<string, unknown>
      if (cs.late_threshold_minutes != null) lateMin = Number(cs.late_threshold_minutes) || 30
      if (cs.ot_start_after_minutes != null) otMin = Number(cs.ot_start_after_minutes) || 30
    } catch { /* defaults */ }

    let template: ShiftTemplateLike | null = null
    try {
      const { data: empRow } = await supabase
        .from('employees')
        .select('shift_template_id, daily_hours')
        .eq('id', member.employeeId)
        .maybeSingle()
      const tid = (empRow as { shift_template_id?: string | null } | null)?.shift_template_id
      if (tid) {
        const { data: tmpl } = await supabase
          .from('employee_shift_templates')
          .select('id, start_time, end_time, break_minutes')
          .eq('id', tid)
          .maybeSingle()
        if (tmpl) template = tmpl as ShiftTemplateLike
      }
    } catch { /* optional */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
    const [punchRes, absRes, leaveRes] = await Promise.all([
      rpc('employee_get_my_punches', {
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_from: fromDate,
        p_to: toDate,
        p_session_token: tok,
      }),
      rpc('employee_get_daily_absences', {
        p_company_id: member.companyId,
        p_employee_id: member.employeeId,
        p_from: fromDate,
        p_to: toDate,
        p_session_token: tok,
      }).catch(() => ({ data: [] })),
      rpc('employee_get_leave_requests', {
        p_company_id: member.companyId,
        p_employee_id: member.employeeId,
        p_session_token: tok,
      }).catch(() => ({ data: [] })),
    ])

    const punches = (punchRes.data as PunchLike[]) ?? []
    const opts = {
      employeeId: member.employeeId,
      employeeName: name,
      lateThresholdMinutes: lateMin,
      otStartAfterMinutes: otMin,
      shiftTemplate: template,
    }
    let built = buildPunchSessions(punches, opts)

    const absences = ((absRes.data as { date: string; reason?: string | null; note?: string | null }[]) ?? [])
    const leaveRows = ((leaveRes.data as { start_date: string; end_date: string; leave_type: string; status: string }[]) ?? [])
      .filter(l => (l.status ?? '').toLowerCase() === 'approved')
    const leaveDays: { date: string; leave_type: string }[] = []
    for (const l of leaveRows) {
      for (const d of eachDateInclusive(l.start_date, l.end_date)) {
        if (d >= fromDate && d <= toDate) leaveDays.push({ date: d, leave_type: l.leave_type })
      }
    }
    built = mergeNonWorkDays(built, absences, leaveDays, opts)
    setSessions(built)
    setLoading(false)
  }

  const totals = useMemo(() => {
    const reg = sessions.reduce((s, x) => s + x.regularHours, 0)
    const ot = sessions.reduce((s, x) => s + x.overtimeHours, 0)
    return { reg, ot, days: sessions.filter(s => !s.isAbsentDay && !s.isLeaveDay).length }
  }, [sessions])

  function rangeLabel(): [string, string] {
    const now = new Date()
    if (range === 'today') return [toDateStr(now), toDateStr(now)]
    if (range === 'week') return [toDateStr(new Date(now.getTime() - 7 * 86400000)), toDateStr(now)]
    if (range === 'month') return [toDateStr(new Date(now.getTime() - 30 * 86400000)), toDateStr(now)]
    return [customFrom || '—', customTo || toDateStr(now)]
  }

  if (allowed === null || (allowed && loading && sessions.length === 0 && range !== 'custom')) {
    // show loading shell when first load
  }
  if (allowed === false) return null
  if (allowed === null) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">Attendance</h1>
          <div className="flex gap-2">
            <button
              onClick={() => exportSessionsCSV(sessions)}
              title="Export Excel (CSV)"
              disabled={sessions.length === 0}
              className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
            >
              <span className="material-icons text-[16px]">table_chart</span>
            </button>
            <button
              onClick={() => { const [f, t] = rangeLabel(); printSessionsPDF(sessions, empName, f, t) }}
              title="Export PDF"
              disabled={sessions.length === 0}
              className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
            >
              <span className="material-icons text-[16px]">picture_as_pdf</span>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {([
            ['today', 'Today'],
            ['week', 'Week'],
            ['month', 'Month'],
            ['custom', 'Custom'],
          ] as [Range, string][]).map(([r, label]) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                range === r ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex gap-3 mt-3">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input text-[13px]" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input text-[13px]" />
          </div>
        )}
      </div>

      {!loading && sessions.length > 0 && (
        <div className="flex gap-6 px-4 py-3 bg-surface-elevated border-b border-divider shrink-0">
          <div>
            <p className="text-[11px] text-text-disabled uppercase font-semibold">Sessions</p>
            <p className="text-[18px] font-bold text-text-primary">{totals.days}</p>
          </div>
          <div>
            <p className="text-[11px] text-text-disabled uppercase font-semibold">Regular</p>
            <p className="text-[18px] font-bold text-text-primary">{totals.reg.toFixed(1)}h</p>
          </div>
          <div>
            <p className="text-[11px] text-text-disabled uppercase font-semibold">Overtime</p>
            <p className="text-[18px] font-bold text-text-primary">{totals.ot.toFixed(1)}h</p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Time In</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">In Location</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Time Out</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Out Location</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Total</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {sessions.map((s, i) => {
                  const kind = s.isAbsentDay ? 'absent' : s.isLeaveDay ? 'leave' : 'in'
                  const flag = [lateFlag(s), earlyFlag(s)].filter(Boolean).join(' · ')
                  return (
                    <tr key={`${s.clockIn.toISOString()}-${i}`} className="hover:bg-surface-elevated transition-colors">
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">{fmtSessionDate(s.clockIn)}</td>
                      <td className={`px-4 py-3 text-[13px] font-medium whitespace-nowrap ${
                        s.isAbsentDay ? 'text-error' : s.isLeaveDay ? 'text-warning' : s.isLate ? 'text-error' : 'text-success'
                      }`}>
                        {fmtSessionTime(s.clockIn, kind as 'in' | 'absent' | 'leave')}
                        {s.isOpen && !s.isAbsentDay && !s.isLeaveDay && (
                          <span className="ml-1 text-[10px] text-warning font-semibold">OPEN</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary max-w-[160px] truncate">
                        {s.isAbsentDay || s.isLeaveDay ? '—' : locationDisplay(s.clockInAddress, s.clockInLat, s.clockInLng)}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-text-primary whitespace-nowrap">
                        {fmtSessionTime(s.clockOut, 'out')}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary max-w-[160px] truncate">
                        {s.isAbsentDay || s.isLeaveDay ? '—' : locationDisplay(s.clockOutAddress, s.clockOutLat, s.clockOutLng)}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-text-primary whitespace-nowrap">
                        {totalHrsDisplay(s)}
                        {s.overtimeHours > 0 && (
                          <span className="block text-[10px] text-warning font-medium">OT {s.overtimeHours.toFixed(1)}h</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary">
                        {flag && <span className="text-error font-semibold">{flag}</span>}
                        {flag && (s.notes || s.statusNote) ? ' · ' : ''}
                        {s.notes ?? s.statusNote ?? (flag ? '' : '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
