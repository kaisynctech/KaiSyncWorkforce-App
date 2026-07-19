'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface LeaveRequest {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  total_days: number
  status: string
  reason: string | null
  attachment_url: string | null
  created_at: string
}

interface LeaveSummary {
  leave_type:    string
  days_approved: number
  days_pending:  number
}

const LEAVE_TYPES = [
  'Annual Leave',
  'Sick Leave',
  'Family Responsibility',
  'Unpaid Leave',
  'Study Leave',
  'Maternity Leave',
  'Paternity Leave',
]

const LEAVE_TYPE_ICONS: Record<string, string> = {
  'Annual Leave':          'beach_access',
  'Sick Leave':            'local_hospital',
  'Family Responsibility': 'family_restroom',
  'Unpaid Leave':          'money_off',
  'Study Leave':           'school',
  'Maternity Leave':       'pregnant_woman',
  'Paternity Leave':       'child_friendly',
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-warning/10 text-warning',
  approved:  'bg-success/10 text-success',
  declined:  'bg-error/10 text-error',
  cancelled: 'bg-surface-elevated text-text-secondary',
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function computeSummary(requests: LeaveRequest[]): LeaveSummary[] {
  const map: Record<string, LeaveSummary> = {}
  for (const r of requests) {
    if (!map[r.leave_type]) {
      map[r.leave_type] = { leave_type: r.leave_type, days_approved: 0, days_pending: 0 }
    }
    if (r.status === 'approved') map[r.leave_type].days_approved += r.total_days
    if (r.status === 'pending')  map[r.leave_type].days_pending  += r.total_days
  }
  return Object.values(map)
}

function calcTotalDays(start: string, end: string): number {
  if (!start || !end) return 1
  return Math.max(
    1,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  )
}

export default function EmployeeLeavePage() {
  const [requests,  setRequests]   = useState<LeaveRequest[]>([])
  const [loading,   setLoading]    = useState(true)
  const [showForm,  setShowForm]   = useState(false)
  const [editRequest, setEditRequest] = useState<LeaveRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError,  setFormError] = useState<string | null>(null)
  const [companyId, setCompanyId]  = useState<string | null>(null)
  const [empId,     setEmpId]      = useState<string | null>(null)

  // Form fields
  const [leaveType, setLeaveType] = useState('Annual Leave')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [reason,    setReason]    = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const tokRef  = useRef<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmpId(member.employeeId)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('employee_get_leave_requests', {
      p_company_id:    member.companyId,
      p_employee_id:   member.employeeId,
      p_session_token: tok,
    })
    if (!error) setRequests((data as LeaveRequest[]) ?? [])
    setLoading(false)
  }

  function openForm(req?: LeaveRequest) {
    if (req) {
      setEditRequest(req)
      setLeaveType(req.leave_type)
      setStartDate(req.start_date)
      setEndDate(req.end_date)
      setReason(req.reason ?? '')
    } else {
      setEditRequest(null)
      setLeaveType('Annual Leave')
      setStartDate('')
      setEndDate('')
      setReason('')
    }
    setFormError(null)
    if (fileRef.current) fileRef.current.value = ''
    setShowForm(true)
  }

  async function submit() {
    if (!empId || !companyId || !startDate || !endDate) {
      setFormError('Please fill in all required fields.')
      return
    }
    setSubmitting(true)
    setFormError(null)

    const supabase = createClient()
    const tok = tokRef.current

    let attachmentUrl: string | null = null
    const file = fileRef.current?.files?.[0]
    if (file) {
      const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
      const path = `leave-attachments/${companyId}/${empId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: true })
      if (upErr) { setFormError(upErr.message); setSubmitting(false); return }
      attachmentUrl = path
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)
    const totalDays = calcTotalDays(startDate, endDate)

    let error: { message: string } | null = null

    if (editRequest) {
      const res = await rpc('employee_update_leave_request', {
        p_id:             editRequest.id,
        p_employee_id:    empId,
        p_leave_type:     leaveType,
        p_start_date:     startDate,
        p_end_date:       endDate,
        p_total_days:     totalDays,
        p_reason:         reason || null,
        p_attachment_url: attachmentUrl,
        p_session_token:  tok,
      })
      error = res.error
    } else {
      const res = await rpc('employee_submit_leave_request', {
        p_company_id:     companyId,
        p_employee_id:    empId,
        p_leave_type:     leaveType,
        p_start_date:     startDate,
        p_end_date:       endDate,
        p_total_days:     totalDays,
        p_reason:         reason || null,
        p_attachment_url: attachmentUrl,
        p_session_token:  tok,
      })
      error = res.error
    }

    if (error) {
      setFormError(error.message)
    } else {
      setShowForm(false)
      await init()
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  const sorted = [...requests].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1
    if (b.status === 'pending' && a.status !== 'pending') return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const summary = computeSummary(requests)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Leave</h1>
        <button onClick={() => openForm()}
          className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">
          <span className="material-icons text-[16px]">add</span>Apply
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Leave summary — computed from requests */}
        {summary.length > 0 && (
          <div>
            <p className="section-label mb-2">Leave Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {summary.map(s => (
                <div key={s.leave_type} className="bg-surface border border-divider rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-icons text-primary text-[18px]">
                      {LEAVE_TYPE_ICONS[s.leave_type] ?? 'event_busy'}
                    </span>
                    <p className="text-[12px] font-semibold text-text-primary truncate">{s.leave_type}</p>
                  </div>
                  <p className="text-[22px] font-bold text-text-primary">{s.days_approved}</p>
                  <p className="text-[11px] text-text-disabled">days approved</p>
                  {s.days_pending > 0 && (
                    <p className="text-[11px] text-warning mt-0.5">{s.days_pending}d pending</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Requests list */}
        <div>
          <p className="section-label mb-2">Leave Requests</p>
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
              <span className="material-icons text-[48px] text-text-disabled">event_available</span>
              <p className="text-[14px]">No leave requests yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Type</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Start</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">End</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Days</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Reason</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide text-center">Doc</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {sorted.map(req => (
                    <tr key={req.id} className="hover:bg-surface-elevated transition-colors">
                      <td className="px-4 py-3 text-[13px] font-semibold text-text-primary whitespace-nowrap">
                        {req.leave_type}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {fmtDate(req.start_date)}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {fmtDate(req.end_date)}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                        {req.total_days}d
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[req.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-disabled max-w-[160px] truncate">
                        {req.reason ? <span className="italic">&ldquo;{req.reason}&rdquo;</span> : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {req.attachment_url ? (
                          <a href={req.attachment_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-divider text-text-secondary hover:border-primary hover:text-primary transition-colors"
                            title="View attachment">
                            <span className="material-icons text-[14px]">attach_file</span>
                          </a>
                        ) : (
                          <span className="text-text-disabled">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {req.status === 'pending' && (
                          <button onClick={() => openForm(req)}
                            className="text-[12px] text-primary font-semibold hover:underline whitespace-nowrap">
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Apply / Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">
                {editRequest ? 'Edit Leave Request' : 'Apply for Leave'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>

            {formError && (
              <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
                <p className="text-[13px] text-error font-semibold">{formError}</p>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Leave Type</label>
                <select className="input" value={leaveType} onChange={e => setLeaveType(e.target.value)}>
                  {LEAVE_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Start Date</label>
                  <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">End Date</label>
                  <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              {startDate && endDate && endDate >= startDate && (
                <p className="text-[12px] text-text-secondary">
                  Duration: <span className="font-semibold text-text-primary">{calcTotalDays(startDate, endDate)} day{calcTotalDays(startDate, endDate) !== 1 ? 's' : ''}</span>
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Reason (optional)</label>
                <textarea className="input resize-none" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Supporting Document (optional)</label>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-[13px] text-text-secondary" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowForm(false)} disabled={submitting}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submit} disabled={submitting}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {submitting ? 'Submitting…' : editRequest ? 'Update' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
