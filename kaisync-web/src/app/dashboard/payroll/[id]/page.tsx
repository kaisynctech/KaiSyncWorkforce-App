'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Toggle } from '@/components/Toggle'
import { approvePaymentRun, releasePayslipToEmployee, savePayslipLines, type PayslipLineAmounts } from '@/lib/payroll'
import { downloadPayslipTemplatePdf, imageUrlToDataUrl } from '@/lib/payslip-pdf'
import { executeWithStepUp } from '@/lib/step-up'
import { StepUpDialog } from '@/components/step-up-dialog'
import { isUnpaidLeave } from '@/lib/payroll/leave-days'
import { computeLeaveSummary, type LeaveSummary } from '@/lib/leave-policy'
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
import type { EmployeePayment, PayrollLineItem, PayrollAuditEntry } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (s: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s))

function fmtDmy(s: string): string {
  const [year, month, day] = s.slice(0, 10).split('-')
  if (!year || !month || !day) return s
  return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`
}

function parseDmy(value: string): string | null {
  const match = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const slipField = 'h-10 w-full rounded-md border border-border bg-surface-elevated px-2 text-[13px] text-text-primary outline-none placeholder:text-text-disabled'
const slipFieldQuiet = 'h-8 w-full rounded-md border border-border/70 bg-transparent px-2 text-[12px] text-text-primary outline-none placeholder:text-text-disabled'

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
  uif_rate_percent: number
  bank_name: string | null
  bank_branch_code: string | null
  bank_account: string | null
  account_type: string | null
  employee_code: string | null
  id_number: string | null
  overtime_rate: number
}

type SlipLines = {
  regular: string
  overtime: string
  bonus: string
  incentive: string
  refund: string
  uif: string
  paye: string
  loanDeduction: string
  loanBalance: string
  unpaidLeave: string
}

function moneyText(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, value) : 0
  return n.toFixed(2)
}

function moneyValue(value: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

const EMPTY_LINES: SlipLines = {
  regular: '0.00',
  overtime: '0.00',
  bonus: '0.00',
  incentive: '0.00',
  refund: '0.00',
  uif: '0.00',
  paye: '0.00',
  loanDeduction: '0.00',
  loanBalance: '0.00',
  unpaidLeave: '0.00',
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
  uif_rate_percent: 0,
  bank_name: null,
  bank_branch_code: null,
  bank_account: null,
  account_type: null,
  employee_code: null,
  id_number: null,
  overtime_rate: 0,
}

function inPayPeriod(date: string | null, start?: string | null, end?: string | null): boolean {
  if (!date || !start || !end) return false
  return date >= start && date <= end
}

function absencePayWasChosen(audit: PayrollAuditEntry[] | null | undefined): boolean {
  return (audit ?? []).some(entry => (entry.detail ?? '').includes('absence pay'))
}

function SessionTable({ rows }: { rows: PunchSessionRow[] }) {
  if (rows.length === 0) return <p className="text-[13px] text-text-secondary">None in this month.</p>
  return (
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
          {rows.map(row => {
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
  )
}

export default function PayslipDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const paymentId = params.id

  const [payment, setPayment] = useState<EmployeePayment | null>(null)
  const [deductionLines, setDeductionLines] = useState<PayrollLineItem[]>([])
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
  const [uifTouched, setUifTouched] = useState(false)
  const [uifRate, setUifRate] = useState(1)
  const [uifCeiling, setUifCeiling] = useState(17712)
  const [addingExtra, setAddingExtra] = useState(false)
  const [leaveBalances, setLeaveBalances] = useState<LeaveSummary[]>([])
  const [lines, setLines] = useState<SlipLines>(EMPTY_LINES)
  const [personPay, setPersonPay] = useState<PersonPay>(EMPTY_PERSON_PAY)
  const [companyName, setCompanyName] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [fullName, setFullName] = useState('')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [employeeIdNumber, setEmployeeIdNumber] = useState('')
  const [incomeTaxNumber, setIncomeTaxNumber] = useState('')
  const [employmentDateText, setEmploymentDateText] = useState('')
  const [hourlyRateText, setHourlyRateText] = useState('0.00')
  const [overtimeRateText, setOvertimeRateText] = useState('0.00')
  const [paidLeaveText, setPaidLeaveText] = useState('')
  const [sickLeaveText, setSickLeaveText] = useState('')
  const overtimeRateSaved = useRef<number | null>(null)
  const paidLeaveSaved = useRef<number | null>(null)
  const sickLeaveSaved = useRef<number | null>(null)
  const paidLeaveShown = useRef('')
  const sickLeaveShown = useRef('')
  const [bankName, setBankName] = useState('')
  const [bankBranch, setBankBranch] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [otMultiplier, setOtMultiplier] = useState(1.5)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [stepUpBusy, setStepUpBusy] = useState(false)
  const [stepUpError, setStepUpError] = useState<string | null>(null)
  const [stepUpMessage, setStepUpMessage] = useState('Re-enter your password to save these bank details. This opens a 15-minute verification window.')
  const [releasing, setReleasing] = useState(false)
  const stepUpResolverRef = useRef<((password: string | null) => void) | null>(null)
  const [leaveLines, setLeaveLines] = useState<{ start: string; end: string; type: string; unpaid: boolean }[]>([])

  function promptStepUpPassword(message = 'Re-enter your password to save these bank details. This opens a 15-minute verification window.'): Promise<string | null> {
    setStepUpMessage(message)
    setStepUpError(null)
    setStepUpBusy(false)
    setStepUpOpen(true)
    return new Promise(resolve => {
      stepUpResolverRef.current = resolve
    })
  }

  function finishStepUpPrompt(password: string | null) {
    const resolve = stepUpResolverRef.current
    stepUpResolverRef.current = null
    setStepUpOpen(false)
    setStepUpBusy(false)
    setStepUpError(null)
    resolve?.(password)
  }

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
      deductions_breakdown: PayrollLineItem[] | null
      audit_log:            PayrollAuditEntry[] | null
      leave_days:           number | null
      working_days:         number | null
    }
    setPayment(p)
    setDeductionLines(p.deductions_breakdown ?? [])
    setAuditEntries(p.audit_log ?? [])

    setPayFullSalary(p.pay_full_base_salary ?? false)
    setWaivePenalties(absencePayWasChosen(p.audit_log) ? Boolean(p.waive_penalties) : true)
    setManualPaye(p.manual_paye_override != null ? String(p.manual_paye_override) : '')
    setExtraDeduction(p.manual_adjustment != null && p.manual_adjustment > 0 ? String(p.manual_adjustment) : '')
    setAdjustmentNote(p.adjustment_note ?? '')
    setAddingExtra(Boolean(p.adjustment_note) || (p.manual_adjustment ?? 0) > 0)
    setBonusAmount(p.bonus_amount != null && p.bonus_amount > 0 ? String(p.bonus_amount) : '')
    setBonusNote(p.bonus_note ?? '')

    const settingsRes = await loadPayrollSettings(supabase, p.company_id)
    let companyOt = 1.5
    if (settingsRes.ok) {
      companyOt = settingsRes.settings.overtime_multiplier > 0 ? settingsRes.settings.overtime_multiplier : 1.5
      setUifRate(settingsRes.settings.uif_rate_percent > 0 ? settingsRes.settings.uif_rate_percent : 1)
      setUifCeiling(settingsRes.settings.uif_ceiling_monthly > 0 ? settingsRes.settings.uif_ceiling_monthly : 17712)
      setOtMultiplier(companyOt)
    }

    const year = (p.period_start ?? '').slice(0, 4)
    let computedPaid: number | null = null
    let computedSick: number | null = null
    if (year) {
      const { data: yearLeave, error: yearLeaveErr } = await supabase
        .from('leave_requests')
        .select('leave_type, start_date, total_days, status')
        .eq('company_id', p.company_id)
        .eq('employee_id', p.employee_id)
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`)
      if (!yearLeaveErr) {
        const summary = computeLeaveSummary((yearLeave ?? []) as { leave_type: string; start_date: string; total_days: number; status: string }[])
        setLeaveBalances(summary)
        computedPaid = summary.find(item => item.leave_type === 'Annual Leave')?.days_remaining ?? null
        computedSick = summary.find(item => item.leave_type === 'Sick Leave')?.days_remaining ?? null
      }
    }

    const [{ data: person, error: personErr }, { data: company, error: companyErr }] = await Promise.all([
      supabase
        .from('employees')
        .select('name, surname, monthly_salary, hourly_rate, daily_rate, daily_hours, work_days_weekly, uif_fixed_amount, uif_rate_percent, uif_exempt, employment_date, termination_date, pay_full_monthly_salary, bank_name, bank_branch_code, bank_account, account_type, employee_code, id_number, tax_number, overtime_rate, overtime_hourly_rate, paid_leave_balance, sick_leave_balance, address')
        .eq('id', p.employee_id)
        .eq('company_id', p.company_id)
        .maybeSingle(),
      supabase
        .from('companies')
        .select('name, address')
        .eq('id', p.company_id)
        .maybeSingle(),
    ])
    if (companyErr) setErrorMsg(companyErr.message)
    const companyRow = company as { name?: string | null; address?: string | null } | null
    setCompanyName(companyRow?.name?.trim() ?? '')
    setCompanyAddress(companyRow?.address?.trim() ?? '')
    setHomeAddress(((person as { address?: string | null } | null)?.address ?? '').trim())
    if (personErr) setErrorMsg(personErr.message)
    if (person) {
      const row = person as PersonPay & {
        name?: string | null
        surname?: string | null
        address?: string | null
        overtime_hourly_rate?: number | null
        paid_leave_balance?: number | null
        sick_leave_balance?: number | null
      }
      const monthly = Number(row.monthly_salary) || 0
      const uifFixed = Number(row.uif_fixed_amount) || 0
      const slipUif = (p.deductions_breakdown ?? []).find(line => line.label.trim().toLowerCase() === 'uif')?.amount ?? 0
      const shownUif = uifFixed > 0 ? uifFixed : slipUif
      setPersonPay({
        monthly_salary: monthly,
        hourly_rate: Number(row.hourly_rate) || 0,
        daily_rate: Number(row.daily_rate) || 0,
        daily_hours: Number(row.daily_hours) || 8,
        work_days_weekly: Number(row.work_days_weekly) || 5,
        uif_fixed_amount: uifFixed,
        uif_exempt: Boolean(row.uif_exempt),
        uif_rate_percent: Number(row.uif_rate_percent) || 0,
        employment_date: row.employment_date ?? null,
        termination_date: row.termination_date ?? null,
        pay_full_monthly_salary: Boolean(row.pay_full_monthly_salary),
        bank_name: row.bank_name ?? null,
        bank_branch_code: row.bank_branch_code ?? null,
        bank_account: row.bank_account ?? null,
        account_type: row.account_type ?? null,
        employee_code: row.employee_code ?? null,
        id_number: row.id_number ?? null,
        overtime_rate: Number(row.overtime_rate) || 0,
      })
      setBankName(row.bank_name ?? '')
      setBankBranch(row.bank_branch_code ?? '')
      setBankAccount(row.bank_account ?? '')
      setFullName(`${row.name ?? ''} ${row.surname ?? ''}`.replace(/\s+/g, ' ').trim())
      setEmployeeNumber(row.employee_code ?? '')
      setEmployeeIdNumber(row.id_number ?? '')
      setIncomeTaxNumber((row as PersonPay & { tax_number?: string | null }).tax_number ?? '')
      setEmploymentDateText(row.employment_date ? fmtDmy(row.employment_date) : '')
      const hourly = Number(row.hourly_rate) || 0
      setHourlyRateText(moneyText(hourly))
      const storedOt = row.overtime_hourly_rate == null ? null : Number(row.overtime_hourly_rate)
      overtimeRateSaved.current = Number.isFinite(storedOt ?? NaN) ? storedOt : null
      const factor = (Number(row.overtime_rate) || 0) > 0 ? Number(row.overtime_rate) : companyOt
      setOvertimeRateText(moneyText(overtimeRateSaved.current ?? hourly * factor))
      const storedPaid = row.paid_leave_balance == null ? null : Number(row.paid_leave_balance)
      const storedSick = row.sick_leave_balance == null ? null : Number(row.sick_leave_balance)
      paidLeaveSaved.current = storedPaid != null && Number.isFinite(storedPaid) ? storedPaid : null
      sickLeaveSaved.current = storedSick != null && Number.isFinite(storedSick) ? storedSick : null
      const paidShown = paidLeaveSaved.current ?? computedPaid
      const sickShown = sickLeaveSaved.current ?? computedSick
      const paidText = paidShown == null ? '' : String(paidShown)
      const sickText = sickShown == null ? '' : String(sickShown)
      paidLeaveShown.current = paidText
      sickLeaveShown.current = sickText
      setPaidLeaveText(paidText)
      setSickLeaveText(sickText)
      setSalaryInput(monthly > 0 ? String(monthly) : '')
      setUifInput(row.uif_exempt ? '' : shownUif > 0 ? shownUif.toFixed(2) : '')
      setUifTouched(uifFixed > 0)
    }

    const savedLines = (p as EmployeePayment & { payslip_lines?: Partial<PayslipLineAmounts> | null }).payslip_lines
    const uifLine = (p.deductions_breakdown ?? []).find(line => line.label.trim().toLowerCase() === 'uif')?.amount ?? 0
    const payeLine = (p.deductions_breakdown ?? []).find(line => line.label.trim().toLowerCase() === 'paye')?.amount ?? 0
    const unpaidLine = (p.deductions_breakdown ?? []).find(line => line.label.trim().toLowerCase().startsWith('unpaid leave'))?.amount ?? 0
    const picked = (saved: number | undefined, fallback: number) => moneyText(saved ?? fallback)
    const monthlySalary = person ? Number((person as PersonPay).monthly_salary) || 0 : 0
    const uifFixedAmount = person ? Number((person as PersonPay).uif_fixed_amount) || 0 : 0
    setLines({
      regular: picked(savedLines?.regular, Number(p.regular_pay) || monthlySalary),
      overtime: picked(savedLines?.overtime, Number(p.overtime_pay) || 0),
      bonus: picked(savedLines?.bonus, Number(p.bonus_amount) || 0),
      incentive: picked(savedLines?.incentive, 0),
      refund: picked(savedLines?.refund, 0),
      uif: picked(savedLines?.uif, uifFixedAmount > 0 ? uifFixedAmount : uifLine),
      paye: picked(savedLines?.paye, p.manual_paye_override ?? payeLine),
      loanDeduction: picked(savedLines?.loanDeduction, Number(p.manual_adjustment) || 0),
      loanBalance: picked(savedLines?.loanBalance, 0),
      unpaidLeave: picked(savedLines?.unpaidLeave, unpaidLine),
    })

    setLoading(false)
  }

  async function saveEmployee(patch: Record<string, string | number | null>): Promise<boolean> {
    if (!payment) return false
    setErrorMsg(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('employees')
      .update(patch)
      .eq('id', payment.employee_id)
      .eq('company_id', payment.company_id)
    if (error) {
      setErrorMsg(error.message)
      return false
    }
    return true
  }

  async function saveAddress(next: string) {
    const trimmed = next.trim()
    setHomeAddress(trimmed)
    await saveEmployee({ address: trimmed || null })
  }

  async function saveName(next: string) {
    const trimmed = next.trim().replace(/\s+/g, ' ')
    if (!trimmed) {
      setErrorMsg('Enter the employee name.')
      return
    }
    const splitAt = trimmed.lastIndexOf(' ')
    const name = splitAt < 0 ? trimmed : trimmed.slice(0, splitAt)
    const surname = splitAt < 0 ? '' : trimmed.slice(splitAt + 1)
    const saved = await saveEmployee({ name, surname })
    if (saved) setFullName(trimmed)
  }

  async function saveEmployeeNumber(next: string) {
    const trimmed = next.trim()
    setEmployeeNumber(trimmed)
    const saved = await saveEmployee({ employee_code: trimmed || null })
    if (saved) setPersonPay(current => ({ ...current, employee_code: trimmed || null }))
  }

  async function saveIncomeTax(next: string) {
    const trimmed = next.trim()
    setIncomeTaxNumber(trimmed)
    await saveEmployee({ tax_number: trimmed || null })
  }

  async function saveEmployeeId(next: string) {
    const trimmed = next.trim()
    setEmployeeIdNumber(trimmed)
    const saved = await saveEmployee({ id_number: trimmed || null })
    if (saved) setPersonPay(current => ({ ...current, id_number: trimmed || null }))
  }

  async function saveEmploymentDate(next: string) {
    const trimmed = next.trim()
    if (!trimmed) {
      const saved = await saveEmployee({ employment_date: null })
      if (saved) {
        setEmploymentDateText('')
        setPersonPay(current => ({ ...current, employment_date: null }))
      }
      return
    }
    const iso = parseDmy(trimmed)
    if (!iso) {
      setErrorMsg('Use the date format 01-10-2026.')
      setEmploymentDateText(personPay.employment_date ? fmtDmy(personPay.employment_date) : '')
      return
    }
    const saved = await saveEmployee({ employment_date: iso })
    if (!saved) return
    setEmploymentDateText(fmtDmy(iso))
    setPersonPay(current => ({ ...current, employment_date: iso }))
  }

  async function saveHourlyRate(next: string) {
    const hourly = moneyValue(next)
    const daily = Math.round(hourly * (personPay.daily_hours > 0 ? personPay.daily_hours : 8) * 100) / 100
    const saved = await saveEmployee({ hourly_rate: hourly, daily_rate: daily })
    if (!saved) {
      setHourlyRateText(moneyText(personPay.hourly_rate))
      return
    }
    setHourlyRateText(moneyText(hourly))
    setPersonPay(current => ({ ...current, hourly_rate: hourly, daily_rate: daily }))
    if (overtimeRateSaved.current == null) {
      const factor = personPay.overtime_rate > 0 ? personPay.overtime_rate : otMultiplier
      setOvertimeRateText(moneyText(hourly * factor))
    }
    if (payment?.status === 'pending') void saveLines(lines)
  }

  async function saveOvertimeRate(next: string) {
    const amount = moneyValue(next)
    if (overtimeRateSaved.current != null && Math.abs(overtimeRateSaved.current - amount) < 0.005) {
      setOvertimeRateText(moneyText(amount))
      return
    }
    const derived = personPay.hourly_rate * (personPay.overtime_rate > 0 ? personPay.overtime_rate : otMultiplier)
    if (overtimeRateSaved.current == null && Math.abs(derived - amount) < 0.005) {
      setOvertimeRateText(moneyText(derived))
      return
    }
    const saved = await saveEmployee({ overtime_hourly_rate: amount })
    if (!saved) {
      setOvertimeRateText(moneyText(overtimeRateSaved.current ?? derived))
      return
    }
    overtimeRateSaved.current = amount
    setOvertimeRateText(moneyText(amount))
  }

  async function saveLeaveBalance(which: 'paid' | 'sick', next: string) {
    const trimmed = next.trim()
    const shown = which === 'paid' ? paidLeaveShown.current : sickLeaveShown.current
    if (trimmed === shown.trim()) return
    const value = trimmed === '' ? null : moneyValue(trimmed)
    const previous = which === 'paid' ? paidLeaveSaved.current : sickLeaveSaved.current
    if (value == null && previous == null) return
    if (value != null && previous != null && Math.abs(value - previous) < 0.005) return
    const column = which === 'paid' ? 'paid_leave_balance' : 'sick_leave_balance'
    const saved = await saveEmployee({ [column]: value })
    if (!saved) return
    const text = value == null ? '' : String(value)
    if (which === 'paid') {
      paidLeaveSaved.current = value
      paidLeaveShown.current = text
      setPaidLeaveText(text)
    } else {
      sickLeaveSaved.current = value
      sickLeaveShown.current = text
      setSickLeaveText(text)
    }
  }

  async function saveBank(next: { name: string; branch: string; account: string }) {
    if (!payment) return
    const name = next.name.trim()
    const branch = next.branch.trim()
    const account = next.account.trim()
    if (
      name === (personPay.bank_name ?? '') &&
      branch === (personPay.bank_branch_code ?? '') &&
      account === (personPay.bank_account ?? '')
    ) return
    setErrorMsg(null)
    const supabase = createClient()
    const result = await executeWithStepUp(
      supabase,
      payment.company_id,
      async () => {
        const { error } = await supabase.rpc('update_employee_banking', {
          p_company_id: payment.company_id,
          p_employee_id: payment.employee_id,
          p_bank_name: name || null,
          p_bank_branch_code: branch || null,
          p_bank_account: account || null,
          p_account_type: personPay.account_type,
        })
        if (error) return { ok: false as const, message: error.message }
        return { ok: true as const, data: undefined }
      },
      promptStepUpPassword,
    )
    if (!result.ok) {
      setErrorMsg(result.message)
      setBankName(personPay.bank_name ?? '')
      setBankBranch(personPay.bank_branch_code ?? '')
      setBankAccount(personPay.bank_account ?? '')
      return
    }
    setBankName(name)
    setBankBranch(branch)
    setBankAccount(account)
    setPersonPay(current => ({
      ...current,
      bank_name: name || null,
      bank_branch_code: branch || null,
      bank_account: account || null,
    }))
  }

  async function saveLines(next: SlipLines, flags?: { payFull?: boolean; waive?: boolean }) {
    if (!payment || payment.status !== 'pending') return
    setBusy(true)
    setErrorMsg(null)
    const supabase = createClient()
    const result = await savePayslipLines(supabase, payment.company_id, paymentId, {
      regular: moneyValue(next.regular),
      overtime: moneyValue(next.overtime),
      bonus: moneyValue(next.bonus),
      incentive: moneyValue(next.incentive),
      refund: moneyValue(next.refund),
      uif: moneyValue(next.uif),
      paye: moneyValue(next.paye),
      loanDeduction: moneyValue(next.loanDeduction),
      loanBalance: moneyValue(next.loanBalance),
      unpaidLeave: moneyValue(next.unpaidLeave),
    }, {
      payFullBaseSalary: flags?.payFull ?? payFullSalary,
      waivePenalties: flags?.waive ?? waivePenalties,
    })
    setBusy(false)
    if (!result.ok) {
      setErrorMsg(result.message)
      return
    }
    setPayment(current => current ? {
      ...current,
      gross_pay: result.data.gross_pay,
      net_pay: result.data.net_pay,
      deductions: result.data.deductions,
      regular_pay: moneyValue(next.regular),
      overtime_pay: moneyValue(next.overtime),
      bonus_amount: moneyValue(next.bonus),
    } : current)
    setPersonPay(current => ({
      ...current,
      monthly_salary: moneyValue(next.regular),
      uif_fixed_amount: moneyValue(next.uif),
    }))
  }

  async function downloadPdf() {
    if (!payment) return
    const supabase = createClient()
    const { data: company } = await supabase
      .from('companies')
      .select('name, address, logo_url')
      .eq('id', payment.company_id)
      .maybeSingle()
    const companyRow = company as { name?: string | null; address?: string | null; logo_url?: string | null } | null
    let logoDataUrl: string | null = null
    if (companyRow?.logo_url) {
      const { data: signed } = await supabase.storage.from('workforce-media').createSignedUrl(companyRow.logo_url, 120)
      if (signed?.signedUrl) logoDataUrl = await imageUrlToDataUrl(signed.signedUrl)
    }
    const paid = paidLeaveText.trim() === '' ? null : moneyValue(paidLeaveText)
    const sick = sickLeaveText.trim() === '' ? null : moneyValue(sickLeaveText)
    downloadPayslipTemplatePdf({
      companyName: companyRow?.name?.trim() || companyName,
      companyAddress: companyRow?.address ?? companyAddress,
      logoDataUrl,
      employeeName: fullName,
      address: homeAddress,
      employeeId: employeeIdNumber,
      incomeTaxNumber,
      employeeNumber,
      employmentDate: personPay.employment_date,
      periodStart: payment.period_start ?? '',
      periodEnd: payment.period_end ?? '',
      hourlyRate: moneyValue(hourlyRateText),
      overtimeRate: moneyValue(overtimeRateText),
      regular: moneyValue(lines.regular),
      overtime: moneyValue(lines.overtime),
      bonus: moneyValue(lines.bonus),
      incentive: moneyValue(lines.incentive),
      refund: moneyValue(lines.refund),
      uif: moneyValue(lines.uif),
      paye: moneyValue(lines.paye),
      loanDeduction: moneyValue(lines.loanDeduction),
      loanBalance: moneyValue(lines.loanBalance),
      unpaidLeave: moneyValue(lines.unpaidLeave),
      bankName,
      bankBranch,
      bankAccount,
      paidTimeOff: paid,
      sickTimeOff: sick,
    })
  }

  async function releaseThisPayslip() {
    if (!payment || payment.status === 'rejected' || payment.shared_with_employee) return
    setReleasing(true)
    setErrorMsg(null)
    const supabase = createClient()
    if (payment.status === 'pending') {
      const approved = await approvePaymentRun(supabase, payment.company_id, payment.id, {
        promptPassword: () => promptStepUpPassword('Re-enter your password to release this payslip. This opens a 15-minute verification window.'),
      })
      if (!approved.ok) {
        setErrorMsg(approved.message)
        setReleasing(false)
        return
      }
      setPayment(current => current ? { ...current, status: 'approved' } : current)
    }
    const released = await releasePayslipToEmployee(supabase, payment.company_id, payment.id)
    setReleasing(false)
    if (!released.ok) {
      setErrorMsg(released.message)
      return
    }
    setPayment(current => current ? { ...current, status: current.status === 'pending' ? 'approved' : current.status, shared_with_employee: true } : current)
    setAuditEntries(current => [...current, { action: 'released', detail: 'Shared with employee', at: new Date().toISOString() }])
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
  const overtimeRows = days.filter(day => !day.isAbsentDay && !day.isLeaveDay && day.overtimeHours > 0)
  const absentRows = days.filter(day => day.isAbsentDay)
  const leaveDayRows = days.filter(day => day.isLeaveDay)
  const grossNow = moneyValue(lines.regular) + moneyValue(lines.overtime) + moneyValue(lines.bonus) + moneyValue(lines.incentive) + moneyValue(lines.refund)
  const deductedNow = moneyValue(lines.uif) + moneyValue(lines.paye) + moneyValue(lines.loanDeduction) + moneyValue(lines.unpaidLeave)
  const netNow = Math.max(0, Math.round((grossNow - deductedNow) * 100) / 100)
  const paidNow = paidLeaveText.trim() === '' ? null : moneyValue(paidLeaveText)
  const sickNow = sickLeaveText.trim() === '' ? null : moneyValue(sickLeaveText)
  const totalTimeOff = paidNow != null && sickNow != null ? Math.round((paidNow + sickNow) * 100) / 100 : null
  const bankField = (value: string, setValue: (next: string) => void, field: 'name' | 'branch' | 'account') => (
    <input
      type="text"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={e => {
        const typed = e.target.value
        void saveBank({
          name: field === 'name' ? typed : bankName,
          branch: field === 'branch' ? typed : bankBranch,
          account: field === 'account' ? typed : bankAccount,
        })
      }}
      placeholder={field === 'name' ? 'Bank name' : field === 'branch' ? 'Branch code' : 'Account number'}
      className={slipFieldQuiet}
    />
  )
  const amountCell = (key: keyof SlipLines) => (
    <td className="px-3 text-right whitespace-nowrap align-middle border-b border-divider">
      {canEdit ? (
        <span className="inline-flex items-center justify-end gap-1">
          <span className="text-[13px] text-text-secondary">R</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={lines[key]}
            onChange={e => setLines(current => ({ ...current, [key]: e.target.value }))}
            onBlur={e => {
              const next = { ...lines, [key]: moneyText(moneyValue(e.target.value)) }
              setLines(next)
              void saveLines(next)
            }}
            className="h-8 w-[6.5rem] rounded-md border border-border/70 bg-transparent px-2 text-right text-[12px] text-text-primary outline-none"
          />
        </span>
      ) : (
        <span className="text-[13px]">{fmtR(moneyValue(lines[key]))}</span>
      )}
    </td>
  )

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
          <h1 className="text-[18px] font-semibold text-text-primary truncate">{fullName || empName}</h1>
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
            <p className="section-label">OVERTIME</p>
            <p className="text-[12px] text-text-secondary mt-1">
              {daysLoading ? 'Loading this pay period…' : `${overtimeRows.length} day${overtimeRows.length === 1 ? '' : 's'} with overtime.`}
            </p>
          </div>
          {!daysLoading && <SessionTable rows={overtimeRows} />}
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-label">ABSENCE</p>
              <p className="text-[12px] text-text-secondary mt-1">
                {daysLoading ? 'Loading this pay period…' : `${absentRows.length} absent day${absentRows.length === 1 ? '' : 's'}.`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[13px] text-text-primary">Pay these absent days</span>
              <Toggle checked={waivePenalties} onChange={v => { setWaivePenalties(v); void saveLines(lines, { waive: v }) }} disabled={!canEdit} />
            </div>
          </div>
          {!daysLoading && <SessionTable rows={absentRows} />}
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
          <SessionTable rows={leaveDayRows} />
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
            <Toggle checked={payFullSalary || personPay.pay_full_monthly_salary} onChange={v => { setPayFullSalary(v); void saveLines(lines, { payFull: v }) }} disabled={!canEdit || personPay.pay_full_monthly_salary} />
          </div>
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
          {days.length > 0 && <SessionTable rows={days} />}
        </div>
        </div>

        <div className={slipTab === 'pay' ? 'space-y-4' : 'hidden print:block print:space-y-4'}>
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-divider">
            <p className="section-label">PAYSLIP</p>
            {(companyName || companyAddress) && (
              <div className="mt-3">
                {companyName && <p className="text-[15px] font-semibold text-text-primary">{companyName}</p>}
                {companyAddress && <p className="text-[13px] text-text-secondary whitespace-pre-line">{companyAddress}</p>}
              </div>
            )}
            <table className="w-full mt-3">
              <tbody>
                <tr className="border-b border-divider">
                  <td className="py-2 pr-3 text-[13px] text-text-secondary whitespace-nowrap w-[168px]">Employee name</td>
                  <td className="py-2 pr-4">
                    <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} onBlur={e => { void saveName(e.target.value) }} placeholder="Name and surname" className={slipField} />
                  </td>
                  <td className="py-2 pr-3 pl-4 text-[13px] text-text-secondary whitespace-nowrap border-l border-divider w-[150px]">Rate</td>
                  <td className="py-2 w-[11rem]">
                    <span className="inline-flex items-center gap-1 w-full">
                      <span className="text-[13px] text-text-secondary">R</span>
                      <input type="number" min="0" step="0.01" value={hourlyRateText} onChange={e => setHourlyRateText(e.target.value)} onBlur={e => { void saveHourlyRate(e.target.value) }} placeholder="0.00" className={slipField} />
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="py-2 pr-3 text-[13px] text-text-secondary align-middle">Employee address</td>
                  <td className="py-2 pr-4" colSpan={3}>
                    <input type="text" value={homeAddress} onChange={e => setHomeAddress(e.target.value)} onBlur={e => { void saveAddress(e.target.value) }} placeholder="Street, suburb, city" className={slipField} />
                  </td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="py-2 pr-3 text-[13px] text-text-secondary whitespace-nowrap">Employee ID</td>
                  <td className="py-2 pr-4">
                    <input type="text" value={employeeIdNumber} onChange={e => setEmployeeIdNumber(e.target.value)} onBlur={e => { void saveEmployeeId(e.target.value) }} placeholder="ID number" className={slipField} />
                  </td>
                  <td className="py-2 pr-3 pl-4 text-[13px] text-text-secondary whitespace-nowrap border-l border-divider">Employee number</td>
                  <td className="py-2">
                    <input type="text" value={employeeNumber} onChange={e => setEmployeeNumber(e.target.value)} onBlur={e => { void saveEmployeeNumber(e.target.value) }} placeholder="Employee number" className={slipField} />
                  </td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="py-2 pr-3 text-[13px] text-text-secondary whitespace-nowrap">Income tax number</td>
                  <td className="py-2 pr-4" colSpan={3}>
                    <input type="text" value={incomeTaxNumber} onChange={e => setIncomeTaxNumber(e.target.value)} onBlur={e => { void saveIncomeTax(e.target.value) }} placeholder="Income tax number" className={slipField} />
                  </td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="py-2 pr-3 text-[13px] text-text-secondary whitespace-nowrap">Employment date</td>
                  <td className="py-2 pr-4">
                    <input type="text" value={employmentDateText} onChange={e => setEmploymentDateText(e.target.value)} onBlur={e => { void saveEmploymentDate(e.target.value) }} placeholder="01-10-2026" className={slipField} />
                  </td>
                  <td className="py-2 pr-3 pl-4 text-[13px] text-text-secondary whitespace-nowrap border-l border-divider">Overtime rate</td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-1 w-full">
                      <span className="text-[13px] text-text-secondary">R</span>
                      <input type="number" min="0" step="0.01" value={overtimeRateText} onChange={e => setOvertimeRateText(e.target.value)} onBlur={e => { void saveOvertimeRate(e.target.value) }} placeholder="0.00" className={slipField} />
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-divider">
                  <td className="py-2 pr-3 text-[13px] text-text-secondary whitespace-nowrap">Pay period begin</td>
                  <td className="py-2 text-[13px] text-text-primary whitespace-nowrap" colSpan={3}>{payment.period_start ? fmtDmy(payment.period_start) : '—'}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-[13px] text-text-secondary whitespace-nowrap">Pay period end</td>
                  <td className="py-2 text-[13px] text-text-primary whitespace-nowrap" colSpan={3}>{payment.period_end ? fmtDmy(payment.period_end) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 720 }}>
              <thead>
                <tr className="bg-primary/10">
                  <th className="text-left px-4 py-2 text-[12px] font-semibold text-text-primary">Earnings</th>
                  <th className="text-right px-4 py-2 text-[12px] font-semibold text-text-primary w-[9.5rem]" />
                  <th className="text-left px-4 py-2 text-[12px] font-semibold text-text-primary border-l border-divider">Deductions</th>
                  <th className="text-right px-4 py-2 text-[12px] font-semibold text-text-primary w-[9.5rem]" />
                </tr>
              </thead>
              <tbody>
                <tr className="h-9">
                  <td className="px-4 text-[13px] border-b border-divider">Regular Earnings</td>
                  {amountCell('regular')}
                  <td className="px-4 text-[13px] border-b border-l border-divider">UIF</td>
                  {amountCell('uif')}
                </tr>
                <tr className="h-9">
                  <td className="px-4 text-[13px] border-b border-divider">Overtime</td>
                  {amountCell('overtime')}
                  <td className="px-4 text-[13px] border-b border-l border-divider">PAYE</td>
                  {amountCell('paye')}
                </tr>
                <tr className="h-9">
                  <td className="px-4 text-[13px] border-b border-divider">Bonus</td>
                  {amountCell('bonus')}
                  <td className="px-4 text-[13px] border-b border-l border-divider">Loan Deduction</td>
                  {amountCell('loanDeduction')}
                </tr>
                <tr className="h-9">
                  <td className="px-4 text-[13px] border-b border-divider">Incentive Pay</td>
                  {amountCell('incentive')}
                  <td className="px-4 text-[13px] border-b border-l border-divider">Loan Balance</td>
                  {amountCell('loanBalance')}
                </tr>
                <tr className="h-9">
                  <td className="px-4 text-[13px] border-b border-divider">Refund</td>
                  {amountCell('refund')}
                  <td className="px-4 text-[13px] border-b border-l border-divider">Unpaid Leave</td>
                  {amountCell('unpaidLeave')}
                </tr>
                <tr className="h-9 font-semibold">
                  <td className="px-4 text-[13px] border-b border-divider">Gross Salary</td>
                  <td className="px-4 text-right text-[13px] whitespace-nowrap border-b border-divider">{fmtR(grossNow)}</td>
                  <td className="px-4 text-[13px] border-b border-l border-divider">Total Deduction</td>
                  <td className="px-4 text-right text-[13px] whitespace-nowrap border-b border-divider">{fmtR(deductedNow)}</td>
                </tr>
                <tr className="h-9 font-semibold">
                  <td className="px-4 text-[13px]">Current NET Salary</td>
                  <td className="px-4 text-right text-[13px] whitespace-nowrap">{fmtR(netNow)}</td>
                  <td className="border-l border-divider" />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <table className="w-full border-t border-divider">
            <thead>
              <tr className="bg-primary/10">
                <th className="text-left px-4 py-2 text-[12px] font-semibold text-text-primary">Payment Information</th>
                <th className="w-[14rem]" />
                <th className="text-left px-4 py-2 text-[12px] font-semibold text-text-primary border-l border-divider">Time Off Balance</th>
                <th className="w-[6rem]" />
              </tr>
            </thead>
            <tbody>
              <tr className="h-9">
                <td className="px-4 text-[13px] border-b border-divider">Bank Name</td>
                <td className="px-3 border-b border-divider">{bankField(bankName, setBankName, 'name')}</td>
                <td className="px-4 text-[13px] border-b border-l border-divider">Paid time off balance</td>
                <td className="px-3 border-b border-divider">
                  <input type="number" min="0" step="0.5" value={paidLeaveText} onChange={e => setPaidLeaveText(e.target.value)} onBlur={e => { void saveLeaveBalance('paid', e.target.value) }} placeholder="0" className={`${slipFieldQuiet} text-right`} />
                </td>
              </tr>
              <tr className="h-9">
                <td className="px-4 text-[13px] border-b border-divider">Branch Code</td>
                <td className="px-3 border-b border-divider">{bankField(bankBranch, setBankBranch, 'branch')}</td>
                <td className="px-4 text-[13px] border-b border-l border-divider">Sick time off balance</td>
                <td className="px-3 border-b border-divider">
                  <input type="number" min="0" step="0.5" value={sickLeaveText} onChange={e => setSickLeaveText(e.target.value)} onBlur={e => { void saveLeaveBalance('sick', e.target.value) }} placeholder="0" className={`${slipFieldQuiet} text-right`} />
                </td>
              </tr>
              <tr className="h-9">
                <td className="px-4 text-[13px]">Account Number</td>
                <td className="px-3">{bankField(bankAccount, setBankAccount, 'account')}</td>
                <td className="px-4 text-[13px] border-l border-divider">Total time off balance</td>
                <td className="px-4 text-right text-[13px] whitespace-nowrap">{totalTimeOff ?? '—'}</td>
              </tr>
            </tbody>
          </table>
          <div className="px-4 py-6 border-t border-divider text-center">
            <p className="text-[12px] text-text-secondary">Net pay</p>
            <p className="text-[22px] font-semibold text-text-primary mt-1">{fmtR(netNow)}</p>
            <p className="text-[12px] text-text-secondary mt-1">This is the amount they will receive.</p>
            <p className="text-[11px] text-text-disabled mt-5">Powered by KaiSync Workforce</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => { void downloadPdf() }}
            className="h-9 px-4 rounded-md border border-border bg-surface text-[13px] font-medium text-text-primary hover:border-primary"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => { void releaseThisPayslip() }}
            disabled={releasing || payment.shared_with_employee || payment.status === 'rejected'}
            className="h-9 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50"
          >
            {payment.shared_with_employee ? 'Released' : releasing ? 'Releasing…' : 'Release payslip'}
          </button>
        </div>

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
      <StepUpDialog
        open={stepUpOpen}
        busy={stepUpBusy}
        error={stepUpError}
        message={stepUpMessage}
        onCancel={() => finishStepUpPrompt(null)}
        onVerify={password => {
          setStepUpBusy(true)
          finishStepUpPrompt(password)
        }}
      />
    </div>
  )
}
