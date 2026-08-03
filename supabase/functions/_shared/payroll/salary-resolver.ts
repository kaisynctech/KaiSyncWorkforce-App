/**
 * Server-side copy of `kaisync-web/src/lib/payroll/salary-resolver.ts`.
 * Ports KaiFlow.Payroll/SalaryResolver.cs.
 */

import type { ISODate } from './period.ts'

export type SalaryHistoryEntry = {
  effective_date: ISODate
  monthly_salary: number
  hourly_rate: number
  daily_rate: number
}

export function resolveAsOf(
  currentMonthly: number,
  currentHourly: number,
  currentDaily: number,
  asOfDate: ISODate,
  history?: SalaryHistoryEntry[] | null
): { monthlySalary: number; hourlyRate: number; dailyRate: number } {
  if (!history || history.length === 0) {
    return { monthlySalary: currentMonthly, hourlyRate: currentHourly, dailyRate: currentDaily }
  }

  const applicable = history
    .filter(h => h.effective_date <= asOfDate)
    .sort((a, b) => (a.effective_date < b.effective_date ? 1 : a.effective_date > b.effective_date ? -1 : 0))[0]

  return applicable
    ? { monthlySalary: applicable.monthly_salary, hourlyRate: applicable.hourly_rate, dailyRate: applicable.daily_rate }
    : { monthlySalary: currentMonthly, hourlyRate: currentHourly, dailyRate: currentDaily }
}
