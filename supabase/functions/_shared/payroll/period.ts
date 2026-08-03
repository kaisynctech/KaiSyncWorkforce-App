/**
 * Server-side copy of `kaisync-web/src/lib/payroll/period.ts`.
 * Ports KaiFlow.Payroll/PayrollPeriodHelper.cs.
 * Dates are ISO 'YYYY-MM-DD' strings; day-number math avoids local-timezone drift.
 */

export type ISODate = string

function parseISODate(d: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = d.split('-').map(Number)
  return { year, month, day }
}

export function dayNumber(d: ISODate): number {
  const { year, month, day } = parseISODate(d)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function yearMonthOf(d: ISODate): { year: number; month: number } {
  const { year, month } = parseISODate(d)
  return { year, month }
}

export function addDaysISO(d: ISODate, days: number): ISODate {
  const { year, month, day } = parseISODate(d)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function effectivePeriod(
  periodStart: ISODate,
  periodEnd: ISODate,
  employmentDate?: ISODate | null,
  terminationDate?: ISODate | null
): { start: ISODate; end: ISODate; isValid: boolean } {
  let start = periodStart
  let end = periodEnd

  if (employmentDate && employmentDate > start) start = employmentDate
  if (terminationDate && terminationDate < end) end = terminationDate

  return { start, end, isValid: end >= start }
}

export function isEmployedInPeriod(
  periodStart: ISODate,
  periodEnd: ISODate,
  employmentDate?: ISODate | null,
  terminationDate?: ISODate | null
): boolean {
  if (employmentDate && employmentDate > periodEnd) return false
  if (terminationDate && terminationDate < periodStart) return false
  return true
}

export function proRateFactor(
  periodStart: ISODate,
  periodEnd: ISODate,
  employmentDate?: ISODate | null,
  terminationDate?: ISODate | null
): number {
  const { start, end, isValid } = effectivePeriod(periodStart, periodEnd, employmentDate, terminationDate)
  if (!isValid) return 0

  const periodDays = dayNumber(periodEnd) - dayNumber(periodStart) + 1
  const effectiveDays = dayNumber(end) - dayNumber(start) + 1
  return periodDays > 0 ? effectiveDays / periodDays : 0
}

/**
 * Salary factor for monthly-paid employees. Returns 1.0 when employed for the
 * full calendar month. Pro-rates only for joiners/leavers within that month.
 * Does not reduce salary just because payroll is generated before month-end.
 */
export function monthlySalaryFactor(
  periodStart: ISODate,
  periodEnd: ISODate,
  employmentDate?: ISODate | null,
  terminationDate?: ISODate | null
): number {
  const { year, month } = yearMonthOf(periodEnd)
  const dim = daysInMonth(year, month)
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${year}-${pad(month)}-01`
  const monthEnd = `${year}-${pad(month)}-${pad(dim)}`

  if (employmentDate && employmentDate > monthEnd) return 0
  if (terminationDate && terminationDate < monthStart) return 0

  let effStart = monthStart
  if (employmentDate && employmentDate > effStart) effStart = employmentDate

  let effEnd = monthEnd
  if (terminationDate && terminationDate < effEnd) effEnd = terminationDate

  if (effEnd < effStart) return 0
  if (effStart <= monthStart && effEnd >= monthEnd) return 1.0

  const employedDays = dayNumber(effEnd) - dayNumber(effStart) + 1
  return employedDays / dim
}
