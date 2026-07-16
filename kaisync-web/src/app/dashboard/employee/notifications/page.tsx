'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Notification {
  id: string
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  notification_type: string | null
}

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
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [empId, setEmpId] = useState<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setEmpId(member.employeeId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_my_notifications_for_employee', {
      p_employee_id: member.employeeId,
      p_company_id:  member.companyId,
    })
    setNotifications((data as Notification[]) ?? [])
    setLoading(false)
  }

  async function markRead(notifId: string) {
    if (!empId) return
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('employee_mark_notification_read_for_employee', {
      p_notification_id: notifId,
      p_employee_id:     empId,
    })
    setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, is_read: true } : n))
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.is_read)
    await Promise.all(unread.map(n => markRead(n.id)))
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

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
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-[13px] text-primary font-medium hover:underline">
            Mark all read
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">notifications_none</span>
            <p className="text-[14px]">No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {notifications.map(n => (
              <div
                key={n.id}
                className={`flex gap-3 px-4 py-4 cursor-pointer hover:bg-surface-elevated transition-colors ${
                  !n.is_read ? 'bg-primary/5' : ''
                }`}
                onClick={() => !n.is_read && markRead(n.id)}
              >
                <div className={`w-2 h-2 rounded-full mt-[6px] shrink-0 ${n.is_read ? 'bg-transparent' : 'bg-primary'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] ${n.is_read ? 'text-text-secondary font-normal' : 'text-text-primary font-semibold'}`}>
                    {n.title}
                  </p>
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
