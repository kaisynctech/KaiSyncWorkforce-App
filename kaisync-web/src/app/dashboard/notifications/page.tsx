'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AppNotification, LeaveRequest, IncidentReport, PaymentApproval } from '@/types/database'

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
  high: { bg: '#FEF3C7', fg: '#92400E' },
  medium: { bg: '#DBEAFE', fg: '#1E40AF' },
  low: { bg: '#DCFCE7', fg: '#166534' },
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [pendingLeave, setPendingLeave] = useState<LeaveRequest[]>([])
  const [openIncidents, setOpenIncidents] = useState<IncidentReport[]>([])
  const [pendingPayments, setPendingPayments] = useState<PaymentApproval[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: me } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!me) { setLoading(false); return }

    const [notifRes, leaveRes, incidentRes, paymentRes] = await Promise.all([
      supabase.from('notifications').select('*').eq('company_id', me.company_id).eq('is_read', false).order('created_at', { ascending: false }),
      supabase.from('leave_requests').select('*').eq('company_id', me.company_id).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('incident_reports').select('*').eq('company_id', me.company_id).eq('status', 'open').order('created_at', { ascending: false }),
      supabase.from('payment_approvals').select('*').eq('company_id', me.company_id).eq('status', 'pending').order('created_at', { ascending: false }),
    ])

    setNotifications((notifRes.data ?? []) as AppNotification[])
    setPendingLeave((leaveRes.data ?? []) as LeaveRequest[])
    setOpenIncidents((incidentRes.data ?? []) as IncidentReport[])
    setPendingPayments((paymentRes.data ?? []) as PaymentApproval[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

  return (
    <div className="p-4 max-w-3xl mx-auto overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[22px] font-semibold text-text-primary">Notifications</h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-text-secondary text-[13px] hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <span className={`material-icons text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
          Refresh
        </button>
      </div>

      <div className="space-y-6">
        {/* IN-APP ALERTS */}
        <section>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-1">In-App Alerts</p>
          <p className="text-[12px] text-text-secondary mb-3">Client messages and system alerts appear here instantly (not SMS).</p>
          {notifications.length === 0 ? (
            <p className="text-text-secondary text-[13px]">No new in-app alerts.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map(n => (
                <div key={n.id} className="bg-surface rounded-lg border border-divider flex gap-[10px] p-3 cursor-pointer hover:bg-surface-elevated transition-colors">
                  <div className="w-1 rounded-full self-stretch shrink-0" style={{ background: n.color ?? '#3B82F6' }} />
                  <div className="flex-1 space-y-1">
                    <p className="font-semibold text-[14px] text-text-primary">{n.title}</p>
                    <p className="text-text-secondary text-[12px]">{n.body}</p>
                    <p className="text-primary text-[10px]">{fmtDate(n.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* PENDING LEAVE REQUESTS */}
        <section>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-2">Pending Leave Requests</p>
          {pendingLeave.length === 0 ? (
            <p className="text-text-secondary text-[13px]">No pending leave requests.</p>
          ) : (
            <div className="space-y-2">
              {pendingLeave.map(lr => (
                <div key={lr.id} className="bg-surface rounded-lg border border-divider p-3">
                  <div className="flex justify-between items-start">
                    <p className="font-semibold text-[14px] text-text-primary">{lr.leave_type}</p>
                    <span className="rounded-[10px] px-2 py-[3px] text-[11px] font-semibold" style={{ background: '#FEF3C7', color: '#92400E' }}>
                      Pending
                    </span>
                  </div>
                  <p className="text-text-secondary text-[12px] mt-1">{fmtDate(lr.start_date)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* OPEN INCIDENTS */}
        <section>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-2">Open Incidents</p>
          {openIncidents.length === 0 ? (
            <p className="text-text-secondary text-[13px]">No open incidents.</p>
          ) : (
            <div className="space-y-2">
              {openIncidents.map(inc => {
                const sev = SEVERITY_COLORS[inc.severity] ?? SEVERITY_COLORS.low
                return (
                  <div key={inc.id} className="bg-surface rounded-lg border border-divider p-3 flex justify-between items-start">
                    <div className="flex-1 space-y-0.5 mr-2">
                      <p className="text-text-primary text-[13px] font-medium line-clamp-2">{inc.description}</p>
                      <p className="text-text-secondary text-[12px]">{fmtDate(inc.created_at)}</p>
                    </div>
                    <span className="rounded-[10px] px-2 py-[3px] text-[11px] font-semibold shrink-0" style={{ background: sev.bg, color: sev.fg }}>
                      {inc.severity}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* PENDING PAYMENT APPROVALS */}
        <section>
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-2">Pending Payment Approvals</p>
          {pendingPayments.length === 0 ? (
            <p className="text-text-secondary text-[13px]">No pending payment approvals.</p>
          ) : (
            <div className="space-y-2">
              {pendingPayments.map(p => (
                <div key={p.id} className="bg-surface rounded-lg border border-divider p-3 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-[13px] text-text-primary">{p.period_label}</p>
                    <p className="text-text-secondary text-[12px]">R {p.gross_pay.toFixed(2)}</p>
                  </div>
                  <span className="rounded-[10px] px-2 py-[3px] text-[11px] font-semibold" style={{ background: '#FEF3C7', color: '#92400E' }}>
                    Pending
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
