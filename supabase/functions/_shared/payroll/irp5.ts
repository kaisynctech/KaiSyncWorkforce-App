/**
 * AUTO-SYNCED from kaisync-web — do not edit by hand.
 * Source: kaisync-web/src/lib/payroll/irp5.ts
 * Regenerate: node scripts/sync-payroll-shared.mjs
 */

/**
 * Ports KaiFlow.Payroll/PayrollYtdHelper.cs and Irp5RecordBuilder.cs.
 */

import type { PayrollLineItem } from './types.ts'
import type { ISODate } from './period.ts'

export type YtdTotals = {
  gross_pay: number
  net_pay: number
  total_deductions: number
  paye: number
  uif: number
  taxable_earnings: number
  payslip_count: number
}

export type YtdPayslipRow = {
  periodEnd: ISODate
  status: string
  grossPay: number
  netPay: number
  deductions: number
  deductionLines: PayrollLineItem[]
}

/** SA tax year: March to February. */
export function taxYearFor(date: ISODate): { start: ISODate; end: ISODate } {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const tyYear = month >= 3 ? year : year - 1
  const endYear = tyYear + 1
  const dim = new Date(Date.UTC(endYear, 2, 0)).getUTCDate()
  return { start: `${tyYear}-03-01`, end: `${endYear}-02-${String(dim).padStart(2, '0')}` }
}

export function aggregateYtd(priorPayslips: YtdPayslipRow[], asOfPeriodEnd: ISODate): YtdTotals {
  const { start } = taxYearFor(asOfPeriodEnd)
  const rows = priorPayslips.filter(
    p => p.periodEnd >= start && p.periodEnd <= asOfPeriodEnd && p.status !== 'rejected'
  )

  let paye = 0
  let uif = 0
  for (const row of rows) {
    for (const line of row.deductionLines) {
      if (line.label === 'PAYE') paye += line.amount
      if (line.label === 'UIF') uif += line.amount
    }
  }

  const grossSum = rows.reduce((s, r) => s + r.grossPay, 0)
  return {
    gross_pay: grossSum,
    net_pay: rows.reduce((s, r) => s + r.netPay, 0),
    total_deductions: rows.reduce((s, r) => s + r.deductions, 0),
    paye,
    uif,
    taxable_earnings: grossSum,
    payslip_count: rows.length,
  }
}

export function mergeYtd(
  prior: YtdTotals,
  current: { grossPay: number; netPay: number; totalDeductions: number; deductionLines: PayrollLineItem[] }
): YtdTotals {
  const paye = current.deductionLines.filter(d => d.label === 'PAYE').reduce((s, d) => s + d.amount, 0)
  const uif = current.deductionLines.filter(d => d.label === 'UIF').reduce((s, d) => s + d.amount, 0)
  return {
    gross_pay: prior.gross_pay + current.grossPay,
    net_pay: prior.net_pay + current.netPay,
    total_deductions: prior.total_deductions + current.totalDeductions,
    paye: prior.paye + paye,
    uif: prior.uif + uif,
    taxable_earnings: prior.taxable_earnings + current.grossPay,
    payslip_count: prior.payslip_count + 1,
  }
}

export type Irp5EmployeeYearRecord = {
  employeeName: string
  idNumber: string | null
  taxNumber: string | null
  ytdGross: number
  ytdPaye: number
  ytdUif: number
  ytdNet: number
  payslipCount: number
}

export function buildForTaxYear(
  taxYearStartYear: number,
  employees: { name: string; idNumber?: string | null; taxNumber?: string | null; payslips: YtdPayslipRow[] }[]
): Irp5EmployeeYearRecord[] {
  const tyStart = `${taxYearStartYear}-03-01`
  const endYear = taxYearStartYear + 1
  const dim = new Date(Date.UTC(endYear, 2, 0)).getUTCDate()
  const tyEnd = `${endYear}-02-${String(dim).padStart(2, '0')}`

  return employees
    .map(e => {
      const ytd = aggregateYtd(
        e.payslips.filter(p => p.periodEnd >= tyStart && p.periodEnd <= tyEnd),
        tyEnd
      )
      return {
        employeeName: e.name,
        idNumber: e.idNumber ?? null,
        taxNumber: e.taxNumber ?? null,
        ytdGross: ytd.gross_pay,
        ytdPaye: ytd.paye,
        ytdUif: ytd.uif,
        ytdNet: ytd.net_pay,
        payslipCount: ytd.payslip_count,
      }
    })
    .filter(r => r.payslipCount > 0)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}

export function toCsvRows(records: Irp5EmployeeYearRecord[]): string[][] {
  return records.map(r => [
    r.employeeName,
    r.idNumber ?? '',
    r.taxNumber ?? '',
    r.ytdGross.toFixed(2),
    r.ytdPaye.toFixed(2),
    r.ytdUif.toFixed(2),
    r.ytdNet.toFixed(2),
    String(r.payslipCount),
  ])
}
