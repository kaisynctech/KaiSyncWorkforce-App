import { describe, expect, it } from 'vitest'
import {
  PAYROLL_SETTINGS_DEFAULTS,
  prefsToPayrollSettings,
  payrollSettingsToPrefs,
} from '@/lib/payroll-settings'

describe('prefsToPayrollSettings / payrollSettingsToPrefs', () => {
  it('merges defaults when prefs empty', () => {
    const s = prefsToPayrollSettings('co-1', {})
    expect(s.company_id).toBe('co-1')
    expect(s.overtime_multiplier).toBe(PAYROLL_SETTINGS_DEFAULTS.overtime_multiplier)
    expect(s.uif_enabled).toBe(true)
  })

  it('round-trips key preference fields', () => {
    const s = prefsToPayrollSettings('co-1', {
      overtime_multiplier: 2,
      uif_rate_percent: 1.5,
      default_paye_rate_percent: 20,
      use_sars_tax_tables: true,
    })
    expect(s.overtime_multiplier).toBe(2)
    expect(s.uif_rate_percent).toBe(1.5)
    expect(s.default_paye_rate_percent).toBe(20)
    expect(s.use_sars_tax_tables).toBe(true)

    const prefs = payrollSettingsToPrefs(s)
    expect(prefs.overtime_multiplier).toBe(2)
    expect(prefs.payroll_uif_rate_percent).toBe(1.5)
    expect(prefs.uif_rate_percent).toBe(1.5)
    expect(prefs.payroll_use_sars_tax_tables).toBe(true)
  })
})
