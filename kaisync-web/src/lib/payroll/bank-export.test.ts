import { describe, expect, it } from 'vitest'
import { formatBankPaymentFile, type BankPaymentRow } from './bank-export'

const rows: BankPaymentRow[] = [
  {
    employeeName: 'Ada Lovelace',
    bankName: 'FNB',
    branchCode: '250655',
    accountNumber: '1234567890',
    netPay: 18_450.5,
    reference: 'SAL-AUG-2026',
  },
]

describe('formatBankPaymentFile', () => {
  it('formats FNB headers and row order', () => {
    const { headers, rows: out } = formatBankPaymentFile('fnb', rows)
    expect(headers).toEqual(['Account', 'Branch', 'Type', 'Amount', 'Name', 'Reference', 'Description'])
    expect(out[0]).toEqual(['1234567890', '250655', ' ', '18450.50', 'Ada Lovelace', 'SAL-AUG-2026', 'Salary'])
  })

  it('formats ABSA headers and row order', () => {
    const { headers, rows: out } = formatBankPaymentFile('absa', rows)
    expect(headers).toEqual(['Account', 'Branch', 'Name', 'Amount', 'Reference'])
    expect(out[0]).toEqual(['1234567890', '250655', 'Ada Lovelace', '18450.50', 'SAL-AUG-2026'])
  })

  it('formats Standard Bank headers and row order', () => {
    const { headers, rows: out } = formatBankPaymentFile('standard_bank', rows)
    expect(headers).toEqual(['Name', 'Account', 'Branch', 'Amount', 'Reference', 'Type'])
    expect(out[0]).toEqual(['Ada Lovelace', '1234567890', '250655', '18450.50', 'SAL-AUG-2026', 'C'])
  })

  it('falls back to generic format for unknown formats', () => {
    const { headers, rows: out } = formatBankPaymentFile('unknown', rows)
    expect(headers).toEqual(['Employee', 'Bank', 'Branch Code', 'Account', 'Net Pay', 'Reference'])
    expect(out[0]).toEqual(['Ada Lovelace', 'FNB', '250655', '1234567890', '18450.50', 'SAL-AUG-2026'])
  })
})
