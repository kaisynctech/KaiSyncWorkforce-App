/**
 * Client-side punch session builder — mirrors MAUI PunchSession.Build.
 * Pairs clock-in/out, computes regular/OT hours, late/early flags.
 */

export type PunchLike = {
  id?: string
  employee_id?: string
  type: 'in' | 'out' | string
  date_time: string
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  job_id?: string | null
  notes?: string | null
}

export type ShiftTemplateLike = {
  id: string
  start_time?: string | null // "HH:mm:ss" or "HH:mm"
  end_time?: string | null
  break_minutes?: number | null
  total_break_minutes?: number | null
}

export type PunchSessionOptions = {
  employeeId: string
  employeeName?: string
  dailyHours?: number
  lateThresholdMinutes?: number
  otStartAfterMinutes?: number
  shiftTemplate?: ShiftTemplateLike | null
}

export type PunchSessionRow = {
  employeeId: string
  employeeName: string
  clockIn: Date
  clockOut: Date | null
  jobId: string | null
  notes: string | null
  clockInAddress: string | null
  clockOutAddress: string | null
  clockInLat: number | null
  clockInLng: number | null
  clockOutLat: number | null
  clockOutLng: number | null
  isAbsentDay: boolean
  isLeaveDay: boolean
  statusNote: string | null
  regularHours: number
  overtimeHours: number
  isLate: boolean
  lateMinutes: number
  isLeftEarly: boolean
  earlyMinutes: number
  isOpen: boolean
}

function parseTimeOnly(raw: string | null | undefined): { h: number; m: number } | null {
  if (!raw) return null
  const m = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return { h: Number(m[1]), m: Number(m[2]) }
}

function atLocalTime(day: Date, t: { h: number; m: number }): Date {
  const d = new Date(day)
  d.setHours(t.h, t.m, 0, 0)
  return d
}

function paidHoursOf(template: ShiftTemplateLike): number {
  const start = parseTimeOnly(template.start_time)
  const end = parseTimeOnly(template.end_time)
  if (!start || !end) return 8
  let span = (end.h * 60 + end.m) - (start.h * 60 + start.m)
  if (span <= 0) span += 24 * 60
  const brk = Number(template.total_break_minutes ?? template.break_minutes ?? 0)
  return Math.max(0, span / 60 - brk / 60)
}

function breakMinutesOf(template: ShiftTemplateLike | null | undefined): number {
  if (!template) return 0
  return Number(template.total_break_minutes ?? template.break_minutes ?? 0)
}

