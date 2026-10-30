'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PayrollTabs } from '@/components/payroll/PayrollTabs'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { StepUpDialog } from '@/components/step-up-dialog'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { ModalShell } from '@/components/ui/ModalShell'
import {
  approvePaymentRun,
  generatePayrollPeriod,
  lockPayrollPeriod,
  previewPayrollGenerate,
  rejectPaymentRun,
  releasePayslipToEmployee,
  unlockPayrollPeriod,
} from '@/lib/payroll'
import { isOnPayrollRoster, payrollRosterGap, type PayrollGeneratePreview } from '@/lib/payroll-readiness'
import { formatBankPaymentFile, type BankFormat } from '@/lib/payroll/bank-export'
import { buildForTaxYear, taxYearFor, toCsvRows } from '@/lib/payroll/irp5'

// Matches actual `payment_approvals` table columns
type PayrollRecord = {
  id: string
  employee_id: string
  company_id: string
  period_start: string
  period_end: string
  regular_hours: number | null
  overtime_hours: number | null
  gross_pay: number
  deductions: number
  net_pay: number
  status: string
  shared_with_employee: boolean | null
  pay_basis: string | null
  created_at: string | null
  deductions_breakdown?: { label?: string; amount?: number }[] | null
  employee?: {
    name: string
    surname: string
    employee_number:   string | null
    bank_name:       string | null
    bank_account:    string | null
    bank_branch_code: string | null
    id_number:       string | null
    tax_number?:     string | null
    account_type:    string | null
  }
}

type PayrollRosterPerson = {
  id: string
  name: string
  surname: string
  is_active: boolean
  worker_type: string | null
  employment_date: string | null
  termination_date: string | null
  monthly_salary: number | null
  hourly_rate: number | null
  daily_rate: number | null
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'paid'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const PAYSLIP_COLORS: Record<string, { bg: string; fg: string }> = {
  approved: { bg: '#DCFCE7', fg: '#166534' },
  paid:     { bg: '#DBEAFE', fg: '#1E40AF' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
  pending:  { bg: '#FEF9C3', fg: '#854D0E' },
}
function stBg(s: string) { return (PAYSLIP_COLORS[s?.toLowerCase()] ?? PAYSLIP_COLORS.pending).bg }
function stFg(s: string) { return (PAYSLIP_COLORS[s?.toLowerCase()] ?? PAYSLIP_COLORS.pending).fg }

const slipCell = 'px-2 py-[3px] text-[12px] whitespace-nowrap align-middle'
const slipHead = 'px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary whitespace-nowrap bg-surface-elevated'

function CompactChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 px-2 text-[11px] rounded-md border ${active ? 'bg-primary text-white border-primary' : 'bg-surface-dark text-text-secondary border-border'}`}
    >
      {label}
    </button>
  )
}

function currentMonthValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number)
  const last = new Date(year, mon, 0).getDate()
  const mm = String(mon).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` }
}

