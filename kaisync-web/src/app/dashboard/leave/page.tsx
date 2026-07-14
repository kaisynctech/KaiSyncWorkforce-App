'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatDate } from '@/lib/utils'
import type { LeaveRequest } from '@/types/database'

type Tab = 'pending' | 'all'

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-warning-dark text-warning' },
  approved: { label: 'Approved', cls: 'bg-success-dark text-success' },
  declined: { label: 'Declined', cls: 'bg-error-dark text-error' },
  cancelled: { label: 'Cancelled', cls: 'bg-background text-text-disabled' },
}

export default function LeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('pending')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    const { data } = await supabase
      .from('leave_requests')
      .select('*, employees(name, surname, employee_code)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    setRequests((data ?? []) as LeaveRequest[])
    setLoading(false)
  }

  async function handleAction(id: string, action: 'approved' | 'declined') {
    setActionLoading(id)
    const supabase = createClient()
    await supabase.from('leave_requests').update({
      status: action,
      reviewed_by: myEmployeeId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    await load()
    setActionLoading(null)
  }

  const filtered = tab === 'pending'
    ? requests.filter(r => r.status === 'pending')
    : requests

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
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Leave Requests</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {requests.filter(r => r.status === 'pending').length} pending
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-surface border border-divider rounded-md p-1 w-fit">
        {(['pending', 'all'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 h-8 rounded text-[13px] font-medium transition-colors capitalize ${
              tab === t ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'pending' ? `Pending (${requests.filter(r => r.status === 'pending').length})` : 'All'}
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
              {tab === 'pending' ? 'No pending leave requests' : 'No leave requests yet'}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map(req => {
              const emp = req.employees as { name: string; surname: string; employee_code: string | null } | undefined
              const badge = STATUS_BADGES[req.status] ?? STATUS_BADGES.cancelled
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
                    </div>
                    <p className="text-[13px] text-text-secondary mt-0.5">
                      <span className="font-medium text-text-primary capitalize">{req.leave_type.replace('_', ' ')}</span>
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
                        Decline
                      </button>
                      <button
                        onClick={() => handleAction(req.id, 'approved')}
                        disabled={actionLoading === req.id}
                        className="h-8 px-3 rounded-md text-[12px] font-medium bg-success-dark text-success hover:bg-green-100 transition-colors disabled:opacity-50"
                      >
                        Approve
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
