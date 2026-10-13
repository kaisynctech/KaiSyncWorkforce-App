/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/payroll/salary-resolver.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * Ports KaiFlow.Payroll/SalaryResolver.cs.
 */

import type { ISODate } from './period.ts'

export type SalaryHistoryEntry = {
  effective_date: ISODate
  monthly_salary: number
  hourly_rate: number
  daily_rate: number
  created_at?: string | null
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
    .sort((a, b) => {
      if (a.effective_date !== b.effective_date) return a.effective_date < b.effective_date ? 1 : -1
      const aCreated = a.created_at ?? ''
      const bCreated = b.created_at ?? ''
      if (aCreated === bCreated) return 0
      return aCreated < bCreated ? 1 : -1
    })[0]

  return applicable
    ? { monthlySalary: applicable.monthly_salary, hourlyRate: applicable.hourly_rate, dailyRate: applicable.daily_rate }
    : { monthlySalary: currentMonthly, hourlyRate: currentHourly, dailyRate: currentDaily }
}
