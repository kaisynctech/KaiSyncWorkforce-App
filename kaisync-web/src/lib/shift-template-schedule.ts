/** Time-template weekday, Saturday, Sunday, and overtime clock fields. */

const SHIFT_TEMPLATE_CLOCK_COLUMNS =
  'start_time, end_time, break_minutes, weekend_start_time, weekend_end_time, ot_start_time, weekend_ot_start_time, early_ot_start_time, weekend_early_ot_start_time, sunday_start_time, sunday_end_time, sunday_ot_start_time, sunday_early_ot_start_time' as const

export const SHIFT_TEMPLATE_SELECT = `id, ${SHIFT_TEMPLATE_CLOCK_COLUMNS}` as const
export const SHIFT_TEMPLATE_NAMED_SELECT = `id, name, ${SHIFT_TEMPLATE_CLOCK_COLUMNS}` as const

export type DayScheduleInput = {
  enabled: boolean
  start: string
  end: string
  otStart: string
  earlyOtStart: string
}

export type TemplateScheduleInput = {
  startTime: string
  otStart: string
  earlyOtStart: string
  saturday: DayScheduleInput
  sunday: DayScheduleInput
}

export type SavedDayClocks = {
  start: string | null
  end: string | null
  otStart: string | null
  earlyOtStart: string | null
}

function toTimeSql(t: string): string | null {
  const trimmed = t.trim()
  if (!trimmed) return null
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed
}

function clockMinutes(t: string): number | null {
  const match = t.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function earlierThan(early: string, start: string, label: string): string | null {
  if (!early.trim()) return null
  const earlyMins = clockMinutes(early)
  const startMins = clockMinutes(start)
  if (earlyMins == null || startMins == null) return `${label} needs a clock time.`
  if (earlyMins >= startMins) return `${label} must be earlier than the shift start.`
  return null
}

function saveDay(day: DayScheduleInput, label: string):
  | { ok: true; clocks: SavedDayClocks }
  | { ok: false; message: string } {
  if (!day.enabled) {
    return { ok: true, clocks: { start: null, end: null, otStart: null, earlyOtStart: null } }
  }
  if (!day.start || !day.end) {
    return { ok: false, message: `${label} needs both a start time and an end time.` }
  }
  const early = earlierThan(day.earlyOtStart, day.start, `${label} early overtime`)
  if (early) return { ok: false, message: early }
  return {
    ok: true,
    clocks: {
      start: toTimeSql(day.start),
      end: toTimeSql(day.end),
      otStart: toTimeSql(day.otStart),
      earlyOtStart: toTimeSql(day.earlyOtStart),
    },
  }
}

export function templateSchedulePayload(input: TemplateScheduleInput):
  | {
      ok: true
      weekendStart: string | null
      weekendEnd: string | null
      otStart: string | null
      weekendOtStart: string | null
      earlyOtStart: string | null
      weekendEarlyOtStart: string | null
      sundayStart: string | null
      sundayEnd: string | null
      sundayOtStart: string | null
      sundayEarlyOtStart: string | null
    }
  | { ok: false; message: string } {
  const weekdayEarly = earlierThan(input.earlyOtStart, input.startTime, 'Early overtime')
  if (weekdayEarly) return { ok: false, message: weekdayEarly }
  const saturday = saveDay(input.saturday, 'Saturday')
  if (!saturday.ok) return saturday
  const sunday = saveDay(input.sunday, 'Sunday')
  if (!sunday.ok) return sunday
  return {
    ok: true,
    weekendStart: saturday.clocks.start,
    weekendEnd: saturday.clocks.end,
    otStart: toTimeSql(input.otStart),
    weekendOtStart: saturday.clocks.otStart,
    earlyOtStart: toTimeSql(input.earlyOtStart),
    weekendEarlyOtStart: saturday.clocks.earlyOtStart,
    sundayStart: sunday.clocks.start,
    sundayEnd: sunday.clocks.end,
    sundayOtStart: sunday.clocks.otStart,
    sundayEarlyOtStart: sunday.clocks.earlyOtStart,
  }
}

function hhmm(raw: string | null | undefined): string {
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return ''
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function daySummary(label: string, start?: string | null, end?: string | null, early?: string | null, ot?: string | null): string | null {
  const from = hhmm(start)
  const to = hhmm(end)
  if (!from || !to) return null
  const bits = [
    hhmm(early) ? `early OT ${hhmm(early)}` : '',
    hhmm(ot) ? `OT ${hhmm(ot)}` : '',
  ].filter(Boolean).join(', ')
  return `${label} ${from}–${to}${bits ? ` · ${bits}` : ''}`
}

export function templateHoursSummary(template: {
  start_time?: string | null
  end_time?: string | null
  weekend_start_time?: string | null
  weekend_end_time?: string | null
  ot_start_time?: string | null
  weekend_ot_start_time?: string | null
  early_ot_start_time?: string | null
  weekend_early_ot_start_time?: string | null
  sunday_start_time?: string | null
  sunday_end_time?: string | null
  sunday_ot_start_time?: string | null
  sunday_early_ot_start_time?: string | null
}): string {
  const weekday = `${hhmm(template.start_time)}–${hhmm(template.end_time)}`
  const early = hhmm(template.early_ot_start_time)
  const weekdayOt = hhmm(template.ot_start_time)
  const otBits = [
    early ? `early OT ${early}` : '',
    weekdayOt ? `OT ${weekdayOt}` : '',
  ].filter(Boolean).join(', ')
  const lines = [`Mon–Fri ${weekday}${otBits ? ` · ${otBits}` : ''}`]
  const saturday = daySummary('Sat', template.weekend_start_time, template.weekend_end_time, template.weekend_early_ot_start_time, template.weekend_ot_start_time)
  const sunday = daySummary('Sun', template.sunday_start_time, template.sunday_end_time, template.sunday_early_ot_start_time, template.sunday_ot_start_time)
  if (saturday) lines.push(saturday)
  if (sunday) lines.push(sunday)
  return lines.join(' · ')
}
