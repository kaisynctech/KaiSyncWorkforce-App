'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FilterChip } from '@/components/ui/FilterChip'
import type { EmployeePayment } from '@/types/database'

type StatusFilter = 'all' | 'pending' | 'approved' | 'paid'

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

export default function PayrollPage() {
  const router = useRouter()
  const [payments, setPayments] = useState<EmployeePayment[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(firstOfMonthStr)
  const [dateTo, setDateTo] = useState(todayDateStr)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [isLocked, setIsLocked] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: me } = await supabase.from('employees').select('company_id').eq('user_id', user.id).maybeSingle()
    if (!me) { setLoading(false); return }

    const { data } = await supabase
      .from('employee_payments')
      .select('*, employee:employees(name, surname)')
      .eq('company_id', me.company_id)
      .order('created_at', { ascending: false })

    setPayments((data ?? []) as EmployeePayment[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function approvePayslip(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('approve_payslip', { payment_id: id }) } catch {}
    load()
  }

  async function rejectPayslip(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('reject_payslip', { payment_id: id }) } catch {}
    load()
  }

  async function releasePayslip(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('release_payslip_to_employee', { payment_id: id }) } catch {}
    load()
  }

  const filtered = payments.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const emp = p.employee as { name: string; surname: string } | undefined
      const name = emp ? `${emp.name} ${emp.surname}`.toLowerCase() : ''
      if (!name.includes(q) && !(p.period_label ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const pendingGross  = filtered.filter(p => p.status === 'pending').reduce((s, p) => s + (p.gross_pay ?? 0), 0)
  const approvedGross = filtered.filter(p => p.status === 'approved' || p.status === 'paid').reduce((s, p) => s + (p.gross_pay ?? 0), 0)

  async function approveAll() {
    const pending = filtered.filter(p => p.status === 'pending')
    const supabase = createClient()
    for (const p of pending) {
      try { await supabase.rpc('approve_payslip', { payment_id: p.id }) } catch {}
    }
    load()
  }

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
            <button onClick={() => setIsLocked(l => !l)} className="bg-surface-dark rounded-md h-9 w-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors">
              <span className="material-icons text-[18px]">{isLocked ? 'lock' : 'lock_open'}</span>
            </button>
            {(['Register', 'IRP5', 'Release All', 'Generate'] as const).map(lbl => (
              <button key={lbl} className="h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors">{lbl}</button>
            ))}
            <button onClick={approveAll} className="btn-primary h-9 px-3 text-[12px]">Approve All</button>
            {(['Bank CSV', 'Export'] as const).map(lbl => (
              <button key={lbl} className="h-9 px-3 text-[12px] rounded-md bg-surface-dark border border-border text-text-secondary hover:text-text-primary transition-colors">{lbl}</button>
            ))}
          </div>
        </div>

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

        {/* Date range */}
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
            <FilterChip key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
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
                <th style={{ width: 120 }} className="data-th">Period</th>
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
                  const emp = p.employee as { name: string; surname: string } | undefined
                  const empName = emp ? `${emp.name} ${emp.surname}` : '—'
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(`/dashboard/payroll/${p.id}`)}
                      className="bg-surface-card border-b border-divider cursor-pointer hover:bg-background transition-colors"
                    >
                      <td className="data-td text-text-primary text-sm font-medium">{empName}</td>
                      <td className="data-td text-text-secondary text-sm">{p.period_label}</td>
                      <td className="data-td text-sm text-right">{fmtR(p.gross_pay)}</td>
                      <td className="data-td text-text-secondary text-sm text-right">{fmtR(p.deductions)}</td>
                      <td className="data-td text-text-primary text-sm text-right font-medium">{fmtR(p.net_pay)}</td>
                      <td className="data-td text-text-secondary text-sm">{(p.hours ?? 0).toFixed(1)}h</td>
                      <td className="data-td">
                        <StatusBadge label={p.status} bg={stBg(p.status)} fg={stFg(p.status)} />
                      </td>
                      <td className="data-td text-[11px]" style={{ color: p.is_visible_to_employee ? '#16A34A' : '#6B7280' }}>
                        {p.is_visible_to_employee ? 'Shown' : 'Hidden'}
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
                            <button onClick={() => approvePayslip(p.id)} className="btn-primary h-[30px] px-2 text-[11px]">
                              Approve
                            </button>
                          )}
                          {p.can_release_to_employee && (
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
