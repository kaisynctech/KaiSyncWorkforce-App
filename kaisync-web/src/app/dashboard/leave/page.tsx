'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatDate } from '@/lib/utils'
import type { LeaveRequest } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'pending' | 'all'

type OnLeaveRecord = {
  id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-warning-dark text-warning' },
  approved:  { label: 'Approved',  cls: 'bg-success-dark text-success' },
  declined:  { label: 'Declined',  cls: 'bg-error-dark text-error' },
  rejected:  { label: 'Rejected',  cls: 'bg-error-dark text-error' },
  cancelled: { label: 'Cancelled', cls: 'bg-background text-text-disabled' },
}

const ANNUAL_DEFAULTS: Record<string, number> = {
  annual_leave:          15,
  sick_leave:            30,
  family_responsibility:  3,
  maternity_leave:       90,
  study_leave:            5,
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeavePage() {
  const [requests,      setRequests]      = useState<LeaveRequest[]>([])
  const [onLeaveToday,  setOnLeaveToday]  = useState<OnLeaveRecord[]>([])
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [myEmployeeId,  setMyEmployeeId]  = useState<string | null>(null)
  const [tab,           setTab]           = useState<Tab>('pending')
  const [loading,       setLoading]       = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)

  // Filters
  const [search,         setSearch]         = useState('')
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const member   = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    const today = new Date().toISOString().split('T')[0]

    const [{ data: reqs }, { data: onLeave }] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('*, employees(name, surname, employee_code)')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('leave_requests')
        .select('id, leave_type, end_date, employees(name, surname)')
        .eq('company_id', member.companyId)
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('end_date'),
    ])

    setRequests((reqs ?? []) as LeaveRequest[])
    setOnLeaveToday((onLeave ?? []) as unknown as OnLeaveRecord[])
    setLoading(false)
  }

  async function handleAction(requestId: string, decision: 'approved' | 'declined') {
    if (!companyId) return
    setActionLoading(requestId)
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('decide_leave_request', {
      p_company_id:        companyId,
      p_leave_request_id:  requestId,
      p_decision:          decision,
      p_note:              null,
    })
    if (rpcErr) setError(rpcErr.message)
    await load()
    setActionLoading(null)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  // Unique leave types for filter pills
  const leaveTypes = Array.from(new Set(requests.map(r => r.leave_type))).sort()

  // YTD approved usage per employee + leave_type (for balance badges on pending rows)
  const yearStart = `${new Date().getFullYear()}-01-01`
  const usedByKey = requests
    .filter(r => r.status === 'approved' && r.start_date >= yearStart)
    .reduce<Record<string, number>>((acc, r) => {
      const key = `${r.employee_id}:${r.leave_type}`
      acc[key] = (acc[key] ?? 0) + r.days_requested
      return acc
    }, {})

  const filtered = requests.filter(r => {
    if (tab === 'pending' && r.status !== 'pending') return false
    if (leaveTypeFilter !== 'all' && r.leave_type !== leaveTypeFilter) return false
    if (search) {
      const emp  = r.employees as { name: string; surname: string } | undefined
      const name = `${emp?.name ?? ''} ${emp?.surname ?? ''}`.toLowerCase()
      if (!name.includes(search.toLowerCase())) return false
    }
    return true
  })

  const pendingCount = requests.filter(r => r.status === 'pending').length

  // ── Not-linked guard ───────────────────────────────────────────────────────

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
    <div className="p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Leave Requests</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{pendingCount} pending</p>
        </div>
      </div>

      {/* On Leave Today */}
      {!loading && onLeaveToday.length > 0 && (
        <div className="bg-surface border border-divider rounded-lg p-4 mb-4">
          <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2.5">
            On Leave Today ({onLeaveToday.length})
          </p>
          <div className="space-y-1">
            {onLeaveToday.map(r => (
              <div key={r.id} className="flex items-center justify-between text-[13px]">
                <span className="font-medium text-text-primary">
                  {r.employees ? `${r.employees.name} ${r.employees.surname}` : 'Unknown'}
                </span>
                <span className="text-text-secondary capitalize">
                  {r.leave_type.replace(/_/g, ' ')} · back {formatDate(r.end_date)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md mb-3">
        <span className="material-icons text-text-disabled text-[18px]">search</span>
        <input
          type="text"
          placeholder="Search by employee name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-text-disabled hover:text-text-secondary">
            <span className="material-icons text-[16px]">close</span>
          </button>
        )}
      </div>

      {/* Leave type filter pills */}
      {!loading && leaveTypes.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 flex-wrap">
          <button
            onClick={() => setLeaveTypeFilter('all')}
            className={`shrink-0 h-7 px-3 rounded-full text-[11px] font-medium transition-colors ${
              leaveTypeFilter === 'all'
                ? 'bg-primary text-white'
                : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            All
          </button>
          {leaveTypes.map(lt => (
            <button
              key={lt}
              onClick={() => setLeaveTypeFilter(lt)}
              className={`shrink-0 h-7 px-3 rounded-full text-[11px] font-medium capitalize transition-colors ${
                leaveTypeFilter === lt
                  ? 'bg-primary text-white'
                  : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {lt.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex gap-1 mb-5 bg-surface border border-divider rounded-md p-1 w-fit">
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

      {/* Request list */}
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
          <div>
            {filtered.map(req => {
              const emp   = req.employees as { name: string; surname: string; employee_code: string | null } | undefined
              const badge = STATUS_BADGES[req.status] ?? STATUS_BADGES.cancelled

              // Balance badge for pending rows
              const balanceKey  = `${req.employee_id}:${req.leave_type}`
              const used        = usedByKey[balanceKey] ?? 0
              const annual      = ANNUAL_DEFAULTS[req.leave_type] ?? 5
              const remaining   = Math.max(0, annual - used)

              return (
                <div key={req.id} className="flex items-start gap-4 px-5 py-4 border-b border-divider last:border-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="material-icons text-primary text-[18px]">person</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-text-primary">
                        {emp ? `${emp.name} ${emp.surname}` : 'Unknown'}
                      </p>
                      <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {req.status === 'pending' && (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-pill ${
                          remaining <= 0
                            ? 'bg-error/10 text-error'
                            : remaining <= 3
                              ? 'bg-warning-dark text-warning'
                              : 'bg-success-dark text-success'
                        }`}>
                          {remaining} day{remaining !== 1 ? 's' : ''} remaining
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-text-secondary mt-0.5">
                      <span className="font-medium text-text-primary capitalize">
                        {req.leave_type.replace(/_/g, ' ')}
                      </span>
                      {' · '}{formatDate(req.start_date)} – {formatDate(req.end_date)}
                      {' · '}{req.days_requested} day{req.days_requested !== 1 ? 's' : ''}
                    </p>
                    {req.reason && (
                      <p className="text-[12px] text-text-secondary mt-1 italic">"{req.reason}"</p>
                    )}
                  </div>
                  {req.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleAction(req.id, 'declined')}
                        disabled={actionLoading === req.id}
                        className="h-8 px-3 rounded-md text-[12px] font-medium bg-error-dark text-error hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === req.id ? '…' : 'Decline'}
                      </button>
                      <button
                        onClick={() => handleAction(req.id, 'approved')}
                        disabled={actionLoading === req.id}
                        className="h-8 px-3 rounded-md text-[12px] font-medium bg-success-dark text-success hover:bg-green-100 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === req.id ? '…' : 'Approve'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
