'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FilterChip } from '@/components/ui/FilterChip'
import { StepUpDialog } from '@/components/step-up-dialog'
import {
  approvePaymentRun,
  generatePayrollPeriod,
  lockPayrollPeriod,
  previewPayrollGenerate,
  rejectPaymentRun,
  releasePayslipToEmployee,
  unlockPayrollPeriod,
} from '@/lib/payroll'
import type { PayrollGeneratePreview } from '@/lib/payroll-readiness'
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
    employee_code:   string | null
    bank_name:       string | null
    bank_account:    string | null
    bank_branch_code: string | null
    id_number:       string | null
    tax_number?:     string | null
    account_type:    string | null
  }
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

function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
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

  // persist company across re-renders without triggering re-fetch
  const companyIdRef = useRef<string | null>(null)

  const [payments,     setPayments]     = useState<PayrollRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [success,      setSuccess]      = useState<string | null>(null)
  const [dateFrom,     setDateFrom]     = useState(firstOfMonthStr)
  const [dateTo,       setDateTo]       = useState(todayDateStr)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isLocked,     setIsLocked]     = useState(false)
  const [generating,   setGenerating]   = useState(false)
  const [approving,    setApproving]    = useState(false)
  const [releasing,    setReleasing]    = useState(false)
  const [genPreview,   setGenPreview]   = useState<PayrollGeneratePreview | null>(null)
  const [showGenModal, setShowGenModal] = useState(false)
  const [bankFormat,   setBankFormat]   = useState<BankFormat>('generic')
  const [stepUpOpen,   setStepUpOpen]   = useState(false)
  const [stepUpBusy,   setStepUpBusy]   = useState(false)
  const [stepUpError,  setStepUpError]  = useState<string | null>(null)
  const stepUpResolverRef = useRef<((password: string | null) => void) | null>(null)

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
    setSuccess(null)
    const supabase = createClient()

    // Resolve company once
    if (!companyIdRef.current) {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('not_linked'); setLoading(false); return }
      companyIdRef.current = member.companyId
    }

    const cid = companyIdRef.current!

    const [{ data: paymentsData, error: payErr }, { data: locks, error: lockErr }] = await Promise.all([
      supabase
        .from('payment_approvals')
        .select('*, employee:employees(name, surname, employee_code, bank_name, bank_account, bank_branch_code, id_number, tax_number, account_type)')
        .eq('company_id', cid)
        .gte('period_start', from)
        .lte('period_end', to)
        .order('created_at', { ascending: false }),
      supabase
        .from('payroll_period_locks')
        .select('period_start, period_end')
        .eq('company_id', cid),
    ])

    if (payErr || lockErr) {
      setError(payErr?.message ?? lockErr?.message ?? 'Failed to load payroll')
      setPayments([])
      setLoading(false)
      return
    }

    setPayments((paymentsData ?? []) as PayrollRecord[])
    setIsLocked(
      (locks ?? []).some(l => l.period_start === from && l.period_end === to)
    )
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
    setError(null)
    setSuccess(null)
    const supabase = createClient()
    const result = await generatePayrollPeriod(supabase, cid, dateFrom, dateTo)
    setGenerating(false)
    setShowGenModal(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const { generated, skipped, errors } = result.data
    let msg = `Generated ${generated} payslip${generated !== 1 ? 's' : ''}`
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
    const pending = filtered.filter(p => p.status === 'pending')
    if (!pending.length) return
    if (!window.confirm(`Approve all ${pending.length} pending payslip${pending.length !== 1 ? 's' : ''}?`)) return
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
    const header = 'Employee,Code,Period Start,Period End,Gross (R),Deductions (R),Net (R),Hours,Status'
    const rows   = filtered.map(p => {
      const emp   = p.employee
      const name  = emp ? `${emp.name} ${emp.surname}`.trim() : ''
      const hours = ((p.regular_hours ?? 0) + (p.overtime_hours ?? 0)).toFixed(2)
      return [
        `"${name}"`,
        emp?.employee_code ?? '',
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
  })

  const pendingGross  = filtered.filter(p => p.status === 'pending')
    .reduce((s, p) => s + (p.gross_pay ?? 0), 0)
  const approvedGross = filtered.filter(p => p.status === 'approved' || p.status === 'paid')
    .reduce((s, p) => s + (p.gross_pay ?? 0), 0)
  const approvedNet = filtered.filter(p => p.status === 'approved' || p.status === 'paid')
    .reduce((s, p) => s + (p.net_pay ?? 0), 0)
  const pendingCount = filtered.filter(p => p.status === 'pending').length
  const approvedCount = filtered.filter(p => p.status === 'approved' || p.status === 'paid').length

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
      <div className="px-4 pt-3 pb-2 border-b border-divider shrink-0 bg-surface space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[18px] font-semibold text-text-primary shrink-0">Payroll</h1>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Link
              href="/dashboard/payroll/settings"
              className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
              title="Payroll settings"
            >
              <span className="material-icons text-[18px]">settings</span>
            </Link>
            {/* Lock/Unlock — writes to payroll_period_locks */}
            <button
              onClick={() => void toggleLock()}
              title={isLocked ? 'Unlock period' : 'Lock period'}
              className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center transition-colors hover:text-text-primary"
              style={{ color: isLocked ? '#DC2626' : undefined }}
            >
              <span className="material-icons text-[18px]">{isLocked ? 'lock' : 'lock_open'}</span>
            </button>
            <button
              onClick={exportRegisterCSV}
              disabled={filtered.length === 0}
              className="h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
            >
              Register
            </button>
            <select
              value={bankFormat}
              onChange={e => setBankFormat(e.target.value as BankFormat)}
              className="h-9 px-2 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary"
              title="Bank file format"
            >
              <option value="generic">Bank: Generic</option>
              <option value="fnb">Bank: FNB</option>
              <option value="absa">Bank: ABSA</option>
              <option value="standard_bank">Bank: Standard</option>
            </select>
            <button
              onClick={exportBankCSV}
              disabled={filtered.length === 0}
              className="h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
            >
              Bank CSV
            </button>
            <button
              onClick={exportIRP5CSV}
              disabled={filtered.length === 0}
              className="h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
            >
              IRP5
            </button>
            <button
              onClick={() => void openGenerate()}
              disabled={generating || isLocked}
              className="h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
            <button
              onClick={approveAll}
              disabled={approving}
              className="btn-primary h-9 px-3 text-[12px] disabled:opacity-50"
            >
              {approving ? 'Approving…' : 'Approve All'}
            </button>
            <button
              onClick={releaseAll}
              disabled={releasing}
              className="h-9 px-3 text-[12px] rounded-md border border-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#4C1D95', color: '#C4B5FD', borderColor: '#7C3AED' }}
            >
              {releasing ? 'Releasing…' : 'Release All'}
            </button>
          </div>
        </div>

        {/* Feedback banners */}
        {success && (
          <p className="text-success text-[13px] font-medium">{success}</p>
        )}
        {error && error !== 'not_linked' && (
          <p className="text-error text-[13px] font-medium">{error}</p>
        )}

        {/* Period cockpit */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg py-2 px-3 flex flex-col items-center gap-0.5 bg-surface-elevated border border-divider">
            <span className="text-[17px] font-semibold text-text-primary">{fmtR(pendingGross)}</span>
            <span className="text-[10px] text-text-secondary">Pending gross ({pendingCount})</span>
          </div>
          <div className="rounded-lg py-2 px-3 flex flex-col items-center gap-0.5 bg-surface-elevated border border-divider">
            <span className="text-[17px] font-semibold text-text-primary">{fmtR(approvedGross)}</span>
            <span className="text-[10px] text-text-secondary">Approved gross ({approvedCount})</span>
          </div>
          <div className="rounded-lg py-2 px-3 flex flex-col items-center gap-0.5 bg-surface-elevated border border-divider">
            <span className="text-[17px] font-semibold text-text-primary">{fmtR(approvedNet)}</span>
            <span className="text-[10px] text-text-secondary">Approved net (bankable)</span>
          </div>
          <div className="rounded-lg py-2 px-3 flex flex-col items-center gap-0.5 bg-surface-elevated border border-divider">
            <span className="text-[17px] font-semibold text-text-primary">{isLocked ? 'Locked' : 'Open'}</span>
            <span className="text-[10px] text-text-secondary">Period status</span>
          </div>
        </div>

        {/* Date range — changes trigger DB query reload */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-secondary font-medium">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="dark-entry" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-secondary font-medium">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="dark-entry" />
          </div>
        </div>

        {/* Period lock label */}
        {isLocked && (
          <p className="text-error text-sm font-medium">Period is locked — recalculation and overrides are disabled.</p>
        )}

        {/* Filter toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 flex-1 min-w-[160px] bg-surface border border-border rounded-lg px-2">
            <span className="material-icons text-text-secondary text-[16px]">search</span>
            <input
              placeholder="Search employee, period…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled"
            />
          </div>
          {(['all', 'pending', 'approved', 'paid'] as StatusFilter[]).map(s => (
            <FilterChip
              key={s}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            />
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          <table style={{ minWidth: 980 }} className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 150 }} className="data-th cursor-pointer select-none">Employee</th>
                <th style={{ width: 160 }} className="data-th">Period</th>
                <th style={{ width: 85 }}  className="data-th text-right cursor-pointer select-none">Gross</th>
                <th style={{ width: 85 }}  className="data-th text-right">Deduct.</th>
                <th style={{ width: 85 }}  className="data-th text-right cursor-pointer select-none">Net</th>
                <th style={{ width: 90 }}  className="data-th">Hours</th>
                <th style={{ width: 80 }}  className="data-th cursor-pointer select-none">Status</th>
                <th style={{ width: 100 }} className="data-th">Visible</th>
                <th style={{ width: 200 }} className="data-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-text-secondary text-[13px]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-text-secondary text-[13px]">No payslips found.</td></tr>
              ) : (
                filtered.map(p => {
                  const emp     = p.employee
                  const empName = emp ? `${emp.name} ${emp.surname}` : '—'
                  const totalHours = (p.regular_hours ?? 0) + (p.overtime_hours ?? 0)
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(`/dashboard/payroll/${p.id}`)}
                      className="bg-surface-card border-b border-divider cursor-pointer hover:bg-background transition-colors"
                    >
                      <td className="data-td text-text-primary text-sm font-medium">{empName}</td>
                      <td className="data-td text-text-secondary text-sm">
                        {fmtPeriod(p.period_start, p.period_end)}
                      </td>
                      <td className="data-td text-sm text-right">{fmtR(p.gross_pay)}</td>
                      <td className="data-td text-text-secondary text-sm text-right">{fmtR(p.deductions)}</td>
                      <td className="data-td text-text-primary text-sm text-right font-medium">{fmtR(p.net_pay)}</td>
                      <td className="data-td text-text-secondary text-sm">{totalHours.toFixed(1)}h</td>
                      <td className="data-td">
                        <StatusBadge label={p.status} bg={stBg(p.status)} fg={stFg(p.status)} />
                      </td>
                      <td className="data-td text-[11px]" style={{ color: p.shared_with_employee ? '#16A34A' : '#6B7280' }}>
                        {p.shared_with_employee ? 'Shown' : 'Hidden'}
                      </td>
                      <td className="data-td">
                        <div
                          className="flex items-center gap-1.5 justify-end"
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => router.push(`/dashboard/payroll/${p.id}`)}
                            className="bg-surface-dark text-text-primary h-[30px] px-2 text-[11px] rounded-md hover:bg-border transition-colors"
                          >
                            Open
                          </button>
                          {p.status === 'pending' && (
                            <button
                              onClick={() => approvePayslip(p.id)}
                              className="btn-primary h-[30px] px-2 text-[11px]"
                            >
                              Approve
                            </button>
                          )}
                          {p.shared_with_employee === false && p.status === 'approved' && (
                            <button
                              onClick={() => releasePayslip(p.id)}
                              className="h-[30px] px-2 text-[11px] rounded-md text-white"
                              style={{ backgroundColor: '#7C3AED' }}
                            >
                              Show
                            </button>
                          )}
                          {p.status === 'pending' && (
                            <button
                              onClick={() => rejectPayslip(p.id)}
                              className="h-[30px] px-2 text-[11px] rounded-md hover:opacity-80 transition-opacity"
                              style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showGenModal && genPreview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">Generate payroll</h3>
            <p className="text-[13px] text-text-secondary">
              Period {dateFrom} → {dateTo}. Uses payroll settings (OT, UIF, PAYE rates) and period punches.
            </p>
            <ul className="text-[13px] text-text-primary space-y-1">
              <li><strong>{genPreview.readyCount}</strong> ready to generate</li>
              {genPreview.duplicateCount > 0 && (
                <li className="text-text-secondary">{genPreview.duplicateCount} already have payslips (skipped)</li>
              )}
              {genPreview.missingRatesCount > 0 && (
                <li className="text-warning">{genPreview.missingRatesCount} missing pay rates</li>
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
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowGenModal(false)}
                className="btn-outlined h-9 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmGenerate()}
                disabled={generating || genPreview.readyCount === 0}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {generating ? 'Generating…' : `Generate ${genPreview.readyCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

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
