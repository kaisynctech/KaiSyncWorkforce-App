import { describe, expect, it } from 'vitest'
import { nextPayment } from '@/components/money/ExpensesManager'
import { monthlyEquivalent } from './overview'

describe('subscriptions', () => {
  it('finds the next payment day', () => {
    expect(nextPayment({ frequency: 'monthly', start_date: '2026-01-31', end_date: null }, '2026-11-05')).toBe('2026-11-30')
    expect(nextPayment({ frequency: 'monthly', start_date: '2026-11-08', end_date: null }, '2026-11-05')).toBe('2026-11-08')
    expect(nextPayment({ frequency: 'yearly', start_date: '2025-03-01', end_date: null }, '2026-11-05')).toBe('2027-03-01')
    expect(nextPayment({ frequency: 'weekly', start_date: '2026-11-02', end_date: null }, '2026-11-05')).toBe('2026-11-09')
    expect(nextPayment({ frequency: 'once', start_date: '2026-10-01', end_date: null }, '2026-11-05')).toBeNull()
    expect(nextPayment({ frequency: 'monthly', start_date: '2026-01-15', end_date: '2026-10-31' }, '2026-11-05')).toBeNull()
  })
  it('turns any frequency into a monthly cost', () => {
    expect(monthlyEquivalent({ amount: 1200, frequency: 'yearly' })).toBe(100)
    expect(monthlyEquivalent({ amount: 300, frequency: 'quarterly' })).toBe(100)
    expect(monthlyEquivalent({ amount: 500, frequency: 'once' })).toBe(0)
  })
})