function computeMetrics(
  clockIn: Date,
  clockOut: Date | null,
  opts: PunchSessionOptions,
): Pick<PunchSessionRow, 'regularHours' | 'overtimeHours' | 'isLate' | 'lateMinutes' | 'isLeftEarly' | 'earlyMinutes'> {
  const dailyHours = opts.dailyHours ?? 8
  const lateThreshold = opts.lateThresholdMinutes ?? 30
  const otAfter = opts.otStartAfterMinutes ?? 30
  const template = opts.shiftTemplate ?? null
  const now = new Date()
  const totalHours = ((clockOut ?? now).getTime() - clockIn.getTime()) / 3600000

  let isLate = false
  let lateMinutes = 0
  let isLeftEarly = false
  let earlyMinutes = 0
  let regularHours = 0
  let overtimeHours = 0

  const startT = template ? parseTimeOnly(template.start_time) : null
  const endT = template ? parseTimeOnly(template.end_time) : null

  if (template && startT) {
    const shiftStart = atLocalTime(clockIn, startT)
    const minsLate = (clockIn.getTime() - shiftStart.getTime()) / 60000
    if (minsLate > lateThreshold) {
      isLate = true
      lateMinutes = Math.floor(minsLate)
    }
  }

  if (template && endT && clockOut) {
    let shiftEnd = atLocalTime(clockOut, endT)
    const billingStart = isLate || !startT
      ? clockIn
      : atLocalTime(clockIn, startT)
    if (shiftEnd.getTime() < billingStart.getTime()) {
      shiftEnd = new Date(shiftEnd.getTime() + 24 * 3600000)
    }
    if (clockOut.getTime() < shiftEnd.getTime()) {
      isLeftEarly = true
      earlyMinutes = Math.floor((shiftEnd.getTime() - clockOut.getTime()) / 60000)
    }
  }

  if (!template) {
    regularHours = Math.min(totalHours, dailyHours)
    overtimeHours = Math.max(0, totalHours - dailyHours)
  } else if (startT) {
    const billingStart = isLate ? clockIn : atLocalTime(clockIn, startT)
    const brk = breakMinutesOf(template) / 60
    const paidCap = paidHoursOf(template)
    if (!clockOut) {
      regularHours = Math.max(0, (now.getTime() - billingStart.getTime()) / 3600000 - brk)
    } else {
      const paidElapsed = (clockOut.getTime() - billingStart.getTime()) / 3600000 - brk
      regularHours = Math.max(0, Math.min(paidElapsed, paidCap))
      if (endT) {
        let shiftEnd = atLocalTime(clockOut, endT)
        if (shiftEnd.getTime() < billingStart.getTime()) {
          shiftEnd = new Date(shiftEnd.getTime() + 24 * 3600000)
        }
        const minutesPastEnd = (clockOut.getTime() - shiftEnd.getTime()) / 60000
        overtimeHours = minutesPastEnd > otAfter ? (minutesPastEnd - otAfter) / 60 : 0
      }
    }
  }

  return {
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    isLate,
    lateMinutes,
    isLeftEarly,
    earlyMinutes,
  }
}

function makeSession(
  clockIn: PunchLike | null,
  clockOut: PunchLike | null,
  opts: PunchSessionOptions,
): PunchSessionRow {
  const inDt = new Date((clockIn ?? clockOut)!.date_time)
  const outDt = clockOut ? new Date(clockOut.date_time) : null
  const metrics = computeMetrics(inDt, outDt, opts)
  return {
    employeeId: opts.employeeId,
    employeeName: opts.employeeName ?? 'Employee',
    clockIn: inDt,
    clockOut: outDt,
    jobId: clockIn?.job_id ?? null,
    notes: clockOut?.notes ?? clockIn?.notes ?? null,
    clockInAddress: clockIn?.address ?? null,
    clockOutAddress: clockOut?.address ?? null,
    clockInLat: clockIn?.latitude ?? null,
    clockInLng: clockIn?.longitude ?? null,
    clockOutLat: clockOut?.latitude ?? null,
    clockOutLng: clockOut?.longitude ?? null,
    isAbsentDay: false,
    isLeaveDay: false,
    statusNote: null,
    ...metrics,
    isOpen: !outDt,
  }
}

/** Pair punches into sessions (MAUI PunchSession.Build). */
export function buildPunchSessions(
  punches: PunchLike[],
  opts: PunchSessionOptions,
): PunchSessionRow[] {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime(),
  )
  const sessions: PunchSessionRow[] = []
  let clockIn: PunchLike | null = null

  for (const punch of sorted) {
    const type = (punch.type ?? '').toLowerCase()
    if (type === 'in') {
      if (clockIn) sessions.push(makeSession(clockIn, null, opts))
      clockIn = punch
    } else if (clockIn) {
      sessions.push(makeSession(clockIn, punch, opts))
      clockIn = null
    } else {
      sessions.push(makeSession(null, punch, opts))
    }
  }
  if (clockIn) sessions.push(makeSession(clockIn, null, opts))

  return sessions.sort((a, b) => b.clockIn.getTime() - a.clockIn.getTime())
}

