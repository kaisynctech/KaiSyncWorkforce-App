/** PA helpers — status normalization, snooze, recurrence spawn (MAUI MyPaHelper). */

export type PaStatus = 'todo' | 'in_progress' | 'done' | 'snoozed' | 'cancelled'

export function normalizePaStatus(raw: string | null | undefined): PaStatus {
  const s = (raw ?? 'todo').toLowerCase()
  if (s === 'completed' || s === 'done') return 'done'
  if (s === 'open' || s === 'pending' || s === 'todo') return 'todo'
  if (s === 'in_progress' || s === 'inprogress' || s === 'doing') return 'in_progress'
  if (s === 'snoozed' || s === 'snooze') return 'snoozed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'todo'
}

export function nextSnoozeUntil(option: string): string {
  const now = new Date()
  switch (option) {
    case 'later_today': {
      const d = new Date(now)
      d.setHours(now.getHours() + 3, 0, 0, 0)
      return d.toISOString()
    }
    case 'tomorrow':
    case 'tomorrow_9': {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    }
    case 'next_monday': {
      const d = new Date(now)
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    }
    case '2_hours':
    case '2h':
      return new Date(now.getTime() + 2 * 3600000).toISOString()
    default:
      return new Date(now.getTime() + 3600000).toISOString()
  }
}

/** Advance due_at for recurrence after complete (MAUI SpawnNextRecurrence). */
export function spawnNextDueAt(
  dueAt: string | null | undefined,
  pattern: string | null | undefined,
): string | null {
  const p = (pattern ?? 'none').toLowerCase()
  if (!dueAt || p === 'none' || !p) return null
  const d = new Date(dueAt)
  if (Number.isNaN(d.getTime())) return null
  if (p === 'daily') d.setDate(d.getDate() + 1)
  else if (p === 'weekly') d.setDate(d.getDate() + 7)
  else if (p === 'monthly') d.setMonth(d.getMonth() + 1)
  else return null
  return d.toISOString()
}

export type PaSettings = {
  briefing_enabled?: boolean
  focus_mode_enabled?: boolean
  manager_digest_enabled?: boolean
}

export function parsePaSettingsRpc(data: unknown): PaSettings {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') {
    return { briefing_enabled: true, focus_mode_enabled: false, manager_digest_enabled: false }
  }
  const r = row as Record<string, unknown>
  return {
    briefing_enabled: r.briefing_enabled !== false,
    focus_mode_enabled: Boolean(r.focus_mode_enabled),
    manager_digest_enabled: Boolean(r.manager_digest_enabled),
  }
}

/** ICS calendar entry for Export (MAUI MyPaHelper.BuildIcsCalendar). */
export type PaIcsEntry = {
  id: string
  title: string
  start: Date
  end?: Date | null
  subtitle?: string | null
  kindLabel?: string | null
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function formatIcsUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

export function buildIcsCalendar(
  entries: PaIcsEntry[],
  calendarName = 'KaiFlow My PA',
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KaiFlow//My PA//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ]
  const now = new Date()
  for (const e of entries) {
    const end = e.end ?? new Date(e.start.getTime() + 3600000)
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${e.id}@kaiflow.app`)
    lines.push(`DTSTAMP:${formatIcsUtc(now)}`)
    lines.push(`DTSTART:${formatIcsUtc(e.start)}`)
    lines.push(`DTEND:${formatIcsUtc(end)}`)
    lines.push(`SUMMARY:${escapeIcs(e.title)}`)
    if (e.subtitle || e.kindLabel) {
      const desc = [e.kindLabel, e.subtitle].filter(Boolean).join(': ')
      lines.push(`DESCRIPTION:${escapeIcs(desc)}`)
    }
    if (e.kindLabel) lines.push(`CATEGORIES:${escapeIcs(e.kindLabel)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export function downloadIcsFile(content: string, filename = 'my-pa.ics') {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Build ICS entries from PA tasks for the visible calendar window. */
export function paTasksToIcsEntries(
  tasks: {
    id: string
    title: string
    due_at?: string | null
    meeting_at?: string | null
    remind_at?: string | null
    notes?: string | null
    status?: string | null
  }[],
  from: Date,
  to: Date,
): PaIcsEntry[] {
  const out: PaIcsEntry[] = []
  for (const t of tasks) {
    if ((t.status ?? '') === 'cancelled') continue
    const raw = t.meeting_at || t.due_at || t.remind_at
    if (!raw) continue
    const start = new Date(raw)
    if (Number.isNaN(start.getTime())) continue
    if (start < from || start > to) continue
    out.push({
      id: t.id,
      title: t.title,
      start,
      end: new Date(start.getTime() + 3600000),
      subtitle: t.notes,
      kindLabel: t.meeting_at ? 'Meeting' : t.remind_at && !t.due_at ? 'Reminder' : 'Task',
    })
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}
