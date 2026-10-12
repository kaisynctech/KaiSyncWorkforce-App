import { describe, expect, it } from 'vitest'
import { resolveHrNavFlags, type HrNavFlags } from '@/lib/company-modules'

describe('resolveHrNavFlags finance entitlement', () => {
  it('changes only the finance flag', () => {
    const enabled = {
      payroll: true,
      attendance: false,
      employees: true,
      leave: true,
    }
    const withoutFinance = resolveHrNavFlags(enabled, false)
    const withFinance = resolveHrNavFlags(enabled, true)
    const keys = Object.keys(withoutFinance) as (keyof HrNavFlags)[]

    for (const key of keys) {
      if (key === 'finance') continue
      expect(withoutFinance[key]).toBe(withFinance[key])
    }
    expect(withoutFinance.finance).toBe(false)
    expect(withFinance.finance).toBe(true)
    expect(withoutFinance.payroll).toBe(true)
    expect(withoutFinance.attendance).toBe(false)
  })
})
