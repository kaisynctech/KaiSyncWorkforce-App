'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadScopedEmployeeIds } from '@/lib/employee-scope'
import { SHIFT_TEMPLATE_SELECT } from '@/lib/shift-template-schedule'
import {
  buildPunchSessions,
  earlyFlag,
  fmtSessionDate,
  fmtSessionOut, fmtSessionTime,
  lateFlag,
  locationDisplay,
  mergeNonWorkDays,
  toLocalDateStr,
  totalHrsDisplay,
  type PunchLike,
  type PunchSessionRow,
  type ShiftTemplateLike,
} from '@/lib/punch-session'
import { ManualTimesheetForm } from '@/components/attendance/ManualTimesheetForm'
import {
  CorrectAttendanceForm,
  type CorrectAttendancePrefill,
} from '@/components/attendance/CorrectAttendanceForm'
import { AttendanceNote } from '@/components/attendance/AttendanceNote'
import { enrichSessionsWithPlaceNames } from '@/lib/punch-address-enrich'
import { resumeSameDayShift } from '@/lib/resume-shift'
import { returnToWorkLabel, localISODate } from '@/lib/utils'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { StatusFilterTabs, MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import {
  ResetFiltersButton,
  TextHeaderFilter,
  matchText,
} from '@/components/ui/MoneyListFilters'
import type { TimePunch } from '@/types/database'

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom'
type AttendanceView = 'attendance' | 'timesheet'

type EmpRow = {
  id: string
  name: string
  surname: string
  employee_number: string | null
  hourly_rate: number | null
  daily_hours: number | null
  shift_template_id: string | null
  pay_full_monthly_salary?: boolean | null
}

type DisplaySession = {
  key: string
  employeeId: string
  employeeName: string
  employeeCode: string
  row: PunchSessionRow
  pay: number
}

type OnLeaveTodayRow = {
  employee_id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string } | null
}

function returnDate(endDate: string) {
  return returnToWorkLabel(endDate)
}

function focusDayForRange(from: string, to: string, timeZone: string): string {
  if (from === to) return from
  const today = toLocalDateStr(new Date(), timeZone)
  if (today >= from && today <= to) return today
  return to
}

const todayStr = () => localISODate()

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return out
  while (cur <= end) {
    out.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function getRange(
  preset: Preset,
  customFrom: string,
  customTo: string
): { from: string; to: string } {
  const t = todayStr()
  if (preset === 'today') return { from: t, to: t }
  if (preset === 'week') {
    const d = new Date()
    const mon = new Date(d)
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return { from: mon.toISOString().split('T')[0], to: t }
  }
  if (preset === 'month') {
    const d = new Date()
    return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: t }
  }
  if (preset === 'all') return { from: '2020-01-01', to: t }
  return { from: customFrom, to: customTo }
}

function toDisplay(row: PunchSessionRow, emp: EmpRow | undefined): DisplaySession {
  const hours = row.regularHours + row.overtimeHours
  const rate = emp?.hourly_rate ?? 0
  return {
    key: `${row.employeeId}_${row.clockIn.toISOString()}`,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeCode: emp?.employee_number ?? '',
    row,
    pay: hours * rate,
  }
}

