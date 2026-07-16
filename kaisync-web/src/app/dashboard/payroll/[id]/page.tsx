'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Toggle } from '@/components/Toggle'
import { PayrollLineItemsTable } from '@/components/payroll-line-items-table'
import type { EmployeePayment, PayrollLineItem, YtdTotals, PayrollAuditEntry } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s))

const fmtDateTime = (s: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s))

const PAYSLIP_COLORS: Record<string, { bg: string; fg: string }> = {
  approved: { bg: '#DCFCE7', fg: '#166534' },
  paid:     { bg: '#DBEAFE', fg: '#1E40AF' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
  pending:  { bg: '#FEF9C3', fg: '#854D0E' },
}
function stBg(s: string) { return (PAYSLIP_COLORS[s?.toLowerCase()] ?? PAYSLIP_COLORS.pending).bg }
function stFg(s: string) { return (PAYSLIP_COLORS[s?.toLowerCase()] ?? PAYSLIP_COLORS.pending).fg }

export default function PayslipDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const paymentId = params.id

  const [payment, setPayment] = useState<EmployeePayment | null>(null)
  const [earningsLines, setEarningsLines] = useState<PayrollLineItem[]>([])
  const [deductionLines, setDeductionLines] = useState<PayrollLineItem[]>([])
  const [ytd, setYtd] = useState<YtdTotals | null>(null)
  const [auditEntries, setAuditEntries] = useState<PayrollAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Override fields
  const [payFullSalary, setPayFullSalary] = useState(false)
  const [waivePenalties, setWaivePenalties] = useState(false)
  const [manualPaye, setManualPaye] = useState('')
  const [extraDeduction, setExtraDeduction] = useState('')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusNote, setBonusNote] = useState('')

  useEffect(() => { load() }, [paymentId])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    // Query payment_approvals (actual table); JSONB columns hold breakdown data
    const { data } = await supabase
      .from('payment_approvals')
      .select('*, employee:employees(name, surname)')
      .eq('id', paymentId)
      .single()

    if (!data) { router.push('/dashboard/payroll'); return }

    const p = data as EmployeePayment & {
      earnings_breakdown:   PayrollLineItem[] | null
      deductions_breakdown: PayrollLineItem[] | null
      ytd_json:             YtdTotals | null
      audit_log:            PayrollAuditEntry[] | null
      leave_days:           number | null
      working_days:         number | null
    }
    setPayment(p)
    setEarningsLines(p.earnings_breakdown ?? [])
    setDeductionLines(p.deductions_breakdown ?? [])
    setYtd(p.ytd_json ?? null)
    setAuditEntries(p.audit_log ?? [])

    setPayFullSalary(p.pay_full_base_salary ?? false)
    setWaivePenalties(p.waive_penalties ?? false)
    setManualPaye(p.manual_paye_override != null ? String(p.manual_paye_override) : '')
    setExtraDeduction(p.manual_adjustment != null ? String(p.manual_adjustment) : '')
    setAdjustmentNote(p.adjustment_note ?? '')
    setBonusAmount(p.bonus_amount != null ? String(p.bonus_amount) : '')
    setBonusNote(p.bonus_note ?? '')

    setLoading(false)
  }

  async function recalculate() {
    if (!payment) return
    setBusy(true)
    const supabase = createClient()
    // 1. Persist override fields to the row first
    await supabase.from('payment_approvals').update({
      pay_full_base_salary: payFullSalary,
      waive_penalties:      waivePenalties,
      manual_paye_override: manualPaye ? parseFloat(manualPaye) : null,
      manual_adjustment:    extraDeduction ? parseFloat(extraDeduction) : null,
      adjustment_note:      adjustmentNote || null,
      bonus_amount:         bonusAmount ? parseFloat(bonusAmount) : null,
      bonus_note:           bonusNote || null,
    }).eq('id', paymentId)
    // 2. Recalculate from time_punches
    try {
      await supabase.rpc('hr_recalculate_payslip', {
        p_company_id: payment.company_id,
        p_payment_id: paymentId,
      })
    } catch {}
    setBusy(false)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }
  if (!payment) return null

  const emp = payment.employee as { name: string; surname: string } | undefined
  const empName = emp ? `${emp.name} ${emp.surname}` : '—'

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/payroll" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary truncate">{empName}</h1>
          <p className="text-text-secondary text-sm">{payment.period_label}</p>
        </div>
        <StatusBadge label={payment.status} bg={stBg(payment.status)} fg={stFg(payment.status)} />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">

        {/* Payslip summary card */}
        <div className="card overflow-hidden">
          <table className="w-full">
            <tbody>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Working Days</td>
                <td className="data-td text-right text-[13px] w-[110px]">
                  {(payment as unknown as { working_days?: number }).working_days ?? 0}
                </td>
              </tr>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Leave Days</td>
                <td className="data-td text-right text-[13px] w-[110px] text-text-primary">
                  {(payment as unknown as { leave_days?: number }).leave_days ?? 0}
                </td>
              </tr>
              {(payment.absent_days ?? 0) > 0 && (
                <tr className="bg-surface-card border-b border-divider">
                  <td className="data-td text-text-primary text-[13px]">Absent Days</td>
                  <td className="data-td text-right text-[13px] w-[110px] text-error">{payment.absent_days}</td>
                </tr>
              )}
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Regular Hours</td>
                <td className="data-td text-right text-[13px] w-[110px]">{(payment.regular_hours ?? 0).toFixed(1)}h</td>
              </tr>
              {(payment.overtime_hours ?? 0) > 0 && (
                <tr className="bg-surface-card border-b border-divider">
                  <td className="data-td text-text-primary text-[13px]">Overtime Hours</td>
                  <td className="data-td text-right text-[13px] w-[110px]" style={{ color: '#F59E0B' }}>{(payment.overtime_hours ?? 0).toFixed(1)}h</td>
                </tr>
              )}
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Regular Pay</td>
                <td className="data-td text-right text-[13px] w-[110px]">{fmtR(payment.regular_pay ?? 0)}</td>
              </tr>
              {(payment.overtime_pay ?? 0) > 0 && (
                <tr className="bg-surface-card border-b border-divider">
                  <td className="data-td text-text-primary text-[13px]">Overtime Pay</td>
                  <td className="data-td text-right text-[13px] w-[110px]" style={{ color: '#F59E0B' }}>{fmtR(payment.overtime_pay ?? 0)}</td>
                </tr>
              )}
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Gross Pay</td>
                <td className="data-td text-right text-[13px] w-[110px]">{fmtR(payment.gross_pay)}</td>
              </tr>
              {(payment.deductions ?? 0) > 0 && (
                <tr className="bg-surface-card border-b border-divider">
                  <td className="data-td text-text-primary text-[13px]">Deductions</td>
                  <td className="data-td text-right text-[13px] w-[110px] text-error">{fmtR(payment.deductions)}</td>
                </tr>
              )}
              {/* NET PAY row */}
              <tr className="bg-surface-elevated">
                <td className="data-td text-text-primary font-bold text-[14px]">NET PAY</td>
                <td className="data-td text-right w-[110px] font-bold text-[16px] text-text-primary">{fmtR(payment.net_pay)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* HR Adjustments — shown when payslip is still pending */}
        {payment.status === 'pending' && (
          <div className="card p-4 space-y-3">
            <p className="section-label">HR ADJUSTMENTS</p>
            <p className="text-text-secondary text-xs">
              Override payroll before approving. Tap Recalculate to apply — PAYE and settings save to the employee profile for next month.
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-y-2.5 items-center">
              <span className="text-text-primary text-sm">Pay full monthly salary (ignore mid-month join pro-rate)</span>
              <Toggle checked={payFullSalary} onChange={setPayFullSalary} />

              <span className="text-text-primary text-sm">Waive attendance penalties</span>
              <Toggle checked={waivePenalties} onChange={setWaivePenalties} />

              <span className="text-text-primary text-sm">Manual PAYE (R)</span>
              <input type="number" value={manualPaye} onChange={e => setManualPaye(e.target.value)}
                placeholder="Auto" className="dark-entry w-[100px] text-right" />

              <span className="text-text-primary text-sm">Extra deduction (R)</span>
              <input type="number" value={extraDeduction} onChange={e => setExtraDeduction(e.target.value)}
                className="dark-entry w-[100px] text-right" />

              <span className="text-text-primary text-sm">Adjustment note</span>
              <input type="text" value={adjustmentNote} onChange={e => setAdjustmentNote(e.target.value)}
                className="dark-entry w-[160px]" />

              <span className="text-text-primary text-sm">Bonus (R)</span>
              <input type="number" value={bonusAmount} onChange={e => setBonusAmount(e.target.value)}
                className="dark-entry w-[100px] text-right" />

              <span className="text-text-primary text-sm">Bonus note</span>
              <input type="text" value={bonusNote} onChange={e => setBonusNote(e.target.value)}
                className="dark-entry w-[160px]" />
            </div>
            <button onClick={recalculate} disabled={busy} className="btn-primary w-full h-11 text-[14px] mt-2">
              {busy ? 'Recalculating…' : 'Recalculate Payslip'}
            </button>
          </div>
        )}

        {/* Earnings Breakdown */}
        {earningsLines.length > 0 && (
          <div className="card p-4 space-y-2">
            <p className="section-label">EARNINGS BREAKDOWN</p>
            <PayrollLineItemsTable items={earningsLines} />
          </div>
        )}

        {/* Deductions Breakdown */}
        {deductionLines.length > 0 && (
          <div className="card p-4 space-y-2">
            <p className="section-label">DEDUCTIONS BREAKDOWN</p>
            <PayrollLineItemsTable items={deductionLines} showAsDeductions />
          </div>
        )}

        {/* Year to Date */}
        {ytd && (
          <div className="card p-4 space-y-2">
            <p className="section-label">YEAR TO DATE (TAX YEAR)</p>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-divider">
                  <td className="data-td text-text-secondary text-[13px]">YTD Gross</td>
                  <td className="data-td text-right text-[13px] w-[110px]">{fmtR(ytd.gross_pay)}</td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="data-td text-text-secondary text-[13px]">YTD PAYE</td>
                  <td className="data-td text-right text-[13px] w-[110px] text-error">{fmtR(ytd.paye)}</td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="data-td text-text-secondary text-[13px]">YTD UIF</td>
                  <td className="data-td text-right text-[13px] w-[110px] text-error">{fmtR(ytd.uif)}</td>
                </tr>
                <tr>
                  <td className="data-td text-text-primary text-[13px]">YTD Net</td>
                  <td className="data-td text-right text-[13px] w-[110px] text-text-primary font-medium">{fmtR(ytd.net_pay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Audit Trail */}
        {auditEntries.length > 0 && (
          <div className="card p-4 space-y-2">
            <p className="section-label">AUDIT TRAIL</p>
            <table className="w-full">
              <tbody>
                {auditEntries.map((e, i) => (
                  <tr key={i} className="border-b border-divider last:border-0">
                    <td className="data-td">
                      <p className="text-text-primary text-sm">{e.action}</p>
                      {e.detail && <p className="text-text-secondary text-[11px]">{e.detail}</p>}
                    </td>
                    <td className="data-td text-right text-[11px] text-text-secondary w-[120px] whitespace-nowrap">
                      {fmtDateTime(e.at)}
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
