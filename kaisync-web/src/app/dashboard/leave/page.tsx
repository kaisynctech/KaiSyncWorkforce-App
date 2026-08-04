'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { loadScopedEmployeeIds, viewerSeesAllCompany } from '@/lib/employee-scope'
import { decideLeaveRequest, formatLeaveDecideError } from '@/lib/leave'
import { getCompanyAnnualDays, loadLeaveSettings, type LeaveSettingsMap } from '@/lib/leave-settings'
import { formatDate } from '@/lib/utils'
import type { LeaveRequest } from '@/types/database'

type Tab = 'pending' | 'all'

type OnLeaveRecord = {
  id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string } | null
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

  useEffect(() => { void load() }, [])

  async function load() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const today = new Date().toISOString().split('T')[0]

    const [scopeRes, settingsRes, reqsRes, onLeaveRes] = await Promise.all([
      loadScopedEmployeeIds(supabase, member.companyId, member.employeeId),
      loadLeaveSettings(supabase, member.companyId),
      supabase
        .from('leave_requests')
        .select('*, employees(name, surname, employee_code)')
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
                  <span className="font-medium text-text-primary">
                    {r.employees ? `${r.employees.name} ${r.employees.surname}` : 'Unknown'}
                  </span>
                  <span className="text-text-secondary">
                    {r.leave_type} · back {formatDate(r.end_date)}
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
          {(['pending', 'all'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 h-8 rounded text-[13px] font-medium transition-colors capitalize ${
                tab === t ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t === 'pending' ? `Pending (${pendingCount})` : 'All'}
            </button>
          ))}
        </div>

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
            <div className="overflow-x-auto">
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
                      employee_code: string | null
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
                          <p className="font-medium text-text-primary">{empName}</p>
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
            </div>
          )}
        </div>
      </div>

      {noteModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">
              {noteModal.decision === 'approved' ? 'Approve' : 'Decline'} leave
            </h3>
            <p className="text-[13px] text-text-secondary">
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
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                className="btn-outlined h-9 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDecide()}
                disabled={actionLoading === noteModal.requestId}
                className={`h-9 px-4 text-[13px] rounded-sm font-medium text-white disabled:opacity-50 ${
                  noteModal.decision === 'approved' ? 'bg-success hover:opacity-90' : 'bg-error hover:opacity-90'
                }`}
              >
                {actionLoading === noteModal.requestId
                  ? 'Saving…'
                  : noteModal.decision === 'approved'
                    ? 'Approve'
                    : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
