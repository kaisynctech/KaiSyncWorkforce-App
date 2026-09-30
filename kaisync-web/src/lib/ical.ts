/**
 * Minimal iCal (VEVENT) parser for Airbnb / Booking.com availability feeds.
 * Handles VALUE=DATE and basic DATE-TIME; DTEND for all-day is exclusive (matches stays).
 */

export type IcalEvent = {
  uid: string
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD exclusive checkout
  summary: string | null
  raw: Record<string, string>
}

/** Unfold iCal lines (RFC 5545): lines starting with space/tab continue previous. */
export function unfoldIcal(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function parseIcalDate(value: string): string | null {
  // DATE: 20260301 or DATE-TIME: 20260301T140000Z / 20260301T140000
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Parse VEVENT blocks. Skips cancelled events (STATUS:CANCELLED).
 * If DTEND missing, treats as single-night (start → start+1).
 */
export function parseIcalEvents(text: string): IcalEvent[] {
  const lines = unfoldIcal(text)
  const events: IcalEvent[] = []
  let inEvent = false
  let fields: Record<string, string> = {}

  const flush = () => {
    if (!inEvent) return
    const status = (fields.STATUS ?? '').toUpperCase()
    if (status === 'CANCELLED') {
      fields = {}
      return
    }
    const uid = (fields.UID ?? '').trim()
    const start = fields.DTSTART ? parseIcalDate(fields.DTSTART) : null
    let end = fields.DTEND ? parseIcalDate(fields.DTEND) : null
    if (!uid || !start) {
      fields = {}
      return
    }
    // All-day DTEND is exclusive; DATE-TIME overnight stays also use exclusive checkout day
    if (!end) end = addDaysIso(start, 1)
    if (end <= start) end = addDaysIso(start, 1)

    events.push({
      uid,
      startDate: start,
      endDate: end,
      summary: fields.SUMMARY?.trim() || null,
      raw: { ...fields },
    })
    fields = {}
  }

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      fields = {}
      continue
    }
    if (line === 'END:VEVENT') {
      flush()
      inEvent = false
      continue
    }
    if (!inEvent) continue

    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const left = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const key = left.split(';')[0].toUpperCase()
    // Prefer first occurrence
    if (!(key in fields)) fields[key] = value
  }

  return events
}

export function guestNameFromIcalSummary(summary: string | null): { name: string; surname: string } {
  const s = (summary ?? '').trim()
  if (!s) return { name: 'Blocked', surname: '(iCal)' }
  const lower = s.toLowerCase()
  if (
    lower.includes('not available')
    || lower === 'blocked'
    || lower === 'unavailable'
    || lower.includes('closed')
  ) {
    return { name: 'Blocked', surname: '(iCal)' }
  }
  // "Reserved - Jane Doe" / "Airbnb (John Smith)"
  const cleaned = s
    .replace(/^reserved\s*[-–:]?\s*/i, '')
    .replace(/^airbnb\s*[:(]?\s*/i, '')
    .replace(/\)\s*$/, '')
    .trim()
  if (!cleaned) return { name: 'Reserved', surname: '(iCal)' }
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return { name: parts[0], surname: '' }
  return { name: parts[0], surname: parts.slice(1).join(' ') }
}

/** Reject loopback and private hosts so a saved calendar URL cannot reach internal services. */
function isBlockedIcalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '0.0.0.0'
    || host === '::1'
  ) {
    return true
  }
  if (host.includes(':') && (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) {
    return true
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false
  const a = Number(ipv4[1])
  const b = Number(ipv4[2])
  if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some(n => n > 255)) return true
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export async function fetchIcalText(url: string, timeoutMs = 20_000): Promise<
  { ok: true; text: string } | { ok: false; message: string }
> {
  const trimmed = url.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, message: 'iCal URL is not valid.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: 'iCal URL must start with http:// or https://' }
  }
  if (isBlockedIcalHost(parsed.hostname)) {
    return { ok: false, message: 'iCal URL must be a public calendar address.' }
  }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(trimmed, {
      signal: ctrl.signal,
      headers: { Accept: 'text/calendar, text/plain, */*' },
      redirect: 'follow',
      cache: 'no-store',
    })
    clearTimeout(t)
    if (!res.ok) return { ok: false, message: `iCal fetch failed (${res.status})` }
    const text = await res.text()
    if (!text.includes('BEGIN:VCALENDAR') && !text.includes('BEGIN:VEVENT')) {
      return { ok: false, message: 'Response does not look like an iCal calendar.' }
    }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'iCal fetch failed' }
  }
}
