/** Number formats for Insights. Pure, tested. */

const n0 = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })
const n1 = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const n2 = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

export const isNum = (v: unknown): boolean =>
  (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))

/** R 1 120 143,20 */
export function money(v: unknown): string {
  if (!isNum(v)) return '—'
  return `R ${n2.format(num(v))}`
}

/** R 1 120 143 */
export function moneyWhole(v: unknown): string {
  if (!isNum(v)) return '—'
  return `R ${n0.format(Math.round(num(v)))}`
}

/** R 4.26m, R 535k, R 9 410 — for tiles and axes. */
export function moneyShort(v: unknown): string {
  if (!isNum(v)) return '—'
  const n = num(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e9) return `${sign}R ${trim(a / 1e9, 2)}bn`
  if (a >= 1e6) return `${sign}R ${trim(a / 1e6, 2)}m`
  if (a >= 1e5) return `${sign}R ${Math.round(a / 1e3)}k`
  if (a >= 1e4) return `${sign}R ${trim(a / 1e3, 1)}k`
  return `${sign}R ${n0.format(Math.round(a))}`
}

const trimFmt = [0, 1, 2].map(d => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: d }))
function trim(n: number, digits: number): string {
  return trimFmt[digits].format(n)
}

/** 1 284, 12.9k, 1.2m — for counts on tiles and axes. */
export function countShort(v: unknown): string {
  if (!isNum(v)) return '—'
  const n = num(v)
  const a = Math.abs(n)
  if (a >= 1e6) return `${trim(n / 1e6, 1)}m`
  if (a >= 1e4) return `${trim(n / 1e3, 1)}k`
  return n0.format(n)
}

export function count(v: unknown): string {
  return isNum(v) ? n0.format(num(v)) : '—'
}

export function pct(v: unknown, digits = 1): string {
  if (!isNum(v)) return '—'
  return `${(digits === 0 ? n0 : n1).format(num(v))}%`
}

export function hours(v: unknown): string {
  if (!isNum(v)) return '—'
  const n = num(v)
  return `${Math.abs(n) >= 1000 ? n0.format(n) : n1.format(n)} h`
}

export function days(v: unknown): string {
  if (!isNum(v)) return '—'
  const n = num(v)
  return `${n1.format(n)} ${n === 1 ? 'day' : 'days'}`
}

/** "+4.2%", "-12%", "0%" */
export function signedPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return ''
  const a = Math.abs(v)
  if (a < 0.05) return '0%'
  const s = a >= 10 ? n0.format(a) : n1.format(a)
  return `${v > 0 ? '+' : '−'}${s}%`
}

/** Plain number for CSV: no thousands separators, dot decimal. */
export function csvNumber(v: unknown, digits?: number): string {
  if (!isNum(v)) return ''
  const n = num(v)
  return digits == null ? String(n) : n.toFixed(digits)
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thu 29 Oct 2026" from yyyy-mm-dd. */
export function dayLong(day: unknown): string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '—'
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DOW[dow]} ${d} ${MON[m - 1]} ${y}`
}

/** "29 Oct 2026" from yyyy-mm-dd. */
export function dayShort(day: unknown): string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '—'
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return `${d} ${MON[m - 1]} ${y}`
}

/** Status words from the database ("partially_paid") as people read them ("Partially paid"). */
export function words(v: unknown): string {
  const s = String(v ?? '').replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : '—'
}
