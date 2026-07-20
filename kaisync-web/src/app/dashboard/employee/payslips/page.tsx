'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Payslip {
  id: string
  period_start: string
  period_end: string
  gross_pay: number | null
  deductions: number | null
  net_pay: number | null
  status: string
  paid_at: string | null
  regular_hours: number | null
  overtime_hours: number | null
  working_days: number | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-warning/10 text-warning',
  approved: 'bg-primary/10 text-primary',
  paid:     'bg-success/10 text-success',
}

function fmtPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return `R ${n.toFixed(2)}`
}

export default function PayslipsPage() {
  const [payslips,   setPayslips]   = useState<Payslip[]>([])
  const [loading,    setLoading]    = useState(true)
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [downloading,setDownloading]= useState<string | null>(null)
  const [toast,      setToast]      = useState<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_payslips', {
      p_company_id:    member.companyId,
      p_employee_id:   member.employeeId,
      p_session_token: tok,
    })

    const sorted = ((data as Payslip[]) ?? [])
      .slice().sort((a, b) => b.period_start.localeCompare(a.period_start))
    setPayslips(sorted)
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function downloadPDF(payslip: Payslip) {
    if (!companyId || !employeeId) return
    setDownloading(payslip.id)
    const supabase = createClient()
    try {
      const path = `payslips/${companyId}/${employeeId}/${payslip.id}.pdf`
      const { data: urlData } = await supabase.storage
        .from('workforce-media')
        .createSignedUrl(path, 60)
      if (urlData?.signedUrl) {
        window.open(urlData.signedUrl, '_blank')
      } else {
        showToast('PDF not available yet.')
      }
    } catch {
      showToast('PDF not available yet.')
    }
    setDownloading(null)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Payslips</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mx-4 mt-3 shrink-0 rounded-xl px-4 py-3 bg-warning/10 border border-warning/30">
          <p className="text-[13px] text-warning font-semibold">{toast}</p>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {payslips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">payments</span>
            <p className="text-[14px]">No payslips yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className="px-4 py-3 font-medium text-text-primary whitespace-nowrap">
                      {fmtMoney(p.gross_pay)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {fmtMoney(p.deductions)}
                    </td>
                    <td className="px-4 py-3 font-bold text-text-primary whitespace-nowrap">
                      {fmtMoney(p.net_pay)}
                    </td>
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
                      {p.regular_hours != null ? p.regular_hours.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {p.overtime_hours != null ? p.overtime_hours.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {p.working_days != null ? p.working_days : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => downloadPDF(p)} disabled={downloading === p.id}
                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-divider text-text-secondary hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                        title="Download PDF">
                        {downloading === p.id
                          ? <span className="material-icons animate-spin text-[16px]">refresh</span>
                          : <span className="material-icons text-[16px]">download</span>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