export function absentDaySession(
  dateStr: string,
  reason: string,
  opts: PunchSessionOptions,
): PunchSessionRow {
  const d = new Date(`${dateStr}T00:00:00`)
  return {
    employeeId: opts.employeeId,
    employeeName: opts.employeeName ?? 'Employee',
    clockIn: d,
    clockOut: d,
    jobId: null,
    notes: reason,
    clockInAddress: null,
    clockOutAddress: null,
    clockInLat: null,
    clockInLng: null,
    clockOutLat: null,
    clockOutLng: null,
    isAbsentDay: true,
    isLeaveDay: false,
    statusNote: reason,
    regularHours: 0,
    overtimeHours: 0,
    isLate: false,
    lateMinutes: 0,
    isLeftEarly: false,
    earlyMinutes: 0,
    isOpen: false,
  }
}

export function leaveDaySession(
  dateStr: string,
  leaveType: string,
  opts: PunchSessionOptions,
): PunchSessionRow {
  const d = new Date(`${dateStr}T00:00:00`)
  return {
    employeeId: opts.employeeId,
    employeeName: opts.employeeName ?? 'Employee',
    clockIn: d,
    clockOut: d,
    jobId: null,
    notes: leaveType,
    clockInAddress: null,
    clockOutAddress: null,
    clockInLat: null,
    clockInLng: null,
    clockOutLat: null,
    clockOutLng: null,
    isAbsentDay: false,
    isLeaveDay: true,
    statusNote: leaveType,
    regularHours: 0,
    overtimeHours: 0,
    isLate: false,
    lateMinutes: 0,
    isLeftEarly: false,
    earlyMinutes: 0,
    isOpen: false,
  }
}

/** Merge absence/leave days into sessions for dates without punch sessions. */
export function mergeNonWorkDays(
  sessions: PunchSessionRow[],
  absences: { date: string; reason?: string | null; note?: string | null }[],
  leaveDays: { date: string; leave_type: string }[],
  opts: PunchSessionOptions,
): PunchSessionRow[] {
  const workDates = new Set(
    sessions
      .filter(s => !s.isAbsentDay && !s.isLeaveDay)
      .map(s => toLocalDateStr(s.clockIn)),
  )
  const extra: PunchSessionRow[] = []
  for (const a of absences) {
    if (workDates.has(a.date)) continue
    const note = [a.reason, a.note].filter(Boolean).join(' – ') || 'Absent'
    extra.push(absentDaySession(a.date, note, opts))
    workDates.add(a.date)
  }
  for (const l of leaveDays) {
    if (workDates.has(l.date)) continue
    extra.push(leaveDaySession(l.date, l.leave_type || 'Leave', opts))
    workDates.add(l.date)
  }
  return [...sessions, ...extra].sort((a, b) => b.clockIn.getTime() - a.clockIn.getTime())
}

export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fmtSessionTime(d: Date | null, kind: 'in' | 'out' | 'absent' | 'leave'): string {
  if (kind === 'absent') return 'Absent'
  if (kind === 'leave') return 'On Leave'
  if (!d) return '—'
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function fmtSessionDate(d: Date): string {
  return d.toLocaleDateString('en-ZA', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function lateFlag(s: PunchSessionRow): string {
  if (!s.isLate) return ''
  const h = Math.floor(s.lateMinutes / 60)
  const m = s.lateMinutes % 60
  const parts = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
  return `Late ${parts}`
}

export function earlyFlag(s: PunchSessionRow): string {
  if (!s.isLeftEarly) return ''
  const h = Math.floor(s.earlyMinutes / 60)
  const m = s.earlyMinutes % 60
  const parts = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
  return `Left Early ${parts}`
}

export function totalHrsDisplay(s: PunchSessionRow): string {
  if (s.isAbsentDay || s.isLeaveDay) return '0.0h'
  return `${(s.regularHours + s.overtimeHours).toFixed(1)}h`
}

export function locationDisplay(address: string | null, lat: number | null, lng: number | null): string {
  if (address) return address
  if (lat != null && lng != null) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  return '—'
}
