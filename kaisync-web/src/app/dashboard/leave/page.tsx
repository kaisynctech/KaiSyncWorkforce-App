'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadScopedEmployeeIds, viewerSeesAllCompany } from '@/lib/employee-scope'
import { decideLeaveRequest, formatLeaveDecideError } from '@/lib/leave'
import { getCompanyAnnualDays, loadLeaveSettings, type LeaveSettingsMap } from '@/lib/leave-settings'
import { formatDate, returnToWorkLabel, localISODate } from '@/lib/utils'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import { ModalShell } from '@/components/ui/ModalShell'
import type { LeaveRequest } from '@/types/database'

type Tab = 'pending' | 'all' | 'upcoming'

type OnLeaveRecord = {
  id: string
  employee_id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string } | null
}

type UpcomingLeave = {
  id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  total_days: number | null
  status: string
  employees: { name: string; surname: string } | null
}

function monthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  }
}

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function shiftYearMonth(yearMonth: string, delta: number) {
  const [year, month] = yearMonth.split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-warning-dark text-warning' },
  approved:  { label: 'Approved',  cls: 'bg-success-dark text-success' },
  declined:  { label: 'Declined',  cls: 'bg-error-dark text-error' },
  rejected:  { label: 'Rejected',  cls: 'bg-error-dark text-error' },
  cancelled: { label: 'Cancelled', cls: 'bg-background text-text-disabled' },
}

