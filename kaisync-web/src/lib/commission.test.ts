import { describe, expect, it } from 'vitest'
import { commissionError, howWorkedOut, parsePercent, totals, type CommissionRow } from './commission'

const row = (p: Partial<CommissionRow>): CommissionRow => ({
  id: 'x', quote_id: 'q', quote_number: 'QU1', quote_title: null, client_name: null, basis: 'profit', percent: 10, base_amount: 4000,
  commission_amount: 400, paid_share: 0.5, earned: 200, paid_amount: 0, to_pay: 200, status: 'open', accepted_at: null, ...p,
})

describe('commission helpers', () => {
  it('reads a percent typed the South African way', () => {
    expect(parsePercent('7,5')).toBe(7.5)
    expect(parsePercent('5%')).toBe(5)
    expect(parsePercent('  ')).toBeNull()
    expect(Number.isNaN(parsePercent('abc'))).toBe(true)
  })
  it('explains how it was worked out', () => {
    expect(howWorkedOut(row({}), n => `R ${n}`)).toBe('10% of profit R 4000')
    expect(howWorkedOut(row({ basis: 'sale', percent: 2.5, base_amount: 20000 }), n => `R ${n}`)).toBe('2.5% of sale value R 20000')
  })
  it('adds up earned, paid and still to pay, ignoring cancelled totals', () => {
    const t = totals([row({}), row({ earned: 1000, paid_amount: 1000, to_pay: 0, commission_amount: 1000 }), row({ status: 'cancelled', earned: 0, to_pay: 0, commission_amount: 50 })])
    expect(t).toEqual({ earned: 1200, paid: 1000, toPay: 200, total: 1400 })
  })
  it('gives friendly messages', () => {
    expect(commissionError('ERROR: OWN_COMMISSION')).toMatch(/Someone else/)
    expect(commissionError(null)).toMatch(/Something went wrong/)
  })
})
