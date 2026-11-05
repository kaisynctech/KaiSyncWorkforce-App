import { describe, expect, it } from 'vitest'
import { payslipEmailSummary } from './payslip-email'

describe('payslipEmailSummary', () => {
  it('counts sent and lists who has no email', () => {
    const s = payslipEmailSummary([
      { status: 'sent', recipient: 'a@x.co' },
      { status: 'sent', recipient: 'b@x.co' },
      { status: 'no_email', employeeId: 'e3', employeeName: 'Thabo M' },
      { status: 'failed', employeeId: 'e4', employeeName: 'Sipho K', message: 'bounced' },
    ])
    expect(s.text).toBe('Released 4 payslips. Emailed 2 of 4.')
    expect(s.noEmail).toEqual([{ id: 'e3', name: 'Thabo M' }])
    expect(s.failed).toEqual([{ id: 'e4', name: 'Sipho K', message: 'bounced' }])
  })

  it('single payslip wording', () => {
    expect(payslipEmailSummary([{ status: 'sent', recipient: 'a@x.co' }]).text).toBe('Payslip released and emailed to the employee.')
    expect(payslipEmailSummary([{ status: 'no_email', employeeId: 'e', employeeName: 'A' }]).text).toMatch(/not emailed/)
  })
})
