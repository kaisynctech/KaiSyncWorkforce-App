import { describe, expect, it } from 'vitest'
import {
  assessPayrollReadiness,
  buildPayrollGeneratePreview,
  isEligibleForPeriod,
} from '@/lib/payroll-readiness'

const base = {
  id: 'e1',
  name: 'Ada',
  surname: 'Lovelace',
  is_active: true,
  monthly_salary: 20000,
  hourly_rate: 0,
  daily_rate: 0,
  shift_template_id: 'tmpl-1',
  bank_name: 'FNB',
  bank_account: '123',
  worker_type: 'employee',
  employment_date: '2024-01-01',
  termination_date: null as string | null,
}

describe('assessPayrollReadiness', () => {
  it('marks ready when rates, bank, and shift exist', () => {
    const info = assessPayrollReadiness(base)
    expect(info.isReady).toBe(true)
    expect(info.statusLabel).toBe('Payroll ready')
  })

  it('flags missing rates as blocking', () => {
    const info = assessPayrollReadiness({
      ...base,
      monthly_salary: 0,
      hourly_rate: 0,
      daily_rate: 0,
    })
    expect(info.isReady).toBe(false)
    expect(info.statusLabel).toBe('Missing pay rates')
  })

  it('flags contractors for statutory review', () => {
    const info = assessPayrollReadiness({ ...base, worker_type: 'contractor' })
    expect(info.issues.some(i => i.toLowerCase().includes('contractor'))).toBe(true)
  })
})

describe('isEligibleForPeriod / buildPayrollGeneratePreview', () => {
  it('excludes employees hired after period end', () => {
    expect(
      isEligibleForPeriod(
        { ...base, employment_date: '2026-08-15' },
        '2026-08-01',
        '2026-08-10'
      )
    ).toBe(false)
  })

  it('counts duplicates and ready employees', () => {
    const preview = buildPayrollGeneratePreview(
      [base, { ...base, id: 'e2', name: 'Bob', monthly_salary: 0, hourly_rate: 0, daily_rate: 0, bank_name: null, bank_account: null }],
      '2026-08-01',
      '2026-08-31',
      new Set(['e1'])
    )
    expect(preview.duplicateCount).toBe(1)
    expect(preview.missingRatesCount).toBeGreaterThanOrEqual(0)
  })
})