function fmtPeriod(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  const sLabel = s.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
  const eLabel = e.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${sLabel} – ${eLabel}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const section = searchParams.get('tab') === 'bank' ? 'bank' : 'payslips'

  // persist company across re-renders without triggering re-fetch
  const companyIdRef = useRef<string | null>(null)

  const [payments,     setPayments]     = useState<PayrollRecord[]>([])
  const [roster,       setRoster]       = useState<PayrollRosterPerson[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [success,      setSuccess]      = useState<string | null>(null)
  const [month,        setMonth]        = useState(currentMonthValue)
  const { start: dateFrom, end: dateTo } = monthBounds(month)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isLocked,     setIsLocked]     = useState(false)
  const [generating,   setGenerating]   = useState(false)
  const [genProgress,  setGenProgress]  = useState<{ done: number; total: number } | null>(null)
  const [approving,    setApproving]    = useState(false)
  const [releasing,    setReleasing]    = useState(false)
  const [genPreview,   setGenPreview]   = useState<PayrollGeneratePreview | null>(null)
  const [showGenModal, setShowGenModal] = useState(false)
  const [bankFormat,   setBankFormat]   = useState<BankFormat>('generic')
  const [stepUpOpen,   setStepUpOpen]   = useState(false)
  const [stepUpBusy,   setStepUpBusy]   = useState(false)
  const [stepUpError,  setStepUpError]  = useState<string | null>(null)
  const stepUpResolverRef = useRef<((password: string | null) => void) | null>(null)
  const ensuredPayslipsRef = useRef('')

  function promptStepUpPassword(): Promise<string | null> {
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

  // Reload whenever the date range changes
  useEffect(() => { loadPayroll(dateFrom, dateTo) }, [dateFrom, dateTo])

  async function loadPayroll(from: string, to: string) {
    setLoading(true)
    const supabase = createClient()

    // Resolve company once
    if (!companyIdRef.current) {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('not_linked'); setLoading(false); return }
      companyIdRef.current = member.companyId
    }

    const cid = companyIdRef.current!

    const [{ data: paymentsData, error: payErr }, { data: locks, error: lockErr }, { data: people, error: peopleErr }] = await Promise.all([
      supabase
        .from('payment_approvals')
        .select('*, employee:employees(name, surname, employee_number, bank_name, bank_account, bank_branch_code, id_number, tax_number, account_type)')
        .eq('company_id', cid)
        .gte('period_start', from)
        .lte('period_end', to)
        .order('created_at', { ascending: false }),
      supabase
        .from('payroll_period_locks')
        .select('period_start, period_end')
        .eq('company_id', cid),
      supabase
        .from('employees')
        .select('id, name, surname, is_active, worker_type, employment_date, termination_date, monthly_salary, hourly_rate, daily_rate')
        .eq('company_id', cid)
        .eq('is_active', true),
    ])

    if (payErr || lockErr) {
      setError(payErr?.message ?? lockErr?.message ?? 'Failed to load payroll')
      setPayments([])
      setRoster([])
      setLoading(false)
      return
    }

    const rows = (paymentsData ?? []) as PayrollRecord[]
    const locked = (locks ?? []).some(l => l.period_start === from && l.period_end === to)
    setIsLocked(locked)
    // W5: opening the page no longer works out every payslip again (that took 37 s for 326 people
    // and would time out for a large company). Payslips update when someone presses "Update payslips".

    setPayments(rows)
    setRoster(peopleErr ? [] : (people ?? []) as PayrollRosterPerson[])
    if (peopleErr) setError(peopleErr.message)
    setLoading(false)
  }

  async function toggleLock() {
    const cid = companyIdRef.current
    if (!cid) return
    setError(null)
    const supabase = createClient()
    const result = isLocked
      ? await unlockPayrollPeriod(supabase, cid, dateFrom, dateTo)
      : await lockPayrollPeriod(supabase, cid, dateFrom, dateTo)
    if (!result.ok) setError(result.message)
    await loadPayroll(dateFrom, dateTo)
  }

  async function openGenerate() {
    const cid = companyIdRef.current
    if (!cid) return
    setError(null)
    const supabase = createClient()
    const preview = await previewPayrollGenerate(supabase, cid, dateFrom, dateTo)
    if (!preview.ok) { setError(preview.message); return }
    setGenPreview(preview.data)
    setShowGenModal(true)
  }

  async function confirmGenerate() {
    const cid = companyIdRef.current
    if (!cid) return
    setGenerating(true)
    setGenProgress(null)
    setError(null)
    setSuccess(null)
    const supabase = createClient()
    const result = await generatePayrollPeriod(supabase, cid, dateFrom, dateTo, setGenProgress)
    setGenerating(false)
    setGenProgress(null)
    setShowGenModal(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const { generated, updated, skipped, errors } = result.data
    const parts: string[] = []
    if (generated) parts.push(`Created ${generated}`)
    if (updated) parts.push(`Updated ${updated}`)
    let msg = parts.length ? parts.join('. ') : 'No payslips changed'
    if (skipped) msg += ` (${skipped} skipped)`
    if (errors.length) msg += `. ${errors.length} error(s): ${errors[0]}`
    setSuccess(msg)
    await loadPayroll(dateFrom, dateTo)
  }

  async function approvePayslip(id: string) {
    const cid = companyIdRef.current
    if (!cid) return
    setError(null)
    const supabase = createClient()
    const result = await approvePaymentRun(supabase, cid, id, {
      promptPassword: promptStepUpPassword,
    })
    if (!result.ok) setError(result.message)
    else setSuccess('Payslip approved')
    await loadPayroll(dateFrom, dateTo)
  }

  async function rejectPayslip(id: string) {
    const cid = companyIdRef.current
    if (!cid) return
    setError(null)
    const supabase = createClient()
    const result = await rejectPaymentRun(supabase, cid, id)
    if (!result.ok) setError(result.message)
    else setSuccess('Payslip rejected')
    await loadPayroll(dateFrom, dateTo)
  }

  async function releasePayslip(id: string) {
    const cid = companyIdRef.current
    if (!cid) return
    setError(null)
    const supabase = createClient()
    const result = await releasePayslipToEmployee(supabase, cid, id)
    if (!result.ok) setError(result.message)
    else setSuccess('Payslip released to employee')
    await loadPayroll(dateFrom, dateTo)
  }

  async function approveAll() {
    const cid = companyIdRef.current
    if (!cid) return
    // Payslips with nothing to pay (R0) are left for someone to check, not approved in bulk.
    const allPending = filtered.filter(p => p.status === 'pending')
    const pending = allPending.filter(p => (p.net_pay ?? 0) > 0)
    const zero = allPending.length - pending.length
    if (!pending.length) {
      if (zero) setError(`The ${zero === 1 ? 'pending payslip pays' : `${zero} pending payslips pay`} R0. Open ${zero === 1 ? 'it' : 'them'} to check before approving.`)
      return
    }
    const zeroNote = zero ? `\n\n${zero} payslip${zero !== 1 ? 's' : ''} with R0 to pay will be left pending for you to check.` : ''
    if (!window.confirm(`Approve ${pending.length} pending payslip${pending.length !== 1 ? 's' : ''}?${zeroNote}`)) return
    setApproving(true)
    setError(null)
    const supabase = createClient()
    const failures: string[] = []
    for (const p of pending) {
      const result = await approvePaymentRun(supabase, cid, p.id, {
        promptPassword: promptStepUpPassword,
      })
      if (!result.ok) {
        failures.push(result.message)
        break
      }
    }
    if (failures.length) setError(failures[0])
    else setSuccess(`Approved ${pending.length} payslip${pending.length !== 1 ? 's' : ''}`)
    await loadPayroll(dateFrom, dateTo)
    setApproving(false)
  }

  async function releaseAll() {
    const cid = companyIdRef.current
    if (!cid) return
    const releasable = filtered.filter(p => p.status === 'approved' && p.shared_with_employee === false)
    if (!releasable.length) { setError('No approved-but-unreleased payslips in this view.'); return }
    if (!window.confirm(`Release ${releasable.length} approved payslip${releasable.length !== 1 ? 's' : ''} to employees?`)) return
    setReleasing(true)
    setError(null)
    const supabase = createClient()
    const failures: string[] = []
    for (const p of releasable) {
      const result = await releasePayslipToEmployee(supabase, cid, p.id)
      if (!result.ok) failures.push(result.message)
    }
    if (failures.length) setError(failures[0])
    else setSuccess(`Released ${releasable.length} payslip${releasable.length !== 1 ? 's' : ''}`)
    await loadPayroll(dateFrom, dateTo)
    setReleasing(false)
  }

  // ── CSV exports ────────────────────────────────────────────────────────────

  function downloadCSV(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportRegisterCSV() {
    const header = 'Employee,Employee number,Period Start,Period End,Gross (R),Deductions (R),Net (R),Hours,Status'
    const rows   = filtered.map(p => {
      const emp   = p.employee
      const name  = emp ? `${emp.name} ${emp.surname}`.trim() : ''
      const hours = ((p.regular_hours ?? 0) + (p.overtime_hours ?? 0)).toFixed(2)
      return [
        `"${name}"`,
        emp?.employee_number ?? '',
        p.period_start,
        p.period_end,
        (p.gross_pay   ?? 0).toFixed(2),
        (p.deductions  ?? 0).toFixed(2),
        (p.net_pay     ?? 0).toFixed(2),
        hours,
        p.status,
      ].join(',')
    })
    downloadCSV([header, ...rows].join('\n'), `payroll_register_${dateFrom}_to_${dateTo}.csv`)
  }

  function exportBankCSV() {
    const bankRows = filtered
      .filter(p => (p.status === 'approved' || p.status === 'paid') && (p.net_pay ?? 0) > 0)
      .map(p => {
        const emp = p.employee
        const name = emp ? `${emp.name} ${emp.surname}`.trim() : ''
        return {
          employeeName: name,
          bankName: emp?.bank_name ?? '',
          branchCode: emp?.bank_branch_code ?? '',
          accountNumber: emp?.bank_account ?? '',
          netPay: p.net_pay ?? 0,
          reference: `SALARY ${p.period_start}`,
          idNumber: emp?.id_number ?? null,
        }
      })
    const { headers, rows } = formatBankPaymentFile(bankFormat, bankRows)
    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    downloadCSV(csv, `bank_${bankFormat}_${dateFrom}.csv`)
  }

  function exportIRP5CSV() {
    const { start: tyStart } = taxYearFor(dateTo)
    const taxYearStartYear = Number(tyStart.slice(0, 4))
    const byEmp = new Map<string, {
      name: string
      idNumber: string | null
      taxNumber: string | null
      payslips: {
        periodEnd: string
        status: string
        grossPay: number
        netPay: number
        deductions: number
        deductionLines: { label: string; amount: number }[]
      }[]
    }>()

    for (const p of filtered.filter(x => x.status === 'approved' || x.status === 'paid')) {
      const emp = p.employee
      const name = emp ? `${emp.name} ${emp.surname}`.trim() : p.employee_id
      const key = p.employee_id
      if (!byEmp.has(key)) {
        byEmp.set(key, {
          name,
          idNumber: emp?.id_number ?? null,
          taxNumber: emp?.tax_number ?? null,
          payslips: [],
        })
      }
      byEmp.get(key)!.payslips.push({
        periodEnd: p.period_end,
        status: p.status,
        grossPay: p.gross_pay ?? 0,
        netPay: p.net_pay ?? 0,
        deductions: p.deductions ?? 0,
        deductionLines: (p.deductions_breakdown ?? []).map(l => ({
          label: l.label ?? '',
          amount: Number(l.amount ?? 0),
        })),
      })
    }

    const records = buildForTaxYear(taxYearStartYear, [...byEmp.values()])
    const header = 'Employee,ID Number,Tax Number,YTD Gross (R),YTD PAYE (R),YTD UIF (R),YTD Net (R),Payslip Count'
    const rows = toCsvRows(records).map(r =>
      r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
    )
    downloadCSV([header, ...rows].join('\n'), `IRP5_${taxYearStartYear}.csv`)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = payments.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (search) {
      const q   = search.toLowerCase()
      const emp = p.employee
      const name = emp ? `${emp.name} ${emp.surname}`.toLowerCase() : ''
      const period = fmtPeriod(p.period_start, p.period_end).toLowerCase()
      if (!name.includes(q) && !period.includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    const an = `${a.employee?.surname ?? ''} ${a.employee?.name ?? ''}`.trim().toLowerCase()
    const bn = `${b.employee?.surname ?? ''} ${b.employee?.name ?? ''}`.trim().toLowerCase()
    return an.localeCompare(bn) || (a.period_start ?? '').localeCompare(b.period_start ?? '')
  })

  const coveredIds = new Set(payments.map(p => p.employee_id))
  const uncovered = roster.filter(person => isOnPayrollRoster(person, dateFrom, dateTo) && !coveredIds.has(person.id))
  const missingPeople = (statusFilter === 'all' ? uncovered : []).filter(person => {
    if (!search) return true
    const name = `${person.name} ${person.surname}`.toLowerCase()
    return name.includes(search.toLowerCase())
  }).sort((a, b) => `${a.surname} ${a.name}`.localeCompare(`${b.surname} ${b.name}`, 'en'))
  const uncoveredKey = uncovered.map(person => person.id).sort().join(',')

  useEffect(() => {
    if (loading || isLocked || uncovered.length === 0) return
    const cid = companyIdRef.current
    if (!cid) return
    const key = `${dateFrom}|${uncoveredKey}`
    if (ensuredPayslipsRef.current === key) return
    ensuredPayslipsRef.current = key
    const supabase = createClient()
    void generatePayrollPeriod(supabase, cid, dateFrom, dateTo, undefined, { onlyMissing: true }).then(result => {
      if (result.ok && result.data.generated > 0) void loadPayroll(dateFrom, dateTo)
    })
  }, [loading, isLocked, dateFrom, dateTo, uncoveredKey])

  const pendingGross  = filtered.filter(p => p.status === 'pending')
    .reduce((s, p) => s + (p.gross_pay ?? 0), 0)
  const approvedGross = filtered.filter(p => p.status === 'approved' || p.status === 'paid')
    .reduce((s, p) => s + (p.gross_pay ?? 0), 0)
  const approvedNet = filtered.filter(p => p.status === 'approved' || p.status === 'paid')
    .reduce((s, p) => s + (p.net_pay ?? 0), 0)
  const pendingCount = filtered.filter(p => p.status === 'pending').length

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ── */}
      <div className="px-3 py-1.5 border-b border-divider shrink-0 bg-surface space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[14px] font-semibold text-text-primary">Payroll</h1>
          <PayrollTabs active={section} className="" />
        </div>

        {success && (
          <p className="text-success text-[12px] font-medium">{success}</p>
        )}
        {error && error !== 'not_linked' && (
          <p className="text-error text-[12px] font-medium">{error}</p>
        )}
        {isLocked && (
          <p className="text-error text-[12px] font-medium">Period is locked. Recalculation and overrides are disabled.</p>
        )}

        {section === 'payslips' && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                id="payroll-month"
                type="month"
                aria-label="Month"
                value={month}
                onChange={e => { setSuccess(null); setMonth(e.target.value) }}
                className="h-7 w-[9.5rem] rounded-md border border-border bg-surface-elevated px-2 text-[12px] text-text-primary"
              />
              <button
                type="button"
                onClick={() => void toggleLock()}
                className="h-7 px-2 text-[11px] rounded-md border border-border bg-surface-dark text-text-primary hover:opacity-80"
              >
                {isLocked ? 'Unlock' : 'Lock'}
              </button>
              <div className="flex items-center gap-1 flex-1 min-w-[140px] h-7 bg-surface border border-border rounded-md px-2">
                <span className="material-icons text-text-secondary text-[14px]">search</span>
                <input
                  placeholder="Search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-text-primary text-[12px] h-7 outline-none placeholder:text-text-disabled"
                />
              </div>
              {(['all', 'pending', 'approved', 'paid'] as StatusFilter[]).map(s => (
                <CompactChip
                  key={s}
                  label={s.charAt(0).toUpperCase() + s.slice(1)}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                />
              ))}
              <button
                onClick={() => void openGenerate()}
                disabled={generating || isLocked}
                className="h-7 px-2 text-[11px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
              >
                {generating
                  ? genProgress ? `${genProgress.done.toLocaleString()}/${genProgress.total.toLocaleString()}` : 'Working…'
                  : pendingCount > 0 ? 'Update' : 'Create'}
              </button>
              <button
                onClick={approveAll}
                disabled={approving}
                className="btn-primary h-7 px-2 text-[11px] disabled:opacity-50"
              >
                {approving ? 'Approving…' : 'Approve all'}
              </button>
              <button
                onClick={releaseAll}
                disabled={releasing}
                className="h-7 px-2 text-[11px] rounded-md border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#4C1D95', color: '#C4B5FD', borderColor: '#7C3AED' }}
              >
                {releasing ? 'Releasing…' : 'Release all'}
              </button>
            </div>
            <p className="text-[11px] text-text-secondary">
              Pending <span className="text-text-primary font-medium">{fmtR(pendingGross)}</span>
              <span className="text-text-disabled"> ({pendingCount})</span>
              <span className="mx-1.5 text-text-disabled">·</span>
              Approved <span className="text-text-primary font-medium">{fmtR(approvedGross)}</span>
              <span className="mx-1.5 text-text-disabled">·</span>
              Net <span className="text-text-primary font-medium">{fmtR(approvedNet)}</span>
              <span className="mx-1.5 text-text-disabled">·</span>
              {filtered.length === 1 ? '1 payslip' : `${filtered.length} payslips`}
              {uncovered.length > 0 && (
                <span className="text-warning">
                  <span className="mx-1.5 text-text-disabled">·</span>
                  {uncovered.length === 1 ? '1 employee is not on a payslip' : `${uncovered.length} employees are not on a payslip`}
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {section === 'bank' && (
        <div className="flex-1 overflow-y-auto p-4">
          {(search.trim() !== '' || statusFilter !== 'all') && (
            <p className="text-[12px] text-text-secondary mb-3 max-w-3xl">
              These files use the Payslips search and status filter.
            </p>
          )}
          <div className="grid gap-3 max-w-3xl md:grid-cols-3">
            <section className="card p-4 flex flex-col gap-3">
              <div>
                <p className="text-[14px] font-semibold text-text-primary">Payroll register</p>
                <p className="text-[12px] text-text-secondary mt-1">
                  Gross, deductions, net, hours, and status for the {filtered.length} payslips in this view.
                </p>
              </div>
              <button
                type="button"
                onClick={exportRegisterCSV}
                disabled={filtered.length === 0}
                className="mt-auto h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-primary disabled:opacity-40"
              >
                Download register
              </button>
            </section>
            <section className="card p-4 flex flex-col gap-3">
              <div>
                <p className="text-[14px] font-semibold text-text-primary">Bank file</p>
                <p className="text-[12px] text-text-secondary mt-1">
                  Approved and paid payslips with a net amount, in the bank layout you choose.
                </p>
              </div>
              <select
                value={bankFormat}
                onChange={e => setBankFormat(e.target.value as BankFormat)}
                className="h-9 px-2 text-[12px] rounded-md bg-surface-dark border border-border text-text-primary"
              >
                <option value="generic">Generic</option>
                <option value="fnb">FNB</option>
                <option value="absa">ABSA</option>
                <option value="standard_bank">Standard Bank</option>
              </select>
              <button
                type="button"
                onClick={exportBankCSV}
                disabled={filtered.length === 0}
                className="mt-auto h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-primary disabled:opacity-40"
              >
                Download bank file
              </button>
            </section>
            <section className="card p-4 flex flex-col gap-3">
              <div>
                <p className="text-[14px] font-semibold text-text-primary">IRP5</p>
                <p className="text-[12px] text-text-secondary mt-1">
                  Year-to-date totals for the tax year that contains {dateTo}, from approved and paid payslips in this view.
                </p>
              </div>
              <button
                type="button"
                onClick={exportIRP5CSV}
                disabled={filtered.length === 0}
                className="mt-auto h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-primary disabled:opacity-40"
              >
                Download IRP5
              </button>
            </section>
          </div>
        </div>
      )}

      {section === 'payslips' && (
      <div className="flex-1 overflow-y-auto">
        <ResponsiveDataView
          table={
            <table style={{ minWidth: 860 }} className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-divider">
                  <th className={`${slipHead} text-left`}>Employee</th>
                  <th className={`${slipHead} text-left`}>Period</th>
                  <th className={`${slipHead} text-right`}>Gross</th>
                  <th className={`${slipHead} text-right`}>Deduct.</th>
                  <th className={`${slipHead} text-right`}>Net</th>
                  <th className={`${slipHead} text-left`}>Status</th>
                  <th className={`${slipHead} text-left`}>Visible</th>
                  <th className={`${slipHead} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-10 text-text-secondary text-[13px]">Loading…</td></tr>
                ) : filtered.length === 0 && missingPeople.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-text-secondary text-[13px]">No payslips found.</td></tr>
                ) : (
                  <>
                  {filtered.map(p => {
                    const emp     = p.employee
                    const empName = emp ? `${emp.name} ${emp.surname}` : '—'
                    return (
                      <tr
                        key={p.id}
                        onClick={() => router.push(`/dashboard/payroll/${p.id}`)}
                        className="bg-surface-card border-b border-divider cursor-pointer hover:bg-background transition-colors"
                      >
                        <td className={`${slipCell} text-text-primary font-medium`}>
                          <span className="block max-w-[220px] truncate">{empName}</span>
                        </td>
                        <td className={`${slipCell} text-text-secondary`}>
                          {fmtPeriod(p.period_start, p.period_end)}
                        </td>
                        <td className={`${slipCell} text-right`}>{fmtR(p.gross_pay)}</td>
                        <td className={`${slipCell} text-text-secondary text-right`}>{fmtR(p.deductions)}</td>
                        <td className={`${slipCell} text-text-primary text-right font-medium`}>{fmtR(p.net_pay)}</td>
                        <td className={slipCell}>
                          <StatusBadge label={p.status} bg={stBg(p.status)} fg={stFg(p.status)} />
                        </td>
                        <td className={`${slipCell} text-[11px]`} style={{ color: p.shared_with_employee ? '#16A34A' : '#6B7280' }}>
                          {p.shared_with_employee ? 'Shown' : 'Hidden'}
                        </td>
                        <td className={slipCell}>
                          <div
                            className="flex items-center gap-1 justify-end"
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              onClick={() => router.push(`/dashboard/payroll/${p.id}`)}
                              className="bg-surface-dark text-text-primary h-6 px-1.5 text-[11px] rounded hover:bg-border transition-colors"
                            >
                              Open
                            </button>
                            {p.status === 'pending' && (
                              <button
                                onClick={() => approvePayslip(p.id)}
                                className="btn-primary h-6 px-1.5 text-[11px]"
                              >
                                Approve
                              </button>
                            )}
                            {p.shared_with_employee === false && p.status === 'approved' && (
                              <button
                                onClick={() => releasePayslip(p.id)}
                                className="h-6 px-1.5 text-[11px] rounded text-white"
                                style={{ backgroundColor: '#7C3AED' }}
                              >
                                Show
                              </button>
                            )}
                            {p.status === 'pending' && (
                              <button
                                onClick={() => rejectPayslip(p.id)}
                                className="h-6 px-1.5 text-[11px] rounded hover:opacity-80 transition-opacity"
                                style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {missingPeople.map(person => (
                    <tr
                      key={person.id}
                      onClick={() => router.push(`/dashboard/employees/${person.id}`)}
                      className="bg-surface-card border-b border-divider cursor-pointer hover:bg-background transition-colors"
                    >
                      <td className={`${slipCell} text-text-primary font-medium`}>
                        <span className="block max-w-[220px] truncate">{person.name} {person.surname}</span>
                      </td>
                      <td className={`${slipCell} text-text-secondary`}>
                        <span className="block max-w-[180px] truncate">{payrollRosterGap()}</span>
                      </td>
                      <td className={`${slipCell} text-right text-text-disabled`}>—</td>
                      <td className={`${slipCell} text-right text-text-disabled`}>—</td>
                      <td className={`${slipCell} text-right text-text-disabled`}>—</td>
                      <td className={slipCell}>
                        <StatusBadge label="No payslip" bg="#F3F4F6" fg="#374151" />
                      </td>
                      <td className={`${slipCell} text-[11px] text-text-disabled`}>—</td>
                      <td className={slipCell}>
                        <div className="flex justify-end" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => router.push(`/dashboard/employees/${person.id}`)}
                            className="bg-surface-dark text-text-primary h-6 px-1.5 text-[11px] rounded hover:bg-border transition-colors"
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  </>
                )}
              </tbody>
            </table>
          }
          mobile={
            loading ? (
              <p className="text-center py-10 text-text-secondary text-[13px]">Loading…</p>
            ) : filtered.length === 0 && missingPeople.length === 0 ? (
              <p className="text-center py-10 text-text-secondary text-[13px]">No payslips found.</p>
            ) : (
              <>
                {filtered.map(p => {
                  const emp = p.employee
                  const empName = emp ? `${emp.name} ${emp.surname}` : '—'
                  return (
                    <DataCard key={p.id} onClick={() => router.push(`/dashboard/payroll/${p.id}`)} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>{empName}</DataCardTitle>
                          <DataCardMeta>{fmtPeriod(p.period_start, p.period_end)}</DataCardMeta>
                        </div>
                        <StatusBadge label={p.status} bg={stBg(p.status)} fg={stFg(p.status)} />
                      </div>
                      <DataCardRow label="Net" value={fmtR(p.net_pay)} />
                      <DataCardRow label="Gross" value={fmtR(p.gross_pay)} />
                      <div
                        className="flex flex-wrap gap-2 mt-3"
                        onClick={e => e.stopPropagation()}
                      >
                        {p.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => approvePayslip(p.id)}
                            className="btn-primary flex-1 h-11 text-[13px]"
                          >
                            Approve
                          </button>
                        )}
                        {p.shared_with_employee === false && p.status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => releasePayslip(p.id)}
                            className="flex-1 h-11 text-[13px] rounded-md text-white"
                            style={{ backgroundColor: '#7C3AED' }}
                          >
                            Show
                          </button>
                        )}
                        {p.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => rejectPayslip(p.id)}
                            className="flex-1 h-11 text-[13px] rounded-md"
                            style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </DataCard>
                  )
                })}
                {missingPeople.map(person => (
                  <DataCard key={person.id} onClick={() => router.push(`/dashboard/employees/${person.id}`)} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <DataCardTitle>{person.name} {person.surname}</DataCardTitle>
                        <DataCardMeta>{payrollRosterGap()}</DataCardMeta>
                      </div>
                      <StatusBadge label="No payslip" bg="#F3F4F6" fg="#374151" />
                    </div>
                  </DataCard>
                ))}
              </>
            )
          }
        />
      </div>
      )}

      <ModalShell
        open={Boolean(showGenModal && genPreview)}
        onClose={() => setShowGenModal(false)}
        title="Generate payroll"
        footer={
          genPreview ? (
            <>
              <button
                type="button"
                onClick={() => setShowGenModal(false)}
                className="btn-outlined h-11 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmGenerate()}
                disabled={generating || genPreview.readyCount === 0}
                className="btn-primary h-11 px-4 text-[13px] disabled:opacity-50"
              >
                {generating
                  ? genProgress ? `${genProgress.done.toLocaleString()} of ${genProgress.total.toLocaleString()}…` : 'Working…'
                  : genPreview.refreshCount > 0 ? `Update ${genPreview.readyCount}` : `Generate ${genPreview.readyCount}`}
              </button>
            </>
          ) : null
        }
      >
        {genPreview && (
          <>
            <p className="text-[13px] text-text-secondary mb-3">
              {dateFrom} to {dateTo}. One payslip per person for the month. Generating again updates that payslip as punches come in.
            </p>
            <ul className="text-[13px] text-text-primary space-y-1 mb-3">
              <li><strong>{genPreview.readyCount}</strong> ready</li>
              {genPreview.refreshCount > 0 && (
                <li className="text-text-secondary">{genPreview.refreshCount} already have this month and will be updated</li>
              )}
              {genPreview.duplicateCount > 0 && (
                <li className="text-text-secondary">{genPreview.duplicateCount} already approved (left as they are)</li>
              )}
              {genPreview.missingRatesCount > 0 && (
                <li className="text-warning">{genPreview.missingRatesCount} missing pay rates</li>
              )}
              {genPreview.missingShiftCount > 0 && (
                <li className={genPreview.companyHasDefaultTemplate ? 'text-text-secondary' : 'text-warning'}>
                  {genPreview.companyHasDefaultTemplate
                    ? `${genPreview.missingShiftCount === 1 ? '1 person has' : `${genPreview.missingShiftCount} people have`} no template of their own. Payroll uses the company default.`
                    : `${genPreview.missingShiftCount === 1 ? '1 person has' : `${genPreview.missingShiftCount} people have`} no template, and this company has no default. Set one under Time Templates.`}
                </li>
              )}
              {genPreview.missingBankCount > 0 && (
                <li className="text-warning">{genPreview.missingBankCount} missing banking</li>
              )}
              {genPreview.contractorCount > 0 && (
                <li className="text-text-secondary">{genPreview.contractorCount} contractors — review statutory</li>
              )}
            </ul>
            {genPreview.detailLines.length > 0 && (
              <div className="max-h-28 overflow-y-auto text-[12px] text-text-secondary space-y-0.5">
                {genPreview.detailLines.slice(0, 8).map(line => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </>
        )}
      </ModalShell>

      <StepUpDialog
        open={stepUpOpen}
        busy={stepUpBusy}
        error={stepUpError}
        onCancel={() => finishStepUpPrompt(null)}
        onVerify={password => {
          setStepUpBusy(true)
          finishStepUpPrompt(password)
        }}
      />
    </div>
  )
}