function exportCSV(sessions: DisplaySession[], from: string, to: string) {
  const header = 'Employee,Code,Date,Time In,In Location,Time Out,Out Location,Reg hrs,OT hrs,Total hrs,Notes,Pay'
  const rows = sessions.map(s => {
    const r = s.row
    const kind = r.isAbsentDay ? 'absent' : r.isLeaveDay ? 'leave' : 'in'
    const notes = [lateFlag(r), earlyFlag(r), r.notes ?? r.statusNote ?? ''].filter(Boolean).join('; ')
    return [
      `"${s.employeeName.replace(/"/g, '""')}"`,
      s.employeeCode,
      fmtSessionDate(r.clockIn),
      fmtSessionTime(r.clockIn, kind as 'in' | 'absent' | 'leave'),
      `"${locationDisplay(r.clockInAddress, r.clockInLat, r.clockInLng, r.notes).replace(/"/g, '""')}"`,
      fmtSessionOut(r),
      `"${locationDisplay(r.clockOutAddress, r.clockOutLat, r.clockOutLng, r.notes).replace(/"/g, '""')}"`,
      r.regularHours.toFixed(2),
      r.overtimeHours.toFixed(2),
      totalHrsDisplay(r),
      `"${notes.replace(/"/g, '""')}"`,
      s.pay.toFixed(2),
    ].join(',')
  })
  const csv  = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `attendance_${from}_to_${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportPDF(sessions: DisplaySession[], from: string, to: string) {
  const rows = sessions.map(s => {
    const r = s.row
    const kind = r.isAbsentDay ? 'absent' : r.isLeaveDay ? 'leave' : 'in'
    const notes = [lateFlag(r), earlyFlag(r), r.notes ?? r.statusNote ?? ''].filter(Boolean).join('; ')
    return `<tr>
      <td>${s.employeeName.replace(/</g, '&lt;')}</td>
      <td>${fmtSessionDate(r.clockIn)}</td>
      <td>${fmtSessionTime(r.clockIn, kind as 'in' | 'absent' | 'leave')}</td>
      <td>${locationDisplay(r.clockInAddress, r.clockInLat, r.clockInLng, r.notes).replace(/</g, '&lt;')}</td>
      <td>${fmtSessionOut(r)}</td>
      <td>${locationDisplay(r.clockOutAddress, r.clockOutLat, r.clockOutLng, r.notes).replace(/</g, '&lt;')}</td>
      <td>${totalHrsDisplay(r)}</td>
      <td>${notes.replace(/</g, '&lt;') || '—'}</td>
    </tr>`
  }).join('')
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head><title>Attendance Report</title><style>
    body{font-family:sans-serif;font-size:11px;padding:20px}
    h2{font-size:16px;margin-bottom:4px}
    p{margin:2px 0 12px;color:#555}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ddd;padding:5px 6px;text-align:left}
    th{background:#f5f5f5;font-weight:600}
    @media print{button{display:none}}
  </style></head><body>
    <h2>Attendance Report</h2>
    <p>Period: ${from} to ${to}</p>
    <table>
      <thead><tr>
        <th>Employee</th><th>Date</th><th>Time In</th><th>In Location</th>
        <th>Time Out</th><th>Out Location</th><th>Total hrs</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <br><button onclick="window.print()">Print / Save PDF</button>
  </body></html>`)
  w.document.close()
}

