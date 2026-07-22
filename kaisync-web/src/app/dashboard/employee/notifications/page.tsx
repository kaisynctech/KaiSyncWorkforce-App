'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { AUTH_ROUTES } from '@/lib/auth/employee-routing'
import {
  countUnreadAppNotifications,
  incidentToNotificationItem,
  leaveToNotificationItem,
  mapAppNotification,
  parseNotificationsRpcJson,
  sortNotificationsUnreadFirst,
  type UnifiedNotificationItem,
} from '@/lib/notification-feed'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function EmployeeNotificationsPage() {
  const router = useRouter()
  const [items, setItems] = useState<UnifiedNotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [empId, setEmpId] = useState<string | null>(null)
  const [tok, setTok] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setEmpId(member.employeeId)
    setCompanyId(member.companyId)

    const token = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    setTok(token)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

    const [notifRes, leaveRes, incRes] = await Promise.all([
      rpc('employee_get_my_notifications_for_employee', {
        p_employee_id: member.employeeId,
        p_session_token: token,
      }),
      rpc('employee_get_leave_requests', {
        p_company_id: member.companyId,
        p_employee_id: member.employeeId,
        p_session_token: token,
      }),
      rpc('employee_get_incidents', {
        p_company_id: member.companyId,
        p_employee_id: member.employeeId,
        p_job_id: null,
        p_include_closed: true,
        p_session_token: token,
      }),
    ])

    const appItems = parseNotificationsRpcJson(notifRes.data).map(mapAppNotification)

    const leaveItems = ((leaveRes.data as Parameters<typeof leaveToNotificationItem>[0][]) ?? [])
      .slice(0, 20)
      .map(leaveToNotificationItem)

    const allInc = ((incRes.data as Parameters<typeof incidentToNotificationItem>[0][]) ?? [])
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
    const incItems = allInc.map(incidentToNotificationItem)

    setItems(sortNotificationsUnreadFirst([...appItems, ...leaveItems, ...incItems]))
    setLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)

    if (!companyId || !empId) {
      return () => window.removeEventListener('focus', onFocus)
    }

    const supabase = createClient()
    const channel = supabase
      .channel(`emp-notifs-${empId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_notifications' },
        () => { void load() },
      )
      .subscribe()

    return () => {
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [companyId, empId, load])

  async function markRead(item: UnifiedNotificationItem) {
    if (item.source !== 'app' || !empId) return
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_mark_notification_read_for_employee', {
        p_employee_id: empId,
        p_notification_id: item.id as number,
        p_session_token: tok,
      })
      setItems(prev => prev.map(n => n.key === item.key ? { ...n, is_read: true } : n))
    } catch { /* non-critical */ }
  }

  async function markAllRead() {
    const unread = items.filter(n => !n.is_read && n.source === 'app')
    await Promise.all(unread.map(n => markRead(n)))
  }

  const unreadAppCount = countUnreadAppNotifications(items)
  const unreadCount = items.filter(n => !n.is_read).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] font-semibold text-text-primary">Notifications</h1>
          {unreadCount > 0 && (
            <span className="text-[11px] font-bold px-2 py-[2px] rounded-full bg-primary text-white">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadAppCount > 0 && (
          <button onClick={() => void markAllRead()} className="text-[13px] text-primary font-medium hover:underline">
            Mark all read
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">notifications_none</span>
            <p className="text-[14px]">No notifications</p>
            <p className="text-[12px] text-text-disabled">Leave, registration, and incident updates appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {items.map(n => (
              <div
                key={n.key}
                className={`flex gap-3 px-4 py-4 hover:bg-surface-elevated transition-colors ${
                  !n.is_read ? 'bg-primary/5' : ''
                } ${n.source === 'app' || n.source === 'leave' || n.source === 'incident' ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  if (n.source === 'app') {
                    if (n.type === 'registration_approved' || n.type === 'registration_rejected') {
                      if (!n.is_read) void markRead(n)
                      router.push(AUTH_ROUTES.companyPicker)
                      return
                    }
                    if (!n.is_read) void markRead(n)
                    return
                  }
                  if (n.source === 'leave') {
                    router.push('/dashboard/employee/leave')
                    return
                  }
                  if (n.source === 'incident') {
                    router.push(`/dashboard/employee/incidents/${n.id}`)
                  }
                }}
              >
                <div className="flex flex-col items-center pt-1.5 gap-1 shrink-0">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: n.is_read ? 'transparent' : n.color }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[14px] ${n.is_read ? 'text-text-secondary font-normal' : 'text-text-primary font-semibold'}`}>
                      {n.title}
                    </p>
                    <span className={`text-[10px] font-semibold px-1.5 py-[2px] rounded-full shrink-0 capitalize ${
                      n.source === 'app' ? 'bg-primary/10 text-primary'
                        : n.source === 'leave' ? 'bg-warning/10 text-warning'
                          : 'bg-surface-elevated text-text-secondary'
                    }`}>{n.source}</span>
                  </div>
                  {n.body && (
                    <p className="text-[13px] text-text-secondary mt-0.5 leading-relaxed">{n.body}</p>
                  )}
                  <p className="text-[11px] text-text-disabled mt-1">{timeAgo(n.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
