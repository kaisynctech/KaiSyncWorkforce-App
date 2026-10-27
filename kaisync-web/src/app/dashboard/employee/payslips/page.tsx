'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { signWorkforceMedia } from '@/lib/media-read'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { loadCompanyWorkspace, loadEmployeeWorkspace } from '@/lib/employee-workspace'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import { downloadPayslipTemplatePdf, imageUrlToDataUrl, parsePayslipsRpcJson, type PayslipPdfInput } from '@/lib/payslip-pdf'
import { companyLetterhead } from '@/lib/letterhead'
import { parseExtraLines } from '@/lib/payslip-extra-lines'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  approved: 'bg-primary/10 text-primary',
  paid: 'bg-success/10 text-success',
  rejected: 'bg-error/10 text-error',
}

function fmtPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d.includes('T') ? d : `${d}T12:00:00`).toLocaleDateString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return `R ${Number(n).toFixed(2)}`
}

export default function PayslipsPage() {
  const allowed = useEmployeeModuleGate('payroll')
  const [payslips, setPayslips] = useState<PayslipPdfInput[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [employeeName, setEmployeeName] = useState('Employee')
  const [companyName, setCompanyName] = useState('Company')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (allowed !== true) return
    void init()
  }, [allowed])

  async function init() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [company, emp] = await Promise.all([
      loadCompanyWorkspace(supabase, member.companyId),
      loadEmployeeWorkspace(supabase, member.employeeId),
    ])
    setCompanyName(company?.name ?? getCodeSession()?.company.name ?? 'Company')
    if (emp) setEmployeeName(`${emp.name} ${emp.surname}`.trim())
    else {
      const cs = getCodeSession()
      if (cs?.employee) setEmployeeName(`${cs.employee.name} ${cs.employee.surname}`.trim())
    }

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcErr } = await (supabase.rpc as any)('employee_get_payslips', {
      p_company_id: member.companyId,
      p_employee_id: member.employeeId,
      p_session_token: tok,
    })
    if (rpcErr) {
      setError(rpcErr.message)
      setPayslips([])
    } else {
      const sorted = parsePayslipsRpcJson(data)
        .slice()
        .sort((a, b) => (b.period_start ?? '').localeCompare(a.period_start ?? ''))
      setPayslips(sorted)
    }
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function downloadPDF(payslip: PayslipPdfInput) {
    if (!companyId || !employeeId) return
    setDownloading(payslip.id)
    const supabase = createClient()
    try {
      const [{ data: person }, { data: company }] = await Promise.all([
        supabase.from('employees').select('name, surname, address, employee_number, id_number, tax_number, employment_date, hourly_rate, overtime_rate, overtime_hourly_rate, bank_name, bank_branch_code, bank_account, paid_leave_balance, sick_leave_balance').eq('id', employeeId).maybeSingle(),
        supabase.from('companies').select('name, address, logo_url').eq('id', companyId).maybeSingle(),
      ])
      const personRow = person as {
        name?: string | null
        surname?: string | null
        address?: string | null
        employee_number?: string | null
        id_number?: string | null
        tax_number?: string | null
        employment_date?: string | null
        hourly_rate?: number | null
        overtime_rate?: number | null
        overtime_hourly_rate?: number | null
        bank_name?: string | null
        bank_branch_code?: string | null
        bank_account?: string | null
        paid_leave_balance?: number | null
        sick_leave_balance?: number | null
      } | null
      const companyRow = company as { name?: string | null; address?: string | null; logo_url?: string | null } | null
      let logoDataUrl: string | null = null
      if (companyRow?.logo_url) {
        const signedLogo = await signWorkforceMedia(supabase, companyRow.logo_url, 120)
        if (signedLogo) logoDataUrl = await imageUrlToDataUrl(signedLogo)
      }
      const lines = (payslip as PayslipPdfInput & { payslip_lines?: Record<string, unknown> | null }).payslip_lines ?? {}
      const amount = (key: string, fallback: number | null | undefined) => {
        const value = lines[key]
        return value == null || typeof value !== 'number' ? Number(fallback ?? 0) : Number(value)
      }
      downloadPayslipTemplatePdf({
        companyName: companyRow?.name ?? companyName,
        companyAddress: companyRow?.address,
        logoDataUrl,
        letterhead: await companyLetterhead(supabase, companyId, companyRow?.name ?? companyName, getCodeSession()?.company_code),
        employeeName: personRow ? `${personRow.name ?? ''} ${personRow.surname ?? ''}`.trim() : employeeName,
        address: personRow?.address,
        employeeId: personRow?.id_number,
        incomeTaxNumber: personRow?.tax_number,
        employeeNumber: personRow?.employee_number,
        employmentDate: personRow?.employment_date,
        periodStart: payslip.period_start,
        periodEnd: payslip.period_end,
        hourlyRate: Number(personRow?.hourly_rate ?? 0),
        overtimeRate: Number(personRow?.overtime_hourly_rate ?? 0),
        overtimeFactor: Number(personRow?.overtime_rate) > 0 ? Number(personRow?.overtime_rate) : 1.5,
        regular: amount('regular', payslip.regular_pay),
        overtime: amount('overtime', payslip.overtime_pay),
        bonus: amount('bonus', 0),
        incentive: amount('incentive', 0),
        refund: amount('refund', 0),
        uif: amount('uif', 0),
        paye: amount('paye', 0),
        loanDeduction: amount('loanDeduction', 0),
        loanBalance: amount('loanBalance', 0),
        unpaidLeave: amount('unpaidLeave', 0),
        extraEarnings: parseExtraLines(lines.extraEarnings),
        extraDeductions: parseExtraLines(lines.extraDeductions),
        bankName: personRow?.bank_name,
        bankBranch: personRow?.bank_branch_code,
        bankAccount: personRow?.bank_account,
        paidTimeOff: personRow?.paid_leave_balance ?? null,
        sickTimeOff: personRow?.sick_leave_balance ?? null,
      })
    } catch {
      showToast('Could not generate PDF.')
    }
    setDownloading(null)
  }

  if (allowed === null || (allowed && loading)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Payslips</h1>
      </div>

      {toast && (
        <div className="mx-4 mt-3 shrink-0 rounded-xl px-4 py-3 bg-warning/10 border border-warning/30">
          <p className="text-[13px] text-warning font-semibold">{toast}</p>
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 shrink-0 rounded-xl px-4 py-3 bg-error-dark border border-error/30">
          <p className="text-[13px] text-error font-semibold">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {payslips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary px-6 text-center">
            <span className="material-icons text-[48px] text-text-disabled">payments</span>
            <p className="text-[14px]">No payslips released yet.</p>
            <p className="text-[12px] text-text-disabled">
              Payslips appear here after HR shares them with you.
            </p>
          </div>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Period</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Gross Pay</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Deductions</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Net Pay</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Paid At</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Reg Hrs</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">OT Hrs</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Days</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {payslips.map(p => (
                    <tr key={p.id} className="hover:bg-surface-elevated transition-colors">
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {fmtPeriod(p.period_start, p.period_end)}
                      </td>
                      <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">{fmtMoney(p.gross_pay)}</td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{fmtMoney(p.deductions)}</td>
                      <td className="px-4 py-3 font-bold text-text-primary whitespace-nowrap">{fmtMoney(p.net_pay)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[p.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {p.paid_at
                          ? new Date(p.paid_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {p.regular_hours != null ? Number(p.regular_hours).toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {p.overtime_hours != null ? Number(p.overtime_hours).toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {p.working_days != null ? p.working_days : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void downloadPDF(p)}
                          disabled={downloading === p.id}
                          className="flex items-center justify-center w-10 h-10 rounded-lg border border-divider text-text-secondary hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                          title="Download PDF"
                        >
                          {downloading === p.id
                            ? <span className="material-icons animate-spin text-[18px]">refresh</span>
                            : <span className="material-icons text-[18px]">download</span>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            mobile={
              <>
                {payslips.map(p => (
                  <DataCard key={p.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <DataCardTitle>{fmtMoney(p.net_pay)}</DataCardTitle>
                        <DataCardMeta>{fmtPeriod(p.period_start, p.period_end)}</DataCardMeta>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize shrink-0 ${STATUS_STYLES[p.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                        {p.status}
                      </span>
                    </div>
                    <DataCardRow label="Gross" value={fmtMoney(p.gross_pay)} />
                    <DataCardRow label="Deductions" value={fmtMoney(p.deductions)} />
                    <button
                      type="button"
                      onClick={() => void downloadPDF(p)}
                      disabled={downloading === p.id}
                      className="mt-3 w-full h-11 rounded-lg border border-divider text-[13px] font-medium text-text-primary disabled:opacity-50"
                    >
                      {downloading === p.id ? 'Preparing…' : 'Download PDF'}
                    </button>
                  </DataCard>
                ))}
              </>
            }
          />
        )}
      </div>
    </div>
  )
}
