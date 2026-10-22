/**
 * Hourly and daily rates for an employee, shared by the Add and Edit employee screens.
 *
 * - Salaried (pay by hour/day off): rates come from the monthly salary. With no salary, the
 *   existing rates are kept (never overwritten with 0).
 * - Pay by hour: the entered hourly rate is used; the daily rate follows from daily hours.
 * - Pay by day: the entered day rate is used; the hourly rate follows from daily hours.
 *   If no rate was entered but a monthly salary exists, rates come from the salary.
 * Results are rounded to cents.
 */
export type PayRateInput = {
  monthlySalary: number
  payByHour: boolean
  payBasis: string | null | undefined
  /** Entered (or, on Edit, current) hourly rate. */
  hourlyRate: number
  /** Entered (or, on Edit, current) daily rate. */
  dailyRate: number
  workDaysWeekly: number
  dailyHours: number
}

export type PayRates = { hourlyRate: number; dailyRate: number }

const cents = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)

export function ratesFromSalary(monthlySalary: number, workDaysWeekly: number, dailyHours: number): PayRates {
  const days = workDaysWeekly > 0 ? workDaysWeekly : 5
  const hours = dailyHours > 0 ? dailyHours : 8
  const daily = monthlySalary / (days * 52 / 12)
  return { dailyRate: cents(daily), hourlyRate: cents(daily / hours) }
}

export function resolvePayRates(p: PayRateInput): PayRates {
  const hours = p.dailyHours > 0 ? p.dailyHours : 8
  if (p.payByHour) {
    if (p.payBasis === 'daily' && p.dailyRate > 0) {
      return { dailyRate: cents(p.dailyRate), hourlyRate: cents(p.dailyRate / hours) }
    }
    if (p.payBasis !== 'daily' && p.hourlyRate > 0) {
      return { hourlyRate: cents(p.hourlyRate), dailyRate: cents(p.hourlyRate * hours) }
    }
  }
  if (p.monthlySalary > 0) return ratesFromSalary(p.monthlySalary, p.workDaysWeekly, hours)
  return { hourlyRate: cents(p.hourlyRate), dailyRate: cents(p.dailyRate) }
}

/** Message when the rate needed for the chosen pay basis is missing, otherwise null. */
export function missingRateMessage(p: PayRateInput): string | null {
  if (!p.payByHour || p.monthlySalary > 0) return null
  if (p.payBasis === 'daily') return p.dailyRate > 0 ? null : 'Enter the day rate.'
  return p.hourlyRate > 0 ? null : 'Enter the hourly rate.'
}
