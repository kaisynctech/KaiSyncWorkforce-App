'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FilterChip } from '@/components/ui/FilterChip'

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
  employee?: {
    name: string
    surname: string
    employee_code:   string | null
    bank_name:       string | null
    account_number:  string | null
    bank_branch_code: string | null
    id_number:       string | null
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

    const [{ data: paymentsData }, { data: locks }] = await Promise.all([
      supabase
        .from('payment_approvals')
        .select('*, employee:employees(name, surname, employee_code, bank_name, account_number, bank_branch_code, id_number)')
        .eq('company_id', cid)
        .gte('period_start', from)
        .lte('period_end', to)
        .order('created_at', { ascending: false }),
      supabase
        .from('payroll_period_locks')
        .select('period_start, period_end')
        .eq('company_id', cid),
    ])

    setPayments((paymentsData ?? []) as PayrollRecord[])
    setIsLocked(
      (locks ?? []).some(l => l.period_start === from && l.period_end === to)
    )
    setLoading(false)
  }

  async function toggleLock() {
    const cid = companyIdRef.current
    if (!cid) return
    const supabase = createClient()
    if (isLocked) {
      await supabase.rpc('hr_unlock_payroll_period', {
        p_company_id:   cid,
        p_period_start: dateFrom,
        p_period_end:   dateTo,
      })
    } else {
      await supabase.rpc('hr_lock_payroll_period', {
        p_company_id:   cid,
        p_period_start: dateFrom,
        p_period_end:   dateTo,
      })
    }
    await loadPayroll(dateFrom, dateTo)
  }

  async function handleGenerate() {
    const cid = companyIdRef.current
    if (!cid) return
    if (!window.confirm(`Generate payroll for ${dateFrom} to ${dateTo}?`)) return
    setGenerating(true)
    setError(null)
    const supabase = createClient()
    const { data, error: rpcErr } = await supabase.rpc('hr_generate_payroll', {
      p_company_id:   cid,
      p_period_start: dateFrom,
      p_period_end:   dateTo,
    })
    if (rpcErr) {
      setError(rpcErr.message)
    } else {
      setSuccess(`Generated ${data ?? 0} payslip${(data ?? 0) !== 1 ? 's' : ''}`)
      await loadPayroll(dateFrom, dateTo)
    }
    setGenerating(false)
  }

  async function approvePayslip(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('approve_payslip', { payment_id: id }) } catch {}
    loadPayroll(dateFrom, dateTo)
  }

  async function rejectPayslip(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('reject_payslip', { payment_id: id }) } catch {}
    loadPayroll(dateFrom, dateTo)
  }

  async function releasePayslip(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('release_payslip_to_employee', { payment_id: id }) } catch {}
    loadPayroll(dateFrom, dateTo)
  }

  async function approveAll() {
    const pending = filtered.filter(p => p.status === 'pending')
    if (!pending.length) return
    if (!window.confirm(`Approve all ${pending.length} pending payslip${pending.length !== 1 ? 's' : ''}?`)) return
    setApproving(true)
    const supabase = createClient()
    for (const p of pending) {
      try { await supabase.rpc('approve_payslip', { payment_id: p.id }) } catch {}
    }
    await loadPayroll(dateFrom, dateTo)
    setApproving(false)
  }

  async function releaseAll() {
    const releasable = filtered.filter(p => p.status === 'approved' && p.shared_with_employee === false)
    if (!releasable.length) { setError('No approved-but-unreleased payslips in this view.'); return }
    if (!window.confirm(`Release ${releasable.length} approved payslip${releasable.length !== 1 ? 's' : ''} to employees?`)) return
    setReleasing(true)
    const supabase = createClient()
    for (const p of releasable) {
      try { await supabase.rpc('release_payslip_to_employee', { payment_id: p.id }) } catch {}
    }
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
    const header = 'Account Holder,Bank Name,Account Number,Branch Code,Account Type,Amount (R),Reference'
    const rows   = filtered
      .filter(p => p.status === 'approved' && (p.net_pay ?? 0) > 0)
      .map(p => {
        const emp = p.employee
        const name = emp ? `${emp.name} ${emp.surname}`.trim() : ''
        return [
          `"${name}"`,
          emp?.bank_name        ?? '',
          emp?.account_number   ?? '',
          emp?.bank_branch_code ?? '',
          'Savings',
          (p.net_pay ?? 0).toFixed(2),
          `"SALARY ${p.period_start}"`,
        ].join(',')
      })
    downloadCSV([header, ...rows].join('\n'), `bank_payments_${dateFrom}.csv`)
  }

  function exportIRP5CSV() {
    // Simplified IRP5 data extract — PAYE/UIF split requires future Mission
    const taxYear = new Date(dateTo).getFullYear()
    const header  = 'Employee,ID Number,Period Start,Period End,Gross Income (R),Total Deductions (R),Net Income (R),Tax Year'
    const rows    = filtered
      .filter(p => p.status === 'approved')
      .map(p => {
        const emp  = p.employee
        const name = emp ? `${emp.name} ${emp.surname}`.trim() : ''
        return [
          `"${name}"`,
          emp?.id_number ?? '',
          p.period_start,
          p.period_end,
          (p.gross_pay  ?? 0).toFixed(2),
          (p.deductions ?? 0).toFixed(2),
          (p.net_pay    ?? 0).toFixed(2),
          taxYear,
        ].join(',')
      })
    downloadCSV([header, ...rows].join('\n'), `IRP5_${taxYear}.csv`)
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
            <button className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
              <span className="material-icons text-[18px]">settings</span>
            </button>
            {/* Lock/Unlock — writes to payroll_period_locks */}
            <button
              onClick={toggleLock}
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
            {/* Generate — calls hr_generate_payroll RPC */}
            <button
              onClick={handleGenerate}
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

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg py-2 px-4 flex flex-col items-center gap-0.5 bg-surface-elevated border border-divider">
            <span className="text-[17px] font-semibold text-text-primary">{fmtR(pendingGross)}</span>
            <span className="text-[10px] text-text-secondary">Pending Gross</span>
          </div>
          <div className="rounded-lg py-2 px-4 flex flex-col items-center gap-0.5 bg-surface-elevated border border-divider">
            <span className="text-[17px] font-semibold text-text-primary">{fmtR(approvedGross)}</span>
            <span className="text-[10px] text-text-secondary">Approved Gross</span>
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
    </div>
  )
}
