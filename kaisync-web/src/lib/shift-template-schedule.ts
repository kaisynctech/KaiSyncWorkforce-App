/** Time-template weekday, weekend, and overtime clock fields. */

export type TemplateScheduleInput = {
  weekendEnabled: boolean
  weekendStart: string
  weekendEnd: string
  otStart: string
  weekendOtStart: string
}

function toTimeSql(t: string): string | null {
  const trimmed = t.trim()
  if (!trimmed) return null
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed
}

export function templateSchedulePayload(input: TemplateScheduleInput):
  | { ok: true; weekendStart: string | null; weekendEnd: string | null; otStart: string | null; weekendOtStart: string | null }
  | { ok: false; message: string } {
  if (input.weekendEnabled && (!input.weekendStart || !input.weekendEnd)) {
    return { ok: false, message: 'Saturday and Sunday need both a start time and an end time.' }
  }
  return {
    ok: true,
    weekendStart: input.weekendEnabled ? toTimeSql(input.weekendStart) : null,
    weekendEnd: input.weekendEnabled ? toTimeSql(input.weekendEnd) : null,
    otStart: toTimeSql(input.otStart),
    weekendOtStart: input.weekendEnabled ? toTimeSql(input.weekendOtStart) : null,
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
}): string {
  const weekday = `${hhmm(template.start_time)}–${hhmm(template.end_time)}`
  const weekdayOt = hhmm(template.ot_start_time)
  const lines = [`Mon–Fri ${weekday}${weekdayOt ? ` · OT ${weekdayOt}` : ''}`]
  const weekendStart = hhmm(template.weekend_start_time)
  const weekendEnd = hhmm(template.weekend_end_time)
  if (weekendStart && weekendEnd) {
    const weekendOt = hhmm(template.weekend_ot_start_time)
    lines.push(`Sat–Sun ${weekendStart}–${weekendEnd}${weekendOt ? ` · OT ${weekendOt}` : ''}`)
  }
  return lines.join(' · ')
}