export default function LeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [onLeaveToday, setOnLeaveToday] = useState<OnLeaveRecord[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [leaveSettings, setLeaveSettings] = useState<LeaveSettingsMap>({})
  const [seesAll, setSeesAll] = useState(true)
  const [tab, setTab] = useState<Tab>('pending')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [noteModal, setNoteModal] = useState<{
    requestId: string
    decision: 'approved' | 'declined'
    employeeName: string
  } | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [upcoming, setUpcoming] = useState<UpcomingLeave[]>([])
  const [upcomingLoading, setUpcomingLoading] = useState(false)
  const [leaveMonth, setLeaveMonth] = useState(currentYearMonth)
  const [scopeIds, setScopeIds] = useState<Set<string> | null>(null)
  const upcomingRequestRef = useRef(0)

  useEffect(() => { void load() }, [])

  async function load() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const today = localISODate()

    const [scopeRes, settingsRes, reqsRes, onLeaveRes] = await Promise.all([
      loadScopedEmployeeIds(supabase, member.companyId, member.employeeId),
      loadLeaveSettings(supabase, member.companyId),
      supabase
        .from('leave_requests')
        .select('*, employees(name, surname, employee_number)')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('leave_requests')
        .select('id, leave_type, end_date, employee_id, employees(name, surname)')
        .eq('company_id', member.companyId)
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('end_date'),
    ])

    if (!scopeRes.ok) { setError(scopeRes.message); setLoading(false); return }
    if (reqsRes.error) { setError(reqsRes.error.message); setLoading(false); return }
    if (onLeaveRes.error) { setError(onLeaveRes.error.message); setLoading(false); return }
    const ids = scopeRes.seesAll ? null : scopeRes.ids
    setScopeIds(ids)
    setSeesAll(scopeRes.seesAll || viewerSeesAllCompany(scopeRes.viewer.access_level))
    if (settingsRes.ok) setLeaveSettings(settingsRes.data)

    const inScope = (employeeId: string) => !ids || ids.has(employeeId)
    setRequests(((reqsRes.data ?? []) as LeaveRequest[]).filter(r => inScope(r.employee_id)))
    setOnLeaveToday(
      ((onLeaveRes.data ?? []) as unknown as (OnLeaveRecord & { employee_id: string })[])
        .filter(r => inScope(r.employee_id))
    )
    setLoading(false)
  }

  function openDecide(
    requestId: string,
    decision: 'approved' | 'declined',
    employeeName: string
  ) {
    setActionError(null)
    setDecisionNote('')
    setNoteModal({ requestId, decision, employeeName })
  }

  async function confirmDecide() {
    if (!companyId || !noteModal) return
    setActionLoading(noteModal.requestId)
    setActionError(null)
    const supabase = createClient()
    const result = await decideLeaveRequest(supabase, {
      companyId,
      leaveRequestId: noteModal.requestId,
      decision: noteModal.decision,
      note: decisionNote,
    })
    setActionLoading(null)
    if (!result.ok) {
      setActionError(formatLeaveDecideError(result.message))
      return
    }
    setNoteModal(null)
    setDecisionNote('')
    await load()
  }

  async function loadUpcoming(yearMonth: string) {
    if (!companyId) return
    const request = ++upcomingRequestRef.current
    setUpcomingLoading(true)
    const supabase = createClient()
    const { start, end } = monthBounds(yearMonth)
    const { data, error: loadError } = await supabase
      .from('leave_requests')
      .select('id, employee_id, leave_type, start_date, end_date, total_days, status, employees(name, surname)')
      .eq('company_id', companyId)
      .in('status', ['approved', 'pending'])
      .lte('start_date', end)
      .gte('end_date', start)
      .order('start_date', { ascending: true })
    if (request !== upcomingRequestRef.current) return
    if (loadError) {
      setActionError(loadError.message)
      setUpcoming([])
      setUpcomingLoading(false)
      return
    }
    const inScope = (employeeId: string) => !scopeIds || scopeIds.has(employeeId)
    const rows = ((data ?? []) as unknown as (UpcomingLeave & { employees: UpcomingLeave['employees'] | UpcomingLeave['employees'][] })[]).map(row => {
      const linked = Array.isArray(row.employees) ? row.employees[0] ?? null : row.employees
      return { ...row, employees: linked }
    })
    if (request !== upcomingRequestRef.current) return
    setUpcoming(rows.filter(row => inScope(row.employee_id)))
    setUpcomingLoading(false)
  }

  function changeLeaveMonth(delta: number) {
    const next = shiftYearMonth(leaveMonth, delta)
    setLeaveMonth(next)
    void loadUpcoming(next)
  }

  const leaveTypes = Array.from(new Set(requests.map(r => r.leave_type))).sort()
  const yearStart = `${new Date().getFullYear()}-01-01`
  const usedByKey = requests
    .filter(r => r.status === 'approved' && r.start_date >= yearStart)
    .reduce<Record<string, number>>((acc, r) => {
      const key = `${r.employee_id}:${r.leave_type}`
      acc[key] = (acc[key] ?? 0) + (r.total_days ?? 0)
      return acc
    }, {})

  const filtered = requests.filter(r => {
    if (tab === 'pending' && r.status !== 'pending') return false
    if (tab === 'all' && statusFilter !== 'all' && r.status !== statusFilter) return false
    if (leaveTypeFilter !== 'all' && r.leave_type !== leaveTypeFilter) return false
    if (search) {
      const emp = r.employees as { name: string; surname: string } | undefined
      const name = `${emp?.name ?? ''} ${emp?.surname ?? ''}`.toLowerCase()
      if (!name.includes(search.toLowerCase())) return false
    }
    return true
  })

  const pendingCount = requests.filter(r => r.status === 'pending').length

  const upcomingView = upcoming.filter(row => {
    if (leaveTypeFilter !== 'all' && row.leave_type !== leaveTypeFilter) return false
    if (search) {
      const name = `${row.employees?.name ?? ''} ${row.employees?.surname ?? ''}`.toLowerCase()
      if (!name.includes(search.toLowerCase())) return false
    }
    return true
  })

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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-surface border-b border-divider">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">
            {seesAll ? 'Leave Requests' : 'Team Leave'}
          </h1>
          <p className="text-[12px] text-text-secondary mt-0.5">{pendingCount} pending</p>
        </div>
        <Link
          href="/dashboard/leave/apply"
          className="h-9 px-3 rounded-sm border border-border text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors inline-flex items-center"
        >
          Apply for employee
        </Link>
      </div>

      {actionError && (
        <div className="mx-4 mt-3 rounded-sm border border-error/40 bg-error-dark/30 px-3 py-2 flex items-start justify-between gap-3">
          <p className="text-[13px] text-error">{actionError}</p>
          <button type="button" onClick={() => setActionError(null)} className="text-error shrink-0">
            <span className="material-icons text-[16px]">close</span>
          </button>
        </div>
      )}
      {error && error !== 'not_linked' && (
        <p className="px-4 py-2 text-error text-[13px]">{error}</p>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!loading && onLeaveToday.length > 0 && (
          <div className="bg-surface border border-divider rounded-lg p-4">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2.5">
              On Leave Today ({onLeaveToday.length})
            </p>
            <div className="space-y-1">
              {onLeaveToday.map(r => (
                <div key={r.id} className="flex items-center justify-between text-[13px]">
                  <Link href={`/dashboard/employees/${r.employee_id}?tab=leave`} className="font-medium text-text-primary hover:text-primary hover:underline">
                    {r.employees ? `${r.employees.name} ${r.employees.surname}` : 'Unknown'}
                  </Link>
                  <span className="text-text-secondary">
                    {r.leave_type} · back {returnToWorkLabel(r.end_date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md flex-1 min-w-[200px]">
            <span className="material-icons text-text-disabled text-[18px]">search</span>
            <input
              type="text"
              placeholder="Search by employee name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
          <select
            value={leaveTypeFilter}
            onChange={e => setLeaveTypeFilter(e.target.value)}
            className="h-10 px-3 rounded-md border border-border bg-surface text-[13px] text-text-primary"
          >
            <option value="all">All types</option>
            {leaveTypes.map(lt => (
              <option key={lt} value={lt}>{lt}</option>
            ))}
          </select>
          {tab === 'all' && (
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="h-10 px-3 rounded-md border border-border bg-surface text-[13px] text-text-primary"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="declined">Declined</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}
        </div>

        <div className="flex gap-1 bg-surface border border-divider rounded-md p-1 w-fit">
          {(['pending', 'upcoming', 'all'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                if (t === 'upcoming') void loadUpcoming(leaveMonth)
              }}
              className={`px-4 h-8 rounded text-[13px] font-medium transition-colors capitalize ${
                tab === t ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t === 'pending' ? `Pending (${pendingCount})` : t === 'upcoming' ? 'Upcoming' : 'All'}
            </button>
          ))}
        </div>

        {tab === 'upcoming' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[13px] text-text-secondary">
                Approved and pending leave in {monthLabel(leaveMonth)}. Back is the day they return.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => changeLeaveMonth(-1)}
                  className="h-9 w-9 rounded-md border border-border bg-surface text-text-primary"
                  aria-label="Previous month"
                >
                  <span className="material-icons text-[18px]">chevron_left</span>
                </button>
                <span className="min-w-[140px] text-center text-[13px] font-semibold text-text-primary">
                  {monthLabel(leaveMonth)}
                </span>
                <button
                  type="button"
                  onClick={() => changeLeaveMonth(1)}
                  className="h-9 w-9 rounded-md border border-border bg-surface text-text-primary"
                  aria-label="Next month"
                >
                  <span className="material-icons text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
            <div className="bg-surface rounded-lg border border-divider overflow-hidden">
              {upcomingLoading ? (
                <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
              ) : upcomingView.length === 0 ? (
                <div className="py-16 text-center">
                  <span className="material-icons text-[48px] text-text-disabled block mb-2">event_available</span>
                  <p className="text-[14px] text-text-secondary">No leave in {monthLabel(leaveMonth)}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-divider bg-surface-elevated/50">
                        <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Employee</th>
                        <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Type</th>
                        <th className="text-left px-4 py-2.5 font-medium text-text-secondary">From</th>
                        <th className="text-left px-4 py-2.5 font-medium text-text-secondary">To</th>
                        <th className="text-center px-4 py-2.5 font-medium text-text-secondary">Days</th>
                        <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Back</th>
                        <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingView.map(row => {
                        const badge = STATUS_BADGES[row.status] ?? STATUS_BADGES.cancelled
                        const name = row.employees ? `${row.employees.name} ${row.employees.surname}` : 'Unknown'
                        return (
                          <tr key={row.id} className="border-b border-divider last:border-0">
                            <td className="px-4 py-3">
                              <Link href={`/dashboard/employees/${row.employee_id}?tab=leave`} className="font-medium text-text-primary hover:text-primary hover:underline">
                                {name}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-text-primary">{row.leave_type}</td>
                            <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{formatDate(row.start_date)}</td>
                            <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{formatDate(row.end_date)}</td>
                            <td className="px-4 py-3 text-center text-text-primary">{row.total_days ?? '—'}</td>
                            <td className="px-4 py-3 text-text-secondary whitespace-nowrap">back {returnToWorkLabel(row.end_date)}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
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
        ) : (
        <div className="bg-surface rounded-lg border border-divider overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <span className="material-icons text-[48px] text-text-disabled block mb-2">event_available</span>
              <p className="text-[14px] text-text-secondary">
                {tab === 'pending' ? 'No pending leave requests' : 'No leave requests match your filters'}
              </p>
            </div>
          ) : (
            <ResponsiveDataView
              table={
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-divider bg-surface-elevated/50">
                      <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Employee</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Dates</th>
                      <th className="text-center px-4 py-2.5 font-medium text-text-secondary">Days</th>
                      <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Status</th>
                      <th className="text-right px-4 py-2.5 font-medium text-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(req => {
                      const emp = req.employees as {
                        name: string
                        surname: string
                        employee_number: string | null
                      } | undefined
                      const badge = STATUS_BADGES[req.status] ?? STATUS_BADGES.cancelled
                      const empName = emp ? `${emp.name} ${emp.surname}` : 'Unknown'
                      const balanceKey = `${req.employee_id}:${req.leave_type}`
                      const used = usedByKey[balanceKey] ?? 0
                      const annual = getCompanyAnnualDays(req.leave_type, leaveSettings)
                      const remaining = Math.max(0, annual - used)

                      return (
                        <tr key={req.id} className="border-b border-divider last:border-0 hover:bg-background/60">
                          <td className="px-4 py-3">
                            <Link href={`/dashboard/employees/${req.employee_id}?tab=leave`} className="font-medium text-text-primary hover:text-primary hover:underline">
                              {empName}
                            </Link>
                            {req.reason && (
                              <p className="text-[11px] text-text-secondary mt-0.5 truncate max-w-[220px]" title={req.reason}>
                                {req.reason}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-text-primary">
                            {req.leave_type}
                            {req.status === 'pending' && (
                              <p className={`text-[11px] mt-0.5 ${
                                remaining <= 0 ? 'text-error' : remaining <= 3 ? 'text-warning' : 'text-success'
                              }`}>
                                {remaining} days remaining
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                            {formatDate(req.start_date)} – {formatDate(req.end_date)}
                          </td>
                          <td className="px-4 py-3 text-center text-text-primary">{req.total_days}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {req.status === 'pending' ? (
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => openDecide(req.id, 'declined', empName)}
                                  disabled={actionLoading === req.id}
                                  className="h-8 px-3 rounded-md text-[12px] font-medium bg-error-dark text-error hover:bg-red-100 transition-colors disabled:opacity-50"
                                >
                                  Decline
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDecide(req.id, 'approved', empName)}
                                  disabled={actionLoading === req.id}
                                  className="h-8 px-3 rounded-md text-[12px] font-medium bg-success-dark text-success hover:bg-green-100 transition-colors disabled:opacity-50"
                                >
                                  Approve
                                </button>
                              </div>
                            ) : (
                              <span className="text-text-disabled">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              }
              mobile={
                <>
                  {filtered.map(req => {
                    const emp = req.employees as {
                      name: string
                      surname: string
                      employee_number: string | null
                    } | undefined
                    const badge = STATUS_BADGES[req.status] ?? STATUS_BADGES.cancelled
                    const empName = emp ? `${emp.name} ${emp.surname}` : 'Unknown'
                    const balanceKey = `${req.employee_id}:${req.leave_type}`
                    const used = usedByKey[balanceKey] ?? 0
                    const annual = getCompanyAnnualDays(req.leave_type, leaveSettings)
                    const remaining = Math.max(0, annual - used)
                    return (
                      <DataCard key={req.id}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <DataCardTitle>
                              <Link href={`/dashboard/employees/${req.employee_id}?tab=leave`} className="hover:underline">
                                {empName}
                              </Link>
                            </DataCardTitle>
                            <DataCardMeta>{req.leave_type} · {req.total_days} day{req.total_days !== 1 ? 's' : ''}</DataCardMeta>
                          </div>
                          <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium shrink-0 ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <DataCardRow
                          label="Dates"
                          value={`${formatDate(req.start_date)} – ${formatDate(req.end_date)}`}
                        />
                        {req.status === 'pending' && (
                          <DataCardRow label="Remaining" value={`${remaining} days`} />
                        )}
                        {req.status === 'pending' && (
                          <div className="flex gap-2 mt-3">
                            <button
                              type="button"
                              onClick={() => openDecide(req.id, 'declined', empName)}
                              disabled={actionLoading === req.id}
                              className="flex-1 h-11 rounded-md text-[13px] font-medium bg-error-dark text-error disabled:opacity-50"
                            >
                              Decline
                            </button>
                            <button
                              type="button"
                              onClick={() => openDecide(req.id, 'approved', empName)}
                              disabled={actionLoading === req.id}
                              className="flex-1 h-11 rounded-md text-[13px] font-medium bg-success-dark text-success disabled:opacity-50"
                            >
                              Approve
                            </button>
                          </div>
                        )}
                      </DataCard>
                    )
                  })}
                </>
              }
            />
          )}
        </div>
        )}
      </div>

      <ModalShell
        open={Boolean(noteModal)}
        onClose={() => setNoteModal(null)}
        title={noteModal ? `${noteModal.decision === 'approved' ? 'Approve' : 'Decline'} leave` : undefined}
        footer={
          noteModal ? (
            <>
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                className="btn-outlined h-11 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDecide()}
                disabled={actionLoading === noteModal.requestId}
                className={`h-11 px-4 text-[13px] rounded-sm font-medium text-white disabled:opacity-50 ${
                  noteModal.decision === 'approved' ? 'bg-success hover:opacity-90' : 'bg-error hover:opacity-90'
                }`}
              >
                {actionLoading === noteModal.requestId
                  ? 'Saving…'
                  : noteModal.decision === 'approved'
                    ? 'Approve'
                    : 'Decline'}
              </button>
            </>
          ) : null
        }
      >
        {noteModal && (
          <>
            <p className="text-[13px] text-text-secondary mb-3">
              {noteModal.employeeName} — optional note for the decision record.
            </p>
            <textarea
              value={decisionNote}
              onChange={e => setDecisionNote(e.target.value)}
              rows={3}
              placeholder="Decision note (optional)"
              className="dark-entry w-full resize-none"
              autoFocus
            />
          </>
        )}
      </ModalShell>
    </div>
  )
}
