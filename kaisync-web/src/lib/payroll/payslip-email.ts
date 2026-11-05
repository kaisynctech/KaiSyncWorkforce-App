/**
 * Email a released payslip to the employee (PDF attached), from the company's name with replies going to
 * the company. Built from the saved payslip so it matches what the employee downloads in their portal.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPayslipTemplatePdf } from '@/lib/payslip-pdf'
import { companyLetterhead } from '@/lib/letterhead'
import { parseExtraLines } from '@/lib/payslip-extra-lines'

export type PayslipEmailResult =
  | { status: 'sent'; recipient: string }
  | { status: 'no_email'; employeeId: string; employeeName: string }
  | { status: 'failed'; employeeId: string | null; employeeName: string; message: string }

type PaymentRow = {
  id: string; company_id: string; employee_id: string; period_start: string | null; period_end: string | null
  regular_pay: number | null; overtime_pay: number | null; payslip_lines: Record<string, unknown> | null
}
type PersonRow = {
  name?: string | null; surname?: string | null; email?: string | null; address?: string | null
  employee_number?: string | null; id_number?: string | null; tax_number?: string | null; employment_date?: string | null
  hourly_rate?: number | null; overtime_rate?: number | null; overtime_hourly_rate?: number | null
  bank_name?: string | null; bank_branch_code?: string | null; bank_account?: string | null
  paid_leave_balance?: number | null; sick_leave_balance?: number | null
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function emailPayslip(supabase: SupabaseClient, paymentId: string): Promise<PayslipEmailResult> {
  const { data: pay, error } = await supabase
    .from('payment_approvals')
    .select('id, company_id, employee_id, period_start, period_end, regular_pay, overtime_pay, payslip_lines')
    .eq('id', paymentId)
    .maybeSingle()
  if (error || !pay) return { status: 'failed', employeeId: null, employeeName: 'Payslip', message: error?.message ?? 'Payslip not found.' }
  const p = pay as PaymentRow
  const [{ data: person }, { data: company }] = await Promise.all([
    supabase.from('employees').select('name, surname, email, address, employee_number, id_number, tax_number, employment_date, hourly_rate, overtime_rate, overtime_hourly_rate, bank_name, bank_branch_code, bank_account, paid_leave_balance, sick_leave_balance').eq('id', p.employee_id).maybeSingle(),
    supabase.from('companies').select('name, address').eq('id', p.company_id).maybeSingle(),
  ])
  const e = (person ?? {}) as PersonRow
  const employeeName = `${e.name ?? ''} ${e.surname ?? ''}`.trim() || 'Employee'
  const email = (e.email ?? '').trim()
  if (!EMAIL_RE.test(email)) return { status: 'no_email', employeeId: p.employee_id, employeeName }

  try {
    const co = company as { name?: string | null; address?: string | null } | null
    const lines = p.payslip_lines ?? {}
    const amount = (key: string, fallback?: number | null) => {
      const v = lines[key]
      return typeof v === 'number' ? v : Number(fallback ?? 0)
    }
    const { doc, fileName } = buildPayslipTemplatePdf({
      companyName: co?.name ?? '',
      companyAddress: co?.address,
      letterhead: await companyLetterhead(supabase, p.company_id, co?.name ?? ''),
      employeeName,
      address: e.address,
      employeeId: e.id_number,
      incomeTaxNumber: e.tax_number,
      employeeNumber: e.employee_number,
      employmentDate: e.employment_date,
      periodStart: p.period_start ?? '',
      periodEnd: p.period_end ?? '',
      hourlyRate: Number(e.hourly_rate ?? 0),
      overtimeRate: Number(e.overtime_hourly_rate ?? 0),
      overtimeFactor: Number(e.overtime_rate) > 0 ? Number(e.overtime_rate) : 1.5,
      regular: amount('regular', p.regular_pay),
      overtime: amount('overtime', p.overtime_pay),
      bonus: amount('bonus'),
      incentive: amount('incentive'),
      refund: amount('refund'),
      uif: amount('uif'),
      paye: amount('paye'),
      loanDeduction: amount('loanDeduction'),
      loanBalance: amount('loanBalance'),
      unpaidLeave: amount('unpaidLeave'),
      extraEarnings: parseExtraLines(lines.extraEarnings),
      extraDeductions: parseExtraLines(lines.extraDeductions),
      bankName: e.bank_name,
      bankBranch: e.bank_branch_code,
      bankAccount: e.bank_account,
      paidTimeOff: e.paid_leave_balance ?? null,
      sickTimeOff: e.sick_leave_balance ?? null,
    })
    const pdf = doc.output('datauristring').split(',')[1] ?? ''
    const { data, error: fnErr } = await supabase.functions.invoke('send_payslip_email', {
      body: { payment_id: p.id, pdf_base64: pdf, filename: fileName },
    })
    const body = data as { ok?: boolean; message?: string; recipient_email?: string } | null
    if (body?.ok) return { status: 'sent', recipient: body.recipient_email ?? email }
    let message = body?.message ?? 'The email could not be sent.'
    try {
      const ctx = await (fnErr as { context?: Response } | null)?.context?.json?.()
      if (ctx?.message) message = ctx.message
    } catch { /* keep message */ }
    return { status: 'failed', employeeId: p.employee_id, employeeName, message }
  } catch (err) {
    return { status: 'failed', employeeId: p.employee_id, employeeName, message: err instanceof Error ? err.message : 'Could not make the payslip.' }
  }
}

/** One line for after a release: "Emailed 18 of 20 payslips." plus who couldn't be emailed. */
export function payslipEmailSummary(results: PayslipEmailResult[]): {
  text: string
  noEmail: { id: string; name: string }[]
  failed: { id: string | null; name: string; message: string }[]
} {
  const sent = results.filter(r => r.status === 'sent').length
  const noEmail = results.flatMap(r => r.status === 'no_email' ? [{ id: r.employeeId, name: r.employeeName }] : [])
  const failed = results.flatMap(r => r.status === 'failed' ? [{ id: r.employeeId, name: r.employeeName, message: r.message }] : [])
  const n = results.length
  const text = n === 1
    ? (sent ? 'Payslip released and emailed to the employee.' : 'Payslip released. It was not emailed — see below.')
    : `Released ${n} payslips. Emailed ${sent} of ${n}.`
  return { text, noEmail, failed }
}
