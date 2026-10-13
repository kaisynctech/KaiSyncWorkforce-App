'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Toggle } from '@/components/Toggle'
import { PayrollLineItemsTable } from '@/components/payroll-line-items-table'
import { recalculatePayslip } from '@/lib/payroll'
import { loadPayrollSettings } from '@/lib/payroll-settings'
import { AttendanceNote } from '@/components/attendance/AttendanceNote'
import { enrichSessionsWithPlaceNames } from '@/lib/punch-address-enrich'
import {
  buildPunchSessions,
  earlyFlag,
  fmtSessionDate,
  fmtSessionTime,
  lateFlag,
  locationDisplay,
  mergeNonWorkDays,
  toLocalDateStr,
  totalHrsDisplay,
  type PunchLike,
  type PunchSessionRow,
  type ShiftTemplateLike,
} from '@/lib/punch-session'
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
const PAYSLIP_TEMPLATE_SELECT = 'id, name, start_time, end_time, break_minutes, weekend_start_time, weekend_end_time, ot_start_time, weekend_ot_start_time, early_ot_start_time, weekend_early_ot_start_time'

type SlipTab = 'pay' | 'timesheet' | 'schedule'

function clockRange(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null
  return `${start.slice(0, 5)} – ${end.slice(0, 5)}`
}

