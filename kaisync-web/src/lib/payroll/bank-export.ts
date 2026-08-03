/**
 * Ports KaiFlow.Payroll/BankPaymentFileFormatter.cs.
 */

export type BankPaymentRow = {
  employeeName: string
  bankName: string
  branchCode: string
  accountNumber: string
  netPay: number
  reference: string
  idNumber?: string | null
}

export type BankFormat = 'generic' | 'fnb' | 'absa' | 'standard_bank'

function f2(n: number): string {
  return n.toFixed(2)
}

export function toGenericCsv(rows: BankPaymentRow[]): string[][] {
  return rows.map(r => [r.employeeName, r.bankName, r.branchCode, r.accountNumber, f2(r.netPay), r.reference])
}

/** FNB-style bulk payment CSV (simplified). */
export function toFnbCsv(rows: BankPaymentRow[]): string[][] {
  return rows.map(r => [r.accountNumber, r.branchCode, ' ', f2(r.netPay), r.employeeName, r.reference, 'Salary'])
}

/** ABSA-style CSV (simplified). */
export function toAbsaCsv(rows: BankPaymentRow[]): string[][] {
  return rows.map(r => [r.accountNumber, r.branchCode, r.employeeName, f2(r.netPay), r.reference])
}

/** Standard Bank CSV (simplified). */
export function toStandardBankCsv(rows: BankPaymentRow[]): string[][] {
  return rows.map(r => [r.employeeName, r.accountNumber, r.branchCode, f2(r.netPay), r.reference, 'C'])
}

export function formatBankPaymentFile(
  format: string,
  rows: BankPaymentRow[]
): { headers: string[]; rows: string[][] } {
  switch (format.toLowerCase()) {
    case 'fnb':
      return {
        headers: ['Account', 'Branch', 'Type', 'Amount', 'Name', 'Reference', 'Description'],
        rows: toFnbCsv(rows),
      }
    case 'absa':
      return { headers: ['Account', 'Branch', 'Name', 'Amount', 'Reference'], rows: toAbsaCsv(rows) }
    case 'standard_bank':
    case 'std':
      return {
        headers: ['Name', 'Account', 'Branch', 'Amount', 'Reference', 'Type'],
        rows: toStandardBankCsv(rows),
      }
    default:
      return {
        headers: ['Employee', 'Bank', 'Branch Code', 'Account', 'Net Pay', 'Reference'],
        rows: toGenericCsv(rows),
      }
  }
}