const PRESET_TABS = [
  { id: 'today', label: 'Today', match: null, idle: 'border-blue-200 text-blue-700 hover:bg-blue-50', active: 'bg-blue-600 text-white border-blue-600' },
  { id: 'week', label: 'This Week', match: null, idle: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50', active: 'bg-indigo-600 text-white border-indigo-600' },
  { id: 'month', label: 'This Month', match: null, idle: 'border-slate-200 text-slate-700 hover:bg-slate-50', active: 'bg-slate-700 text-white border-slate-700' },
  { id: 'all', label: 'All', match: null, idle: 'border-gray-200 text-gray-600 hover:bg-gray-50', active: 'bg-gray-500 text-white border-gray-500' },
  { id: 'custom', label: 'Custom', match: null, idle: 'border-amber-200 text-amber-700 hover:bg-amber-50', active: 'bg-amber-500 text-white border-amber-500' },
]

export default function AttendancePage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<DisplaySession[]>([])
  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState(todayStr())
  const [customTo, setCustomTo] = useState(todayStr())
  const [search, setSearch] = useState('')
  const [employeeCol, setEmployeeCol] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staff, setStaff] = useState<EmpRow[]>([])
  const [onLeaveToday, setOnLeaveToday] = useState<OnLeaveTodayRow[]>([])
  const [showOnLeave, setShowOnLeave] = useState(true)
  const [view, setView] = useState<AttendanceView>('attendance')
  const [timeZone, setTimeZone] = useState('Africa/Johannesburg')
  const [resumeBusy, setResumeBusy] = useState<string | null>(null)
  const [correctPrefill, setCorrectPrefill] = useState<CorrectAttendancePrefill | null>(null)

  function openCorrect(session: DisplaySession) {
    const day = toLocalDateStr(session.row.clockIn, timeZone)
    const pad = (n: number) => String(n).padStart(2, '0')
    const asTime = (d: Date | null) => {
      if (!d) return ''
      // Prefer company-local wall clock for the form.
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d)
      const hh = parts.find(p => p.type === 'hour')?.value ?? pad(d.getHours())
      const mm = parts.find(p => p.type === 'minute')?.value ?? pad(d.getMinutes())
      return `${hh}:${mm}`
    }
    setCorrectPrefill({
      employeeId: session.employeeId,
      workDate: day,
      timeIn: session.row.isAbsentDay || session.row.isLeaveDay ? '' : asTime(session.row.clockIn),
      timeOut: session.row.clockOut ? asTime(session.row.clockOut) : '',
    })
    setView('timesheet')
  }

  const companyIdRef = useRef<string | null>(null)
  const scopedIdsRef = useRef<Set<string> | null>(null)
  const presetRef = useRef<Preset>('today')
  const customFromRef = useRef(todayStr())
  const customToRef = useRef(todayStr())

  presetRef.current = preset
  customFromRef.current = customFrom
  customToRef.current = customTo

  useEffect(() => { void init() }, [])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const scopeRes = await loadScopedEmployeeIds(supabase, member.companyId, member.employeeId)
    if (!scopeRes.ok) { setError(scopeRes.message); setLoading(false); return }
    scopedIdsRef.current = scopeRes.seesAll ? null : scopeRes.ids

    companyIdRef.current = member.companyId
    setCompanyId(member.companyId)
    await fetchPunchesWithParams(member.companyId)
  }

  useEffect(() => {
    if (companyId) void fetchPunches()
  }, [preset, customFrom, customTo])

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel('attendance-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_punches',
          filter: `company_id=eq.${companyId}`,
        },
        () => { void fetchPunches() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyId])

  function fetchPunches() {
    if (!companyIdRef.current) return
    void fetchPunchesWithParams(companyIdRef.current)
  }

  async function fetchPunchesWithParams(cid: string) {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { from, to } = getRange(presetRef.current, customFromRef.current, customToRef.current)

    const [
      empRes,
      punchRes,
      tmplRes,
      companyRes,
      settingsRes,
      leaveRes,
      absenceRes,
      onLeaveTodayRes,
    ] = await Promise.all([
      supabase.from('employees')
        .select('id, name, surname, employee_number, hourly_rate, daily_hours, shift_template_id, pay_full_monthly_salary')
        .eq('company_id', cid)
        .eq('is_active', true),
      supabase.from('time_punches')
        .select('id, employee_id, type, date_time, created_at, latitude, longitude, address, job_id, notes')
        .eq('company_id', cid)
        .gte('date_time', `${from}T00:00:00`)
        .lte('date_time', `${to}T23:59:59`)
        .order('date_time', { ascending: true }),
      supabase.from('employee_shift_templates')
        .select(SHIFT_TEMPLATE_SELECT)
        .eq('company_id', cid),
      supabase.from('companies')
        .select('custom_settings')
        .eq('id', cid)
        .maybeSingle(),
      supabase.rpc('get_company_settings', { p_company_id: cid }),
      supabase.from('leave_requests')
        .select('employee_id, start_date, end_date, leave_type, status')
        .eq('company_id', cid)
        .eq('status', 'approved')
        .lte('start_date', to)
        .gte('end_date', from),
      supabase.from('daily_absences')
        .select('employee_id, date, reason, note')
        .eq('company_id', cid)
        .gte('date', from)
        .lte('date', to),
      supabase.from('leave_requests')
        .select('employee_id, leave_type, end_date, employees(name, surname)')
        .eq('company_id', cid)
        .eq('status', 'approved')
        .lte('start_date', todayStr())
        .gte('end_date', todayStr()),
    ])

    const firstErr =
      empRes.error?.message ||
      punchRes.error?.message ||
      tmplRes.error?.message ||
      companyRes.error?.message ||
      settingsRes.error?.message ||
      leaveRes.error?.message ||
      absenceRes.error?.message ||
      onLeaveTodayRes.error?.message
    if (firstErr) {
      setError(firstErr)
      setSessions([])
      setOnLeaveToday([])
      setLoading(false)
      return
    }

    const empData = empRes.data
    const punchData = punchRes.data
    const tmplData = tmplRes.data
    const companyRow = companyRes.data
    const coSettings = settingsRes.data

    const cs = (companyRow?.custom_settings ?? {}) as Record<string, unknown>
    const lateMin = Number(cs.late_threshold_minutes ?? 30) || 30
    const otMin = Number(cs.ot_start_after_minutes ?? 30) || 30
    const tzRaw = (coSettings as { timezone?: string } | null)?.timezone
    const timeZone =
      typeof tzRaw === 'string' && tzRaw.trim() ? tzRaw.trim() : 'Africa/Johannesburg'
    setTimeZone(timeZone)

    const scope = scopedIdsRef.current
    const leaveRows = (onLeaveTodayRes.data ?? []) as unknown as OnLeaveTodayRow[]
    setOnLeaveToday(scope ? leaveRows.filter(r => scope.has(r.employee_id)) : leaveRows)
    const visibleStaff = (empData ?? [])
      .filter(e => !scope || scope.has(e.id))
      .map(e => e as EmpRow)
      .sort((a, b) => `${a.name} ${a.surname}`.localeCompare(`${b.name} ${b.surname}`))
    setStaff(visibleStaff)
    const empMap = new Map(visibleStaff.map(e => [e.id, e]))
    const tmplMap = new Map(
      ((tmplData ?? []) as ShiftTemplateLike[]).map(t => [t.id, t]),
    )

    const punchesByEmp = new Map<string, PunchLike[]>()
    for (const p of (punchData ?? []) as TimePunch[]) {
      if (!p.date_time) continue
      if (scope && !scope.has(p.employee_id)) continue
      const list = punchesByEmp.get(p.employee_id) ?? []
      list.push(p as PunchLike)
      punchesByEmp.set(p.employee_id, list)
    }

    const leaveByEmp = new Map<string, { date: string; leave_type: string }[]>()
    for (const l of (leaveRes.data ?? []) as {
      employee_id: string
      start_date: string
      end_date: string
      leave_type: string
    }[]) {
      if (scope && !scope.has(l.employee_id)) continue
      const days = leaveByEmp.get(l.employee_id) ?? []
      for (const d of eachDateInclusive(l.start_date, l.end_date)) {
        if (d >= from && d <= to) days.push({ date: d, leave_type: l.leave_type })
      }
      leaveByEmp.set(l.employee_id, days)
    }

    const absencesByEmp = new Map<string, { date: string; reason?: string | null; note?: string | null }[]>()
    for (const a of (absenceRes.data ?? []) as {
      employee_id: string
      date: string
      reason?: string | null
      note?: string | null
    }[]) {
      if (scope && !scope.has(a.employee_id)) continue
      const list = absencesByEmp.get(a.employee_id) ?? []
      list.push({ date: a.date, reason: a.reason, note: a.note })
      absencesByEmp.set(a.employee_id, list)
    }

    const built: DisplaySession[] = []
    const employeeIds = new Set([...empMap.keys(), ...punchesByEmp.keys(), ...leaveByEmp.keys(), ...absencesByEmp.keys()])
    for (const empId of employeeIds) {
      const emp = empMap.get(empId)
      const template = emp?.shift_template_id
        ? tmplMap.get(emp.shift_template_id) ?? null
        : null
      const opts = {
        employeeId: empId,
        employeeName: emp ? `${emp.name} ${emp.surname}` : 'Unknown',
        dailyHours: emp?.daily_hours ?? 8,
        lateThresholdMinutes: lateMin,
        otStartAfterMinutes: otMin,
        shiftTemplate: template,
        timeZone,
      }
      let rows = buildPunchSessions(punchesByEmp.get(empId) ?? [], opts)
      rows = mergeNonWorkDays(
        rows,
        absencesByEmp.get(empId) ?? [],
        leaveByEmp.get(empId) ?? [],
        opts,
      )
      for (const row of rows) built.push(toDisplay(row, emp))
    }

    built.sort((a, b) => b.row.clockIn.getTime() - a.row.clockIn.getTime())
    setSessions(built)
    setLoading(false)

    // Background: turn GPS-only punches into real place names and persist.
    void (async () => {
      const enrichedRows = await enrichSessionsWithPlaceNames(
        supabase,
        cid,
        built.map(b => b.row),
        null,
      )
      const changed = enrichedRows.some((row, i) =>
        row.clockInAddress !== built[i].row.clockInAddress
        || row.clockOutAddress !== built[i].row.clockOutAddress,
      )
      if (!changed) return
      setSessions(built.map((b, i) => ({
        ...b,
        row: enrichedRows[i],
      })))
    })()
  }

  const { from, to } = getRange(preset, customFrom, customTo)

  const filtered = sessions.filter(s => {
    if (search) {
      if (!matchText(s.employeeName, search) && !matchText(s.employeeCode, search)) return false
    }
    if (!matchText(s.employeeName, employeeCol) && !matchText(s.employeeCode, employeeCol)) return false
    return true
  })
  const searchFiltersActive = !!(search || employeeCol)

  const onSite = sessions.filter(s => s.row.isOpen && !s.row.isAbsentDay && !s.row.isLeaveDay).length
  const completed = sessions.filter(s => !s.row.isOpen && !s.row.isAbsentDay && !s.row.isLeaveDay).length
  const focusDay = focusDayForRange(from, to, timeZone)
  const presentOnFocus = new Set<string>()
  const excusedOnFocus = new Set<string>()
  for (const s of sessions) {
    const day = toLocalDateStr(s.row.clockIn, timeZone)
    if (day !== focusDay) continue
    if (s.row.isLeaveDay || s.row.isAbsentDay) excusedOnFocus.add(s.employeeId)
    else if (s.row.clockInPunchId) presentOnFocus.add(s.employeeId)
  }
  const missedClockIn = staff.filter(e => !e.pay_full_monthly_salary && !presentOnFocus.has(e.id) && !excusedOnFocus.has(e.id)).length
  const continueKeys = new Set<string>()
  const byEmpDay = new Map<string, DisplaySession[]>()
  for (const s of sessions) {
    if (s.row.isLeaveDay || s.row.isAbsentDay || !s.row.clockInPunchId) continue
    const day = toLocalDateStr(s.row.clockIn, timeZone)
    const list = byEmpDay.get(`${s.employeeId}|${day}`) ?? []
    list.push(s)
    byEmpDay.set(`${s.employeeId}|${day}`, list)
  }
  for (const list of byEmpDay.values()) {
    if (!list.some(s => s.row.isOpen) || !list.some(s => s.row.clockOut)) continue
    const openRow = list.find(s => s.row.isOpen)
    if (openRow) continueKeys.add(openRow.key)
  }

  async function continueShift(employeeId: string) {
    if (!companyId) return
    setResumeBusy(employeeId)
    setError(null)
    const result = await resumeSameDayShift(createClient(), { companyId, employeeId })
    setResumeBusy(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    fetchPunches()
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
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Attendance</h1>
          <div className="flex gap-1 mt-2">
            <StatusFilterTabs
              tabs={[
                { id: 'attendance', label: 'Attendance', match: null, idle: 'border-blue-200 text-blue-700 hover:bg-blue-50', active: 'bg-blue-600 text-white border-blue-600' },
                { id: 'timesheet', label: 'Timesheet', match: null, idle: 'border-slate-200 text-slate-700 hover:bg-slate-50', active: 'bg-slate-700 text-white border-slate-700' },
              ]}
              value={view}
              counts={{}}
              onChange={id => setView(id as AttendanceView)}
            />
          </div>
        </div>
        {view === 'attendance' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => exportCSV(filtered, from, to)}
              className="h-8 px-2.5 text-[12px] font-medium rounded-md border border-border bg-surface text-text-primary hover:bg-background transition-colors"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportPDF(filtered, from, to)}
              className="h-8 px-2.5 text-[12px] font-medium rounded-md border border-border bg-surface text-text-primary hover:bg-background transition-colors"
            >
              Export PDF
            </button>
          </div>
        )}
      </div>

      {error && error !== 'not_linked' && (
        <p className="mb-4 text-error text-[13px]">{error}</p>
      )}

      {view === 'timesheet' && companyId && (
        <div className="space-y-3 mb-4">
          <ManualTimesheetForm
            companyId={companyId}
            employees={staff}
            onSaved={date => {
              setView('attendance')
              if (preset === 'custom' && customFrom === date && customTo === date) fetchPunches()
              else {
                setPreset('custom')
                setCustomFrom(date)
                setCustomTo(date)
              }
            }}
          />
          <CorrectAttendanceForm
            companyId={companyId}
            employees={staff}
            prefill={correctPrefill}
            onSaved={date => {
              setCorrectPrefill(null)
              setView('attendance')
              if (preset === 'custom' && customFrom === date && customTo === date) fetchPunches()
              else {
                setPreset('custom')
                setCustomFrom(date)
                setCustomTo(date)
              }
            }}
          />
        </div>
      )}

      {view === 'attendance' && onLeaveToday.length > 0 && (
        <div className="mb-4 bg-surface border border-divider rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowOnLeave(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-background transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="material-icons text-[18px] text-warning">event_busy</span>
              <span className="text-[13px] font-medium text-text-primary">
                On Leave Today ({onLeaveToday.length})
              </span>
            </div>
            <span className="material-icons text-[18px] text-text-secondary">
              {showOnLeave ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {showOnLeave && (
            <div className="border-t border-divider divide-y divide-divider">
              {onLeaveToday.map(r => (
                <div key={`${r.employee_id}-${r.end_date}-${r.leave_type}`} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-[13px] font-medium text-text-primary">
                      {r.employees ? `${r.employees.name} ${r.employees.surname}` : 'Unknown'}
                    </span>
                    <span className="text-[12px] text-text-secondary ml-2">
                      — {r.leave_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span className="text-[11px] text-text-secondary">
                    back {returnDate(r.end_date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'attendance' && (
      <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <StatusFilterTabs
          tabs={PRESET_TABS}
          value={preset}
          counts={{}}
          onChange={id => setPreset(id as Preset)}
        />
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 px-2 bg-surface border border-border rounded-md text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-text-secondary text-[12px]">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 px-2 bg-surface border border-border rounded-md text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <div className="bg-surface rounded-lg border border-divider px-3 py-2">
          <p className="text-[18px] font-bold text-primary tabular-nums">{onSite}</p>
          <p className="text-[11px] text-text-secondary">Currently on site</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider px-3 py-2">
          <p className="text-[18px] font-bold text-success tabular-nums">{completed}</p>
          <p className="text-[11px] text-text-secondary">Completed shifts</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider px-3 py-2">
          <p className="text-[18px] font-bold text-text-primary tabular-nums">{missedClockIn}</p>
          <p className="text-[11px] text-text-secondary">Didn&apos;t clock in</p>
          <p className="text-[10px] text-text-disabled mt-0.5">{fmtSessionDate(new Date(`${focusDay}T12:00:00`))}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px] max-w-sm">
          <span className="material-icons text-text-disabled text-[16px]">search</span>
          <input
            type="search"
            placeholder="Filter by name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
          />
        </div>
        <ResetFiltersButton
          disabled={!searchFiltersActive}
          onReset={() => { setSearch(''); setEmployeeCol('') }}
        />
      </div>

      <div className="bg-surface rounded-lg border border-divider overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-[12px] text-text-disabled">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-icons text-[40px] text-text-disabled block mb-2">schedule</span>
            <p className="text-[13px] text-text-secondary">No attendance records for this period</p>
          </div>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full" style={{ minWidth: 760 }}>
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter
                        label="Employee"
                        value={employeeCol}
                        onChange={setEmployeeCol}
                        placeholder="Name or code…"
                      />
                    </th>
                    <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Date</th>
                    <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Time In</th>
                    <th className={`${MONEY_TH} text-left`}>In Location</th>
                    <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Time Out</th>
                    <th className={`${MONEY_TH} text-left`}>Out Location</th>
                    <th style={{ width: 56 }} className={`${MONEY_TH} text-right`}>Reg</th>
                    <th style={{ width: 56 }} className={`${MONEY_TH} text-right`}>OT</th>
                    <th style={{ width: 64 }} className={`${MONEY_TH} text-right`}>Total</th>
                    <th style={{ width: 80 }} className={`${MONEY_TH} text-right`}>Pay</th>
                    <th style={{ width: 120 }} className={`${MONEY_TH} text-left`}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => {
                    const r = s.row
                    const kind = r.isAbsentDay ? 'absent' : r.isLeaveDay ? 'leave' : 'in'
                    const late = lateFlag(r)
                    const early = earlyFlag(r)
                    const notes = [late, early, r.notes ?? r.statusNote ?? ''].filter(Boolean).join(' · ')
                    return (
                      <tr key={s.key} className="border-b border-divider last:border-0 hover:bg-background transition-colors">
                        <td className={MONEY_TD}>
                          <Link
                            href={`/dashboard/employees/${s.employeeId}?tab=attendance&from=${from}&to=${to}`}
                            className="font-medium text-text-primary hover:text-primary hover:underline whitespace-nowrap"
                          >
                            {s.employeeName}
                          </Link>
                          {s.employeeCode && (
                            <p className="text-[11px] text-text-secondary font-mono">{s.employeeCode}</p>
                          )}
                          {continueKeys.has(s.key) && (
                            <button
                              type="button"
                              disabled={resumeBusy === s.employeeId}
                              onClick={() => void continueShift(s.employeeId)}
                              className="mt-0.5 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                            >
                              {resumeBusy === s.employeeId ? 'Continuing…' : 'Continue first shift'}
                            </button>
                          )}
                          {!s.row.isLeaveDay && (
                            <button
                              type="button"
                              onClick={() => openCorrect(s)}
                              className="mt-0.5 block text-[11px] font-medium text-primary hover:underline"
                            >
                              Correct
                            </button>
                          )}
                        </td>
                        <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{fmtSessionDate(r.clockIn)}</td>
                        <td className={`${MONEY_TD} font-medium whitespace-nowrap ${
                          r.isAbsentDay ? 'text-error' : r.isLeaveDay ? 'text-warning' : r.isLate ? 'text-error' : 'text-success'
                        }`}>
                          {fmtSessionTime(r.clockIn, kind as 'in' | 'absent' | 'leave')}
                          {r.isOpen && !r.isAbsentDay && !r.isLeaveDay && (
                            <span className="ml-1 text-[10px] text-warning font-semibold">OPEN</span>
                          )}
                          {late && <span className="block text-[10px] text-error font-semibold">{late}</span>}
                        </td>
                        <td className={`${MONEY_TD} text-text-secondary max-w-[160px] truncate`}>
                          {r.isAbsentDay || r.isLeaveDay
                            ? '—'
                            : locationDisplay(r.clockInAddress, r.clockInLat, r.clockInLng, r.notes)}
                        </td>
                        <td className={`${MONEY_TD} text-text-primary whitespace-nowrap`}>
                          {fmtSessionOut(r)}
                          {early && <span className="block text-[10px] text-warning font-semibold">{early}</span>}
                        </td>
                        <td className={`${MONEY_TD} text-text-secondary max-w-[160px] truncate`}>
                          {r.isAbsentDay || r.isLeaveDay
                            ? '—'
                            : locationDisplay(r.clockOutAddress, r.clockOutLat, r.clockOutLng, r.notes)}
                        </td>
                        <td className={`${MONEY_TD} text-right text-text-primary tabular-nums`}>{r.regularHours.toFixed(1)}</td>
                        <td className={`${MONEY_TD} text-right text-warning font-medium tabular-nums`}>
                          {r.overtimeHours > 0 ? r.overtimeHours.toFixed(1) : '—'}
                        </td>
                        <td className={`${MONEY_TD} text-right font-semibold text-text-primary tabular-nums`}>{totalHrsDisplay(r)}</td>
                        <td className={`${MONEY_TD} text-right text-text-primary tabular-nums`}>
                          {s.pay > 0 ? `R${s.pay.toFixed(2)}` : '—'}
                        </td>
                        <td className={MONEY_TD}>
                          <AttendanceNote
                            note={notes}
                            context={`${s.employeeName} · ${fmtSessionDate(r.clockIn)}`}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            }
            mobile={
              <>
                {filtered.map(s => {
                  const r = s.row
                  const kind = r.isAbsentDay ? 'absent' : r.isLeaveDay ? 'leave' : 'in'
                  const late = lateFlag(r)
                  const early = earlyFlag(r)
                  const notes = [late, early, r.notes ?? r.statusNote ?? ''].filter(Boolean).join(' · ')
                  return (
                    <DataCard key={s.key}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>
                            <Link href={`/dashboard/employees/${s.employeeId}?tab=attendance&from=${from}&to=${to}`} className="hover:text-primary hover:underline">
                              {s.employeeName}
                            </Link>
                          </DataCardTitle>
                          <DataCardMeta>
                            {fmtSessionDate(r.clockIn)}
                            {s.employeeCode ? ` · ${s.employeeCode}` : ''}
                          </DataCardMeta>
                          {continueKeys.has(s.key) && (
                            <button
                              type="button"
                              disabled={resumeBusy === s.employeeId}
                              onClick={() => void continueShift(s.employeeId)}
                              className="mt-1 text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
                            >
                              {resumeBusy === s.employeeId ? 'Continuing…' : 'Continue first shift'}
                            </button>
                          )}
                          {!s.row.isLeaveDay && (
                            <button
                              type="button"
                              onClick={() => openCorrect(s)}
                              className="mt-1 block text-[12px] font-medium text-primary hover:underline"
                            >
                              Correct
                            </button>
                          )}
                        </div>
                        <span className={`text-[12px] font-semibold shrink-0 ${
                          r.isAbsentDay ? 'text-error' : r.isLeaveDay ? 'text-warning' : 'text-success'
                        }`}>
                          {fmtSessionTime(r.clockIn, kind as 'in' | 'absent' | 'leave')}
                          {r.isOpen && !r.isAbsentDay && !r.isLeaveDay ? ' · OPEN' : ''}
                        </span>
                      </div>
                      <DataCardRow label="Out" value={fmtSessionOut(r)} />
                      <DataCardRow label="Hours" value={totalHrsDisplay(r)} />
                      <DataCardRow label="Pay" value={s.pay > 0 ? `R${s.pay.toFixed(2)}` : '—'} />
                      {notes ? (
                        <AttendanceNote
                          note={notes}
                          context={`${s.employeeName} · ${fmtSessionDate(r.clockIn)}`}
                        />
                      ) : null}
                    </DataCard>
                  )
                })}
              </>
            }
          />
        )}
      </div>
      </>
      )}
    </div>
  )
}
