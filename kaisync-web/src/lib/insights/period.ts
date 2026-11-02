/**
 * Insights date ranges. Every date is a plain yyyy-mm-dd day in South African time, matching the
 * database (a work day runs 05:00–05:00 Africa/Johannesburg). Pure functions, tested.
 */

export type PresetKey =
  | 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'this_quarter' | 'ytd' | 'tax_year' | 'last_12m' | 'custom'

export type DateRange = { from: string; to: string }
export type Grain = 'day' | 'week' | 'month'

export const PRESETS: { key: Exclude<PresetKey, 'custom'>; label: string }[] = [
  { key: 'this_month',   label: 'This month' },
  { key: 'last_month',   label: 'Last month' },
  { key: 'last_30',      label: 'Last 30 days' },
  { key: 'last_90',      label: 'Last 90 days' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'ytd',          label: 'This year' },
  { key: 'tax_year',     label: 'Tax year (from 1 March)' },
  { key: 'last_12m',     label: 'Last 12 months' },
]

/** The database refuses ranges longer than this. */
export const MAX_RANGE_DAYS = 400

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** Today in South Africa as yyyy-mm-dd. */
export function todaySA(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}

/** Adds days to a yyyy-mm-dd day (calendar arithmetic in UTC, so no daylight-saving surprises). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function presetRange(key: Exclude<PresetKey, 'custom'>, now: Date = new Date()): DateRange {
  const today = todaySA(now)
  const [y, m] = parts(today)
  switch (key) {
    case 'this_month':
      return { from: iso(y, m, 1), to: today }
    case 'last_month': {
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDayOfMonth(py, pm)) }
    }
    case 'last_30':
      return { from: addDays(today, -29), to: today }
    case 'last_90':
      return { from: addDays(today, -89), to: today }
    case 'this_quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1
      return { from: iso(y, qm, 1), to: today }
    }
    case 'ytd':
      return { from: iso(y, 1, 1), to: today }
    case 'tax_year': {
      const ty = m >= 3 ? y : y - 1
      return { from: iso(ty, 3, 1), to: today }
    }
    case 'last_12m': {
      // The 12 whole months before this one, plus this month so far would pass 400 days; keep it to
      // exactly 12 months ending today.
      const fy = m === 12 ? y : y - 1
      const fm = m === 12 ? 1 : m + 1
      return { from: iso(fy, fm, 1), to: today }
    }
  }
}

export function rangeDays(r: DateRange): number {
  const [y1, m1, d1] = parts(r.from)
  const [y2, m2, d2] = parts(r.to)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1
}

export function isValidDay(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = parts(s)
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m)
}

/** Why a custom range cannot be used, or null when it is fine. */
export function rangeProblem(r: DateRange): string | null {
  if (!isValidDay(r.from) || !isValidDay(r.to)) return 'Pick a start and an end date.'
  if (r.to < r.from) return 'The end date is before the start date.'
  if (rangeDays(r) > MAX_RANGE_DAYS) return `Pick ${MAX_RANGE_DAYS} days or fewer.`
  return null
}

/** How finely a trend chart should group its points for this range. */
export function grainFor(r: DateRange): Grain {
  const n = rangeDays(r)
  if (n <= 45) return 'day'
  if (n <= 120) return 'week'
  return 'month'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "1–31 Oct 2026", "3 Oct – 1 Nov 2026", "1 Dec 2025 – 31 Jan 2026". */
export function describeRange(r: DateRange): string {
  if (!isValidDay(r.from) || !isValidDay(r.to)) return ''
  const [y1, m1, d1] = parts(r.from)
  const [y2, m2, d2] = parts(r.to)
  if (r.from === r.to) return `${d1} ${MONTHS[m1 - 1]} ${y1}`
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]} ${y2}`
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`
}

/** Axis label for a point in a trend series. */
export function pointLabel(day: string, grain: Grain): string {
  if (!isValidDay(day)) return day
  const [y, m, d] = parts(day)
  if (grain === 'month') return `${MONTHS[m - 1]} ${String(y).slice(2)}`
  return `${d} ${MONTHS[m - 1]}`
}

/** Change from the previous period as a percentage, or null when there is nothing to compare with. */
export function deltaPct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Week start (Monday) for a yyyy-mm-dd day, as yyyy-mm-dd; matches Postgres date_trunc('week'). */
export function weekStart(day: string): string {
  const [y, m, d] = parts(day)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(day, -((dow + 6) % 7))
}

/** Every day in the range, oldest first. */
export function eachDay(r: DateRange): string[] {
  const out: string[] = []
  const n = Math.min(rangeDays(r), MAX_RANGE_DAYS + 1)
  for (let i = 0; i < n; i++) out.push(addDays(r.from, i))
  return out
}

/** The period the numbers are compared with — the same rule as the database (_ins_prev). */
export function previousRange(r: DateRange): DateRange {
  const [fy, fm, fd] = parts(r.from)
  const next = addDays(r.to, 1)
  const [ny, nm, nd] = parts(next)
  if (fd === 1 && nd === 1) {
    const months = (ny - fy) * 12 + (nm - fm)
    const t = new Date(Date.UTC(fy, fm - 1 - months, 1))
    return { from: iso(t.getUTCFullYear(), t.getUTCMonth() + 1, 1), to: addDays(r.from, -1) }
  }
  const n = rangeDays(r)
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) }
}