function requiredWorkingDays(start: string, end: string, daysPerWeek: number): number {
  const weekly = Math.min(7, Math.max(0, Math.round(daysPerWeek)))
  if (weekly <= 0) return 0
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  let count = 0
  for (let t = Date.UTC(sy, sm - 1, sd); t <= Date.UTC(ey, em - 1, ed); t += 86_400_000) {
    const dow = new Date(t).getUTCDay()
    const mondayIndex = dow === 0 ? 7 : dow
    if (mondayIndex <= weekly) count++
  }
  return count
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return out
  while (cur <= end) {
    out.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return out
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [days, setDays] = useState<PunchSessionRow[]>([])
  const [daysLoading, setDaysLoading] = useState(false)
  const [daysError, setDaysError] = useState<string | null>(null)
  const [templateLabel, setTemplateLabel] = useState<string | null>(null)
  const [slipTab, setSlipTab] = useState<SlipTab>('pay')
  const [daysPerWeek, setDaysPerWeek] = useState(5)
  const [vatApplies, setVatApplies] = useState(false)
  const [vatSaving, setVatSaving] = useState(false)
  const [weekdayHours, setWeekdayHours] = useState<string | null>(null)
  const [weekendHours, setWeekendHours] = useState<string | null>(null)

  // Override fields
  const [payFullSalary, setPayFullSalary] = useState(false)
  const [waivePenalties, setWaivePenalties] = useState(false)
  const [manualPaye, setManualPaye] = useState('')
  const [extraDeduction, setExtraDeduction] = useState('')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusNote, setBonusNote] = useState('')

  useEffect(() => { load() }, [paymentId])

  useEffect(() => {
    if (!payment?.employee_id || !payment.period_start || !payment.period_end) return
    let cancelled = false
    async function loadDays() {
      setDaysLoading(true)
      setDaysError(null)
      const supabase = createClient()
      const periodStart = payment!.period_start!
      const periodEnd = payment!.period_end!
      const [{ data: empRow, error: empErr }, settingsRes, punchRes, companyRes, leaveRes, absenceRes] = await Promise.all([
        supabase.from('employees').select('shift_template_id, daily_hours, work_days_weekly, vat_applies').eq('id', payment!.employee_id).maybeSingle(),
        loadPayrollSettings(supabase, payment!.company_id),
        supabase.from('time_punches')
          .select('id, employee_id, type, date_time, latitude, longitude, address, notes')
          .eq('company_id', payment!.company_id)
          .eq('employee_id', payment!.employee_id)
          .gte('date_time', `${periodStart}T00:00:00`)
          .lte('date_time', `${periodEnd}T23:59:59`)
          .order('date_time', { ascending: true }),
        supabase.from('companies').select('custom_settings').eq('id', payment!.company_id).maybeSingle(),
        supabase.from('leave_requests')
          .select('start_date, end_date, leave_type, status')
          .eq('company_id', payment!.company_id)
          .eq('employee_id', payment!.employee_id)
          .eq('status', 'approved')
          .lte('start_date', periodEnd)
          .gte('end_date', periodStart),
        supabase.from('daily_absences')
          .select('date, reason, note')
          .eq('company_id', payment!.company_id)
          .eq('employee_id', payment!.employee_id)
          .gte('date', periodStart)
          .lte('date', periodEnd),
      ])
      if (cancelled) return
      const loadError = empErr?.message
        ?? punchRes.error?.message
        ?? companyRes.error?.message
        ?? leaveRes.error?.message
        ?? absenceRes.error?.message
        ?? (!settingsRes.ok ? settingsRes.message : null)
      if (loadError) {
        setDaysError(loadError)
        setDays([])
        setDaysLoading(false)
        return
      }

      const personalId = (empRow as { shift_template_id?: string | null } | null)?.shift_template_id ?? null
      const templateSelect = () => supabase.from('employee_shift_templates').select(PAYSLIP_TEMPLATE_SELECT).eq('company_id', payment!.company_id)
      let template = null as (ShiftTemplateLike & { name?: string | null }) | null
      let usedPersonal = false
      if (personalId) {
        const { data, error } = await templateSelect().eq('id', personalId).maybeSingle()
        if (cancelled) return
        if (error) {
          setDaysError(error.message)
          setDays([])
          setDaysLoading(false)
          return
        }
        if (data) {
          template = data as ShiftTemplateLike & { name?: string | null }
          usedPersonal = true
        }
      }
      if (!template) {
        const { data, error } = await templateSelect().eq('is_default', true).limit(1).maybeSingle()
        if (cancelled) return
        if (error) {
          setDaysError(error.message)
          setDays([])
          setDaysLoading(false)
          return
        }
        template = (data as (ShiftTemplateLike & { name?: string | null }) | null) ?? null
      }
      if (!settingsRes.ok) return
      const settings = settingsRes.settings
      const custom = (companyRes.data?.custom_settings ?? {}) as Record<string, unknown>
      const lateMin = Number(custom.late_threshold_minutes ?? 30) || 30
      const otMin = Number(custom.ot_start_after_minutes ?? 30) || 30
      const sessionOpts = {
        employeeId: payment!.employee_id,
        dailyHours: Number((empRow as { daily_hours?: number | null } | null)?.daily_hours) || 8,
        lateThresholdMinutes: lateMin,
        otStartAfterMinutes: otMin,
        shiftTemplate: template,
        timeZone: settings.company_timezone,
      }
      const punches = (punchRes.data ?? []) as PunchLike[]
      let rows = buildPunchSessions(punches, sessionOpts).filter(row => {
        const day = toLocalDateStr(row.clockIn, settings.company_timezone)
        return day >= periodStart && day <= periodEnd
      })
      const leaveDays = ((leaveRes.data ?? []) as { start_date: string; end_date: string; leave_type: string }[])
        .flatMap(leave => eachDateInclusive(leave.start_date, leave.end_date)
          .filter(day => day >= periodStart && day <= periodEnd)
          .map(day => ({ date: day, leave_type: leave.leave_type })))
      rows = mergeNonWorkDays(
        rows,
        (absenceRes.data ?? []) as { date: string; reason?: string | null; note?: string | null }[],
        leaveDays,
        sessionOpts,
      )

      setTemplateLabel(template?.name
        ? (usedPersonal ? template.name : `${template.name} (company default)`)
        : null)
      const times = template as {
        start_time?: string | null
        end_time?: string | null
        weekend_start_time?: string | null
        weekend_end_time?: string | null
      } | null
      const person = empRow as { work_days_weekly?: number | null; vat_applies?: boolean | null } | null
      setDaysPerWeek(Number(person?.work_days_weekly) || 5)
      setVatApplies(Boolean(person?.vat_applies))
      setWeekdayHours(clockRange(times?.start_time, times?.end_time))
      setWeekendHours(clockRange(times?.weekend_start_time, times?.weekend_end_time))
      setDays(rows)
      setDaysLoading(false)
      const named = await enrichSessionsWithPlaceNames(supabase, payment!.company_id, rows)
      if (!cancelled) setDays(named)
    }
    void loadDays()
    return () => { cancelled = true }
  }, [payment?.id, payment?.employee_id, payment?.company_id, payment?.period_start, payment?.period_end])

  async function saveVat(next: boolean) {
    if (!payment) return
    setVatSaving(true)
    setErrorMsg(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('employees')
      .update({ vat_applies: next })
      .eq('id', payment.employee_id)
      .eq('company_id', payment.company_id)
    setVatSaving(false)
    if (error) {
      setErrorMsg(error.message)
      return
    }
    setVatApplies(next)
  }

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
    setErrorMsg(null)
    const supabase = createClient()

    const { data: lockRow, error: lockErr } = await supabase
      .from('payroll_period_locks')
      .select('company_id')
      .eq('company_id', payment.company_id)
      .eq('period_start', payment.period_start)
      .eq('period_end', payment.period_end)
      .maybeSingle()
    if (lockErr) {
      setBusy(false)
      setErrorMsg(lockErr.message)
      return
    }
    if (lockRow) {
      setBusy(false)
      setErrorMsg('This payroll period is locked and cannot be recalculated.')
      return
    }

    const result = await recalculatePayslip(supabase, payment.company_id, paymentId, {
      payFullBaseSalary: payFullSalary,
      waivePenalties,
      manualPayeOverride: manualPaye ? parseFloat(manualPaye) : null,
      manualAdjustment: extraDeduction ? parseFloat(extraDeduction) : null,
      bonusAmount: bonusAmount ? parseFloat(bonusAmount) : null,
    })
    // Persist note fields separately (engine doesn't write notes)
    const { error: noteErr } = await supabase.from('payment_approvals').update({
      adjustment_note: adjustmentNote || null,
      bonus_note: bonusNote || null,
    }).eq('id', paymentId)

    setBusy(false)
    if (!result.ok) {
      setErrorMsg(result.message)
      return
    }
    if (noteErr) {
      setErrorMsg(`Recalculated, but notes failed to save: ${noteErr.message}`)
      await load()
      return
    }
    await load()
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
      <style>{`
        @media print {
          [data-noprint] { display: none !important; }
          body { background: white; }
          .h-full { height: auto; }
          .overflow-y-auto { overflow: visible; }
        }
      `}</style>

      {/* Header bar */}
      <div data-noprint className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/payroll" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary truncate">{empName}</h1>
          <p className="text-text-secondary text-sm">
            {payment.period_start && payment.period_end
              ? `${fmtDate(payment.period_start)} – ${fmtDate(payment.period_end)}`
              : (payment.period_label ?? '—')}
          </p>
          <div className="flex gap-2 mt-2">
            {([
              ['pay', 'Payslip'],
              ['timesheet', 'Timesheet'],
              ['schedule', 'Schedule'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSlipTab(id)}
                className={`h-8 px-3 text-[12px] rounded-md border ${slipTab === id ? 'bg-primary text-white border-primary' : 'bg-surface-dark text-text-primary border-border'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <StatusBadge label={payment.status} bg={stBg(payment.status)} fg={stFg(payment.status)} />
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 h-9 px-3 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-secondary font-medium hover:border-primary hover:text-primary transition-colors"
        >
          <span className="material-icons text-[16px]">print</span>
          Print
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">

        {errorMsg && (
          <p className="text-error text-[13px]">{errorMsg}</p>
        )}

        <div className={slipTab === 'pay' ? 'space-y-4' : 'hidden print:block print:space-y-4'}>
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
        </div>

        <div className={slipTab === 'timesheet' ? 'space-y-4' : 'hidden print:block print:space-y-4'}>
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-label">DAYS ATTENDED</p>
              <p className="text-[12px] text-text-secondary mt-1">
                {daysLoading
                  ? 'Loading this pay period…'
                  : `${days.filter(day => !day.isOpen && !day.isAbsentDay && !day.isLeaveDay).length} finished days in this pay period.`}
                {templateLabel ? ` Late and hours follow ${templateLabel}.` : ' No time template is applied, so late and overtime clocks are not used.'}
              </p>
            </div>
            {payment.period_start && payment.period_end && (
              <Link
                href={`/dashboard/employees/${payment.employee_id}?tab=attendance&from=${payment.period_start}&to=${payment.period_end}`}
                className="text-[12px] text-primary shrink-0 hover:opacity-80"
              >
                Full attendance
              </Link>
            )}
          </div>
          {daysError && <p className="text-error text-[13px]">{daysError}</p>}
          {!daysLoading && days.length === 0 && !daysError && (
            <p className="text-[13px] text-text-secondary">No clock-ins in this pay period.</p>
          )}
          {days.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 980 }}>
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Time In</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">In Location</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Time Out</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Out Location</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Reg</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">OT</th>
                    <th className="text-right px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Total</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-text-disabled uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(row => {
                    const kind = row.isAbsentDay ? 'absent' : row.isLeaveDay ? 'leave' : 'in'
                    const late = lateFlag(row)
                    const early = earlyFlag(row)
                    const notes = [late, early, row.notes ?? row.statusNote ?? ''].filter(Boolean).join(' · ')
                    return (
                      <tr key={`${row.clockInPunchId ?? row.clockIn.toISOString()}-${kind}`} className="border-b border-divider last:border-0">
                        <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{fmtSessionDate(row.clockIn)}</td>
                        <td className={`px-4 py-3 font-medium whitespace-nowrap ${
                          row.isAbsentDay ? 'text-error' : row.isLeaveDay ? 'text-warning' : row.isLate ? 'text-error' : 'text-success'
                        }`}>
                          {fmtSessionTime(row.clockIn, kind)}
                          {row.isOpen && !row.isAbsentDay && !row.isLeaveDay && (
                            <span className="ml-1 text-[10px] text-warning font-semibold">OPEN</span>
                          )}
                          {late && <span className="block text-[10px] text-error font-semibold">{late}</span>}
                        </td>
                        <td className="px-4 py-3 text-text-secondary max-w-[160px] truncate">
                          {row.isAbsentDay || row.isLeaveDay ? '—' : locationDisplay(row.clockInAddress, row.clockInLat, row.clockInLng)}
                        </td>
                        <td className="px-4 py-3 text-text-primary whitespace-nowrap">
                          {fmtSessionTime(row.clockOut, 'out')}
                          {early && <span className="block text-[10px] text-warning font-semibold">{early}</span>}
                        </td>
                        <td className="px-4 py-3 text-text-secondary max-w-[160px] truncate">
                          {row.isAbsentDay || row.isLeaveDay ? '—' : locationDisplay(row.clockOutAddress, row.clockOutLat, row.clockOutLng)}
                        </td>
                        <td className="px-4 py-3 text-right text-text-primary">{row.regularHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-right text-warning font-medium">
                          {row.overtimeHours > 0 ? row.overtimeHours.toFixed(1) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-text-primary">{totalHrsDisplay(row)}</td>
                        <td className="px-4 py-3">
                          <AttendanceNote note={notes} context={fmtSessionDate(row.clockIn)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>

        <div className={slipTab === 'pay' ? 'space-y-4' : 'hidden print:block print:space-y-4'}>
        {/* HR Adjustments — shown when payslip is still pending */}
        {payment.status === 'pending' && (
          <div data-noprint className="card p-4 space-y-3">
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

        <div className={slipTab === 'schedule' ? 'space-y-4' : 'hidden print:block print:space-y-4'}>
          <div className="card p-4 space-y-3">
            <p className="section-label">TIME TEMPLATE</p>
            <p className="text-[14px] text-text-primary font-medium">{templateLabel ?? 'No template'}</p>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-divider">
                  <td className="data-td text-text-secondary text-[13px]">Expected weekday times</td>
                  <td className="data-td text-right text-[13px]">{weekdayHours ?? '—'}</td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="data-td text-text-secondary text-[13px]">Expected weekend times</td>
                  <td className="data-td text-right text-[13px]">{weekendHours ?? 'Not set'}</td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="data-td text-text-secondary text-[13px]">Days a week</td>
                  <td className="data-td text-right text-[13px]">{daysPerWeek}</td>
                </tr>
                <tr>
                  <td className="data-td text-text-secondary text-[13px]">Required working days this month</td>
                  <td className="data-td text-right text-[13px]">
                    {payment.period_start && payment.period_end
                      ? requiredWorkingDays(payment.period_start, payment.period_end, daysPerWeek)
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-[12px] text-text-secondary">
              Required days count Monday first. Five days a week is Monday to Friday. Six includes Saturday.
            </p>
          </div>
          <div className="card p-4 space-y-3">
            <p className="section-label">VAT</p>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] text-text-primary">VAT applies to this person</p>
                <p className="text-[12px] text-text-secondary mt-1">This does not change PAYE or UIF. It records whether VAT applies.</p>
              </div>
              <Toggle checked={vatApplies} onChange={v => { void saveVat(v) }} disabled={vatSaving} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
