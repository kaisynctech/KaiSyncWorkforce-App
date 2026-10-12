/** Time-template weekday, weekend, and overtime clock fields. */

export type TemplateScheduleInput = {
  startTime: string
  weekendEnabled: boolean
  weekendStart: string
  weekendEnd: string
  otStart: string
  weekendOtStart: string
  earlyOtStart: string
  weekendEarlyOtStart: string
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

export function templateSchedulePayload(input: TemplateScheduleInput):
  | {
      ok: true
      weekendStart: string | null
      weekendEnd: string | null
      otStart: string | null
      weekendOtStart: string | null
      earlyOtStart: string | null
      weekendEarlyOtStart: string | null
    }
  | { ok: false; message: string } {
  if (input.weekendEnabled && (!input.weekendStart || !input.weekendEnd)) {
    return { ok: false, message: 'Saturday and Sunday need both a start time and an end time.' }
  }
  const weekdayEarly = earlierThan(input.earlyOtStart, input.startTime, 'Early overtime')
  if (weekdayEarly) return { ok: false, message: weekdayEarly }
  if (input.weekendEnabled) {
    const weekendEarly = earlierThan(input.weekendEarlyOtStart, input.weekendStart, 'Weekend early overtime')
    if (weekendEarly) return { ok: false, message: weekendEarly }
  }
  return {
    ok: true,
    weekendStart: input.weekendEnabled ? toTimeSql(input.weekendStart) : null,
    weekendEnd: input.weekendEnabled ? toTimeSql(input.weekendEnd) : null,
    otStart: toTimeSql(input.otStart),
    weekendOtStart: input.weekendEnabled ? toTimeSql(input.weekendOtStart) : null,
    earlyOtStart: toTimeSql(input.earlyOtStart),
    weekendEarlyOtStart: input.weekendEnabled ? toTimeSql(input.weekendEarlyOtStart) : null,
  }
}

function hhmm(raw: string | null | undefined): string {
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return ''
  return `${match[1].padStart(2, '0')}:${match[2]}`
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
}): string {
  const weekday = `${hhmm(template.start_time)}–${hhmm(template.end_time)}`
  const early = hhmm(template.early_ot_start_time)
  const weekdayOt = hhmm(template.ot_start_time)
  const otBits = [
    early ? `early OT ${early}` : '',
    weekdayOt ? `OT ${weekdayOt}` : '',
  ].filter(Boolean).join(', ')
  const lines = [`Mon–Fri ${weekday}${otBits ? ` · ${otBits}` : ''}`]
  const weekendStart = hhmm(template.weekend_start_time)
  const weekendEnd = hhmm(template.weekend_end_time)
  if (weekendStart && weekendEnd) {
    const weekendEarly = hhmm(template.weekend_early_ot_start_time)
    const weekendOt = hhmm(template.weekend_ot_start_time)
    const weekendBits = [
      weekendEarly ? `early OT ${weekendEarly}` : '',
      weekendOt ? `OT ${weekendOt}` : '',
    ].filter(Boolean).join(', ')
    lines.push(`Sat–Sun ${weekendStart}–${weekendEnd}${weekendBits ? ` · ${weekendBits}` : ''}`)
  }
  return lines.join(' · ')
}
