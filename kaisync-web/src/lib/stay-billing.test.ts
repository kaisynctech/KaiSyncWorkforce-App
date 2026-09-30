import { describe, expect, it } from 'vitest'
import { computeStayCheckoutCharge } from '@/lib/stay-billing'

const base = {
  check_in_date: '2026-10-01',
  check_out_date: '2026-10-04',
  nightly_rate: 500,
  total_amount: 1500,
  deposit_amount: 400,
  deposit_status: 'paid' as const,
}

describe('computeStayCheckoutCharge', () => {
  it('bills stored total as nights times rate and applies a paid deposit', () => {
    const charge = computeStayCheckoutCharge(base)
    expect(charge.nights).toBe(3)
    expect(charge.charge).toBe(1500)
    expect(charge.quantity).toBe(3)
    expect(charge.unitPrice).toBe(500)
    expect(charge.depositApplied).toBe(400)
  })

  it('caps the deposit at the accommodation charge', () => {
    const charge = computeStayCheckoutCharge({
      ...base,
      total_amount: 1500,
      deposit_amount: 2000,
      deposit_status: 'held',
    })
    expect(charge.depositApplied).toBe(1500)
  })

  it('does not apply a deposit that is still due or was refunded', () => {
    expect(computeStayCheckoutCharge({ ...base, deposit_status: 'due' }).depositApplied).toBe(0)
    expect(computeStayCheckoutCharge({ ...base, deposit_status: 'refunded' }).depositApplied).toBe(0)
  })

  it('skips billing when there is no rate and no total', () => {
    const charge = computeStayCheckoutCharge({
      ...base,
      nightly_rate: null,
      total_amount: null,
      deposit_status: 'none',
      deposit_amount: null,
    })
    expect(charge.charge).toBeNull()
    expect(charge.depositApplied).toBe(0)
  })

  it('bills one night when check-in and check-out are the same day', () => {
    const charge = computeStayCheckoutCharge({
      ...base,
      check_out_date: '2026-10-01',
      total_amount: null,
      nightly_rate: 800,
      deposit_status: 'none',
    })
    expect(charge.nights).toBe(1)
    expect(charge.charge).toBe(800)
  })
})
