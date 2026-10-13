'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Toggle } from '@/components/Toggle'
import { PayrollLineItemsTable } from '@/components/payroll-line-items-table'
import { recalculatePayslip } from '@/lib/payroll'
import { isUnpaidLeave } from '@/lib/payroll/leave-days'
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

type PersonPay = {
  monthly_salary: number
  hourly_rate: number
  daily_rate: number
  daily_hours: number
  work_days_weekly: number
  uif_fixed_amount: number
  uif_exempt: boolean
  employment_date: string | null
  termination_date: string | null
  pay_full_monthly_salary: boolean
}

const EMPTY_PERSON_PAY: PersonPay = {
  monthly_salary: 0,
  hourly_rate: 0,
  daily_rate: 0,
  daily_hours: 8,
  work_days_weekly: 5,
  uif_fixed_amount: 0,
  uif_exempt: false,
  employment_date: null,
  termination_date: null,
  pay_full_monthly_salary: false,
}

function inPayPeriod(date: string | null, start?: string | null, end?: string | null): boolean {
  if (!date || !start || !end) return false
  return date >= start && date <= end
}

function ratesFromSalary(salary: number, daysPerWeek: number, dailyHours: number): { daily: number; hourly: number } {
  const days = daysPerWeek > 0 ? daysPerWeek : 5
  const hours = dailyHours > 0 ? dailyHours : 8
  const daily = salary / ((days * 52) / 12)
  return { daily, hourly: daily / hours }
}

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
  const [salaryInput, setSalaryInput] = useState('')
  const [uifInput, setUifInput] = useState('')
  const [personPay, setPersonPay] = useState<PersonPay>(EMPTY_PERSON_PAY)
  const [leaveLines, setLeaveLines] = useState<{ start: string; end: string; type: string; unpaid: boolean }[]>([])

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
      setLeaveLines(((leaveRes.data ?? []) as { start_date: string; end_date: string; leave_type: string | null }[]).map(row => ({
        start: row.start_date,
        end: row.end_date,
        type: row.leave_type || 'Leave',
        unpaid: isUnpaidLeave(row.leave_type || ''),
      })))

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

    const { data: person, error: personErr } = await supabase
      .from('employees')
      .select('monthly_salary, hourly_rate, daily_rate, daily_hours, work_days_weekly, uif_fixed_amount, uif_exempt, employment_date, termination_date, pay_full_monthly_salary')
      .eq('id', p.employee_id)
      .eq('company_id', p.company_id)
      .maybeSingle()
    if (personErr) setErrorMsg(personErr.message)
    if (person) {
      const row = person as PersonPay
      const monthly = Number(row.monthly_salary) || 0
      const uifFixed = Number(row.uif_fixed_amount) || 0
      setPersonPay({
        monthly_salary: monthly,
        hourly_rate: Number(row.hourly_rate) || 0,
        daily_rate: Number(row.daily_rate) || 0,
        daily_hours: Number(row.daily_hours) || 8,
        work_days_weekly: Number(row.work_days_weekly) || 5,
        uif_fixed_amount: uifFixed,
        uif_exempt: Boolean(row.uif_exempt),
        employment_date: row.employment_date ?? null,
        termination_date: row.termination_date ?? null,
        pay_full_monthly_salary: Boolean(row.pay_full_monthly_salary),
      })
      setSalaryInput(monthly > 0 ? String(monthly) : '')
      setUifInput(uifFixed > 0 ? String(uifFixed) : '')
    }

    setLoading(false)
  }

  async function applyPayslip() {
    if (!payment || payment.status !== 'pending' || !payment.period_start || !payment.period_end) return
    setBusy(true)
    setErrorMsg(null)
    const supabase = createClient()

    const salary = salaryInput.trim() === '' ? 0 : Number(salaryInput)
    const uif = uifInput.trim() === '' ? 0 : Number(uifInput)
    if (!Number.isFinite(salary) || salary < 0) {
      setBusy(false)
      setErrorMsg('Enter a full month salary of zero or more.')
      return
    }
    if (!Number.isFinite(uif) || uif < 0) {
      setBusy(false)
      setErrorMsg('Enter a UIF amount of zero or more, or leave it blank to use the company percent.')
      return
    }

    const rates = salary > 0
      ? ratesFromSalary(salary, personPay.work_days_weekly, personPay.daily_hours)
      : { daily: personPay.daily_rate, hourly: personPay.hourly_rate }
    const employeeUpdate = salary > 0
      ? { monthly_salary: salary, daily_rate: rates.daily, hourly_rate: rates.hourly, uif_fixed_amount: uif }
      : { monthly_salary: salary, uif_fixed_amount: uif }
    const { error: empErr } = await supabase
      .from('employees')
      .update(employeeUpdate)
      .eq('id', payment.employee_id)
      .eq('company_id', payment.company_id)
    if (empErr) {
      setBusy(false)
      setErrorMsg(empErr.message)
      return
    }

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
      adjustmentNote: adjustmentNote.trim() || null,
      bonusAmount: bonusAmount ? parseFloat(bonusAmount) : null,
      bonusNote: bonusNote.trim() || null,
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
  const slip = payment as EmployeePayment & {
    working_days?: number | null
    leave_days?: number | null
    unpaid_leave_days?: number | null
    base_salary?: number | null
  }
  const canEdit = payment.status === 'pending'
  const leaveDays = slip.leave_days ?? 0
  const unpaidLeaveDays = slip.unpaid_leave_days ?? 0
  const paidLeaveDays = Math.max(0, leaveDays - unpaidLeaveDays)
  const joinedThisMonth = inPayPeriod(personPay.employment_date, payment.period_start, payment.period_end)
  const leftThisMonth = inPayPeriod(personPay.termination_date, payment.period_start, payment.period_end)
  const paysFullMonth = payFullSalary || personPay.pay_full_monthly_salary
  const uifOnSlip = deductionLines.find(line => line.label.trim().toLowerCase() === 'uif')
  const inputClass = 'dark-entry w-full h-9 px-2 text-[13px]'

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
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="section-label">THIS MONTH</p>
            <p className="text-[12px] text-text-secondary mt-1">What happened in this pay period, before any pay changes.</p>
          </div>
          <table className="w-full">
            <tbody>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Working days</td>
                <td className="data-td text-right text-[13px] w-[160px]">{slip.working_days ?? 0}</td>
              </tr>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Required working days</td>
                <td className="data-td text-right text-[13px]">
                  {payment.period_start && payment.period_end
                    ? requiredWorkingDays(payment.period_start, payment.period_end, daysPerWeek)
                    : '—'}
                </td>
              </tr>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Leave days</td>
                <td className="data-td text-right text-[13px]">{leaveDays}</td>
              </tr>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Absent days</td>
                <td className={`data-td text-right text-[13px] ${(payment.absent_days ?? 0) > 0 ? 'text-error' : ''}`}>{payment.absent_days ?? 0}</td>
              </tr>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Regular hours</td>
                <td className="data-td text-right text-[13px]">{(payment.regular_hours ?? 0).toFixed(1)}h</td>
              </tr>
              <tr className="bg-surface-card border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Overtime hours</td>
                <td className="data-td text-right text-[13px]">{(payment.overtime_hours ?? 0).toFixed(1)}h</td>
              </tr>
              <tr className="bg-surface-card">
                <td className="data-td text-text-primary text-[13px]">
                  <p>VAT applies</p>
                  <p className="text-[11px] text-text-secondary mt-0.5">Saved on this person. It does not change PAYE or UIF.</p>
                </td>
                <td className="data-td text-right">
                  <span className="hidden print:inline text-[13px]">{vatApplies ? 'Yes' : 'No'}</span>
                  <span className="print:hidden inline-flex items-center gap-2">
                    <span className="text-[12px] text-text-secondary">{vatApplies ? 'Yes' : 'No'}</span>
                    <Toggle checked={vatApplies} onChange={v => { void saveVat(v) }} disabled={vatSaving} />
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card p-4 space-y-3">
          <div>
            <p className="section-label">SALARY AND DEDUCTIONS</p>
            <p className="text-[12px] text-text-secondary mt-1">
              The full month salary and UIF are saved on the person, so the next payslip uses them too. The extra deduction is only for this payslip.
            </p>
          </div>
          {canEdit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[12px] text-text-secondary">Full month salary (R)</span>
                <input type="number" min="0" step="0.01" value={salaryInput} onChange={e => setSalaryInput(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-secondary">UIF amount (R)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={uifInput}
                  onChange={e => setUifInput(e.target.value)}
                  placeholder={personPay.uif_exempt ? 'Exempt' : 'Company percent'}
                  disabled={personPay.uif_exempt}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-secondary">Extra deduction name</span>
                <input type="text" value={adjustmentNote} onChange={e => setAdjustmentNote(e.target.value)} placeholder="e.g. Staff loan" className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-secondary">Extra deduction amount (R)</span>
                <input type="number" min="0" step="0.01" value={extraDeduction} onChange={e => setExtraDeduction(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-secondary">Extra pay name</span>
                <input type="text" value={bonusNote} onChange={e => setBonusNote(e.target.value)} placeholder="e.g. Bonus" className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[12px] text-text-secondary">Extra pay amount (R)</span>
                <input type="number" min="0" step="0.01" value={bonusAmount} onChange={e => setBonusAmount(e.target.value)} className={`${inputClass} mt-1`} />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[12px] text-text-secondary">PAYE amount (R)</span>
                <input type="number" min="0" step="0.01" value={manualPaye} onChange={e => setManualPaye(e.target.value)} placeholder="Leave blank to calculate" className={`${inputClass} mt-1 sm:max-w-xs`} />
              </label>
            </div>
          ) : (
            <table className="w-full">
              <tbody>
                <tr className="border-b border-divider">
                  <td className="py-2 text-[13px] text-text-primary">Full month salary</td>
                  <td className="py-2 text-right text-[13px]">{fmtR(personPay.monthly_salary)}</td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="py-2 text-[13px] text-text-primary">UIF</td>
                  <td className="py-2 text-right text-[13px]">{personPay.uif_exempt ? 'Exempt' : uifOnSlip ? fmtR(uifOnSlip.amount) : fmtR(personPay.uif_fixed_amount)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-[13px] text-text-primary">{adjustmentNote || 'Extra deduction'}</td>
                  <td className="py-2 text-right text-[13px]">{extraDeduction ? fmtR(Number(extraDeduction)) : '—'}</td>
                </tr>
              </tbody>
            </table>
          )}
          {canEdit && (
            <p className="text-[12px] text-text-secondary">
              {personPay.uif_exempt
                ? 'This person is exempt from UIF.'
                : `UIF on this payslip is ${uifOnSlip ? fmtR(uifOnSlip.amount) : 'not calculated yet'}. Leave the amount blank to keep the company percent.`}
            </p>
          )}
        </div>

        <div className="card p-4 space-y-3">
          <div>
            <p className="section-label">ABSENCE</p>
            <p className="text-[12px] text-text-secondary mt-1">
              {(payment.absent_days ?? 0) === 0
                ? 'No absent days in this month.'
                : `${payment.absent_days} absent day${payment.absent_days === 1 ? '' : 's'} in this month.`}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] text-text-primary">Pay these absent days</p>
              <p className="text-[12px] text-text-secondary mt-1">
                On means this payslip does not deduct absence, late arrivals, early departures, or unpaid leave.
              </p>
            </div>
            <Toggle checked={waivePenalties} onChange={setWaivePenalties} disabled={!canEdit} />
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div>
            <p className="section-label">LEAVE AND EMPLOYMENT DATES</p>
            <p className="text-[12px] text-text-secondary mt-1">
              Paid leave stays in the salary. Unpaid leave is deducted unless absent days are being paid.
            </p>
          </div>
          <table className="w-full">
            <tbody>
              <tr className="border-b border-divider">
                <td className="py-2 text-[13px] text-text-primary">Paid leave</td>
                <td className="py-2 text-right text-[13px]">{paidLeaveDays} day{paidLeaveDays === 1 ? '' : 's'}</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="py-2 text-[13px] text-text-primary">Unpaid leave</td>
                <td className="py-2 text-right text-[13px]">{unpaidLeaveDays} day{unpaidLeaveDays === 1 ? '' : 's'}</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="py-2 text-[13px] text-text-primary">Started</td>
                <td className="py-2 text-right text-[13px]">{personPay.employment_date ? fmtDate(personPay.employment_date) : 'Not set'}</td>
              </tr>
              <tr>
                <td className="py-2 text-[13px] text-text-primary">Left</td>
                <td className="py-2 text-right text-[13px]">{personPay.termination_date ? fmtDate(personPay.termination_date) : 'Still employed'}</td>
              </tr>
            </tbody>
          </table>
          {leaveLines.length > 0 && (
            <div className="space-y-1">
              {leaveLines.map(line => (
                <p key={`${line.start}-${line.end}-${line.type}`} className="text-[13px] text-text-primary">
                  {line.type} · {fmtDate(line.start)} – {fmtDate(line.end)} · {line.unpaid ? 'Unpaid' : 'Paid'}
                </p>
              ))}
            </div>
          )}
          <p className="text-[12px] text-text-secondary">
            {joinedThisMonth || leftThisMonth
              ? paysFullMonth
                ? 'They joined or left during this month, and this payslip still pays the full month.'
                : 'They joined or left during this month, so the salary is pro-rated to the days they were employed.'
              : 'They were employed for the whole month, so the full salary applies.'}
            {slip.base_salary != null && personPay.monthly_salary > 0
              ? ` This payslip uses ${fmtR(slip.base_salary)} of the ${fmtR(personPay.monthly_salary)} month.`
              : ''}
          </p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] text-text-primary">Pay the full month</p>
              <p className="text-[12px] text-text-secondary mt-1">
                {personPay.pay_full_monthly_salary
                  ? 'This person is already set to receive the full month on every payslip.'
                  : 'Use this when they joined or left mid-month and should still receive the full salary.'}
              </p>
            </div>
            <Toggle checked={payFullSalary || personPay.pay_full_monthly_salary} onChange={setPayFullSalary} disabled={!canEdit || personPay.pay_full_monthly_salary} />
          </div>
          {canEdit && (
            <button onClick={applyPayslip} disabled={busy} className="btn-primary w-full h-11 text-[14px]">
              {busy ? 'Updating…' : 'Update payslip'}
            </button>
          )}
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
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="section-label">CALCULATED PAY</p>
            <p className="text-[12px] text-text-secondary mt-1">These amounts follow the salary, absence, and leave choices above.</p>
          </div>
          <table className="w-full">
            <tbody>
              <tr className="border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Regular pay</td>
                <td className="data-td text-right text-[13px] w-[140px]">{fmtR(payment.regular_pay ?? 0)}</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Overtime pay</td>
                <td className="data-td text-right text-[13px]">{fmtR(payment.overtime_pay ?? 0)}</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Gross pay</td>
                <td className="data-td text-right text-[13px]">{fmtR(payment.gross_pay)}</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="data-td text-text-primary text-[13px]">Deductions</td>
                <td className="data-td text-right text-[13px] text-error">{fmtR(payment.deductions ?? 0)}</td>
              </tr>
              <tr className="bg-surface-elevated">
                <td className="data-td text-text-primary font-bold text-[14px]">Net pay</td>
                <td className="data-td text-right font-bold text-[16px] text-text-primary">{fmtR(payment.net_pay)}</td>
              </tr>
            </tbody>
          </table>
        </div>

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
        </div>
      </div>
    </div>
  )
}
