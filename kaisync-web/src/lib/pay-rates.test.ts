import { describe, expect, it } from 'vitest'
import { missingRateMessage, ratesFromSalary, resolvePayRates } from './pay-rates'

const base = { monthlySalary: 0, payByHour: false, payBasis: null, hourlyRate: 0, dailyRate: 0, workDaysWeekly: 5, dailyHours: 8 }

describe('resolvePayRates', () => {
  it('derives salaried rates from the monthly salary, rounded to cents', () => {
    expect(resolvePayRates({ ...base, monthlySalary: 118300 })).toEqual({ dailyRate: 5460, hourlyRate: 682.5 })
    expect(ratesFromSalary(93800, 5, 8)).toEqual({ dailyRate: 4329.23, hourlyRate: 541.15 })
  })
  it('keeps an hourly worker’s rate when saving (no monthly salary) — regression for the R0 bug', () => {
    expect(resolvePayRates({ ...base, payByHour: true, payBasis: 'hourly', hourlyRate: 77.57 }))
      .toEqual({ hourlyRate: 77.57, dailyRate: 620.56 })
  })
  it('uses the day rate for day-paid workers', () => {
    expect(resolvePayRates({ ...base, payByHour: true, payBasis: 'daily', dailyRate: 380, dailyHours: 8 }))
      .toEqual({ dailyRate: 380, hourlyRate: 47.5 })
  })
  it('keeps existing rates for a salaried person with no salary set (e.g. the owner)', () => {
    expect(resolvePayRates({ ...base, hourlyRate: 120, dailyRate: 960 })).toEqual({ hourlyRate: 120, dailyRate: 960 })
  })
  it('falls back to the salary when pay-by-hour is on but no rate was typed', () => {
    expect(resolvePayRates({ ...base, monthlySalary: 14065, payByHour: true, payBasis: 'hourly', workDaysWeekly: 6, dailyHours: 8 }))
      .toEqual(ratesFromSalary(14065, 6, 8))
  })
  it('supports quarter-hour days', () => {
    expect(resolvePayRates({ ...base, payByHour: true, payBasis: 'hourly', hourlyRate: 60, dailyHours: 8.25 }).dailyRate).toBe(495)
  })
})

describe('missingRateMessage', () => {
  it('asks for the rate that matches the pay basis', () => {
    expect(missingRateMessage({ ...base, payByHour: true, payBasis: 'hourly' })).toBe('Enter the hourly rate.')
    expect(missingRateMessage({ ...base, payByHour: true, payBasis: 'daily' })).toBe('Enter the day rate.')
    expect(missingRateMessage({ ...base, payByHour: true, payBasis: 'daily', dailyRate: 300 })).toBeNull()
    expect(missingRateMessage({ ...base, monthlySalary: 9000, payByHour: true, payBasis: 'hourly' })).toBeNull()
    expect(missingRateMessage(base)).toBeNull()
  })
})
