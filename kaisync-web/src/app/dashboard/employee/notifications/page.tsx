'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

// ── Types ──────────────────────────────────────────────────────────────────
interface AppNotification {
  id: number             // bigint
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  notification_type: string | null
}

interface LeaveRow {
  id: string
  leave_type: string
  status: string
  decided_at: string | null
  created_at: string
  start_date: string
  end_date: string
}

interface IncidentRow {
  id: string
  title: string | null
  description: string | null
  is_closed: boolean | null
  status: string | null
  created_at: string
}

type Source = 'app' | 'leave' | 'incident'

interface UnifiedItem {
  key: string
  id: number | string
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  notification_type: string | null
  color: string
  source: Source
}

// ── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function fmtLeaveType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function withinDays(iso: string | null, days: number): boolean {
  if (!iso) return false
  return (Date.now() - new Date(iso).getTime()) < days * 86400000
}

function leaveToItem(l: LeaveRow): UnifiedItem {
  let title = 'Leave Pending Review'
  let color = '#94A3B8'

  if (l.status === 'approved') { title = 'Leave Approved'; color = '#22C55E' }
  else if (l.status === 'rejected') { title = 'Leave Declined'; color = '#EF4444' }

  const body = `${fmtLeaveType(l.leave_type)} — ${l.start_date} to ${l.end_date}`

  let is_read = true
  if (l.status === 'approved' || l.status === 'rejected') {
    is_read = !withinDays(l.decided_at, 7)
  } else {
    is_read = !withinDays(l.created_at, 7)
  }

  return {
    key: `leave-${l.id}`, id: l.id, title, body, created_at: l.created_at,
    is_read, notification_type: 'leave', color, source: 'leave',
  }
}

function incidentToItem(i: IncidentRow): UnifiedItem {
  const isClosed = i.is_closed === true || i.status === 'closed'
  const title = isClosed ? 'Incident Closed' : 'Incident Reported'
  const color = isClosed ? '#22C55E' : '#94A3B8'
  const body  = i.title ?? i.description ?? 'Incident report'
  const is_read = !withinDays(i.created_at, 7)

  return {
    key: `inc-${i.id}`, id: i.id, title, body, created_at: i.created_at,
    is_read, notification_type: 'incident', color, source: 'incident',
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function EmployeeNotificationsPage() {
  const router = useRouter()
  const [items,   setItems]   = useState<UnifiedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [empId,   setEmpId]   = useState<string | null>(null)
  const [tok,     setTok]     = useState<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setEmpId(member.employeeId)

    const token = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    setTok(token)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)

    const [notifRes, leaveRes, incRes] = await Promise.all([
      rpc('employee_get_my_notifications_for_employee', {
        p_employee_id:   member.employeeId,
        p_session_token: token,
      }),
      rpc('employee_get_leave_requests', {
        p_company_id:    member.companyId,
        p_employee_id:   member.employeeId,
        p_session_token: token,
      }),
      rpc('employee_get_own_incidents', {
        p_company_id:    member.companyId,
        p_employee_id:   member.employeeId,
        p_session_token: token,
      }),
    ])

    const appItems: UnifiedItem[] = ((notifRes.data as AppNotification[]) ?? []).map(n => ({
      key:               `app-${n.id}`,
      id:                n.id,
      title:             n.title,
      body:              n.body,
      created_at:        n.created_at,
      is_read:           n.is_read,
      notification_type: n.notification_type,
      color:             '#6366F1',
      source:            'app' as Source,
    }))

    const leaveItems: UnifiedItem[] = ((leaveRes.data as LeaveRow[]) ?? []).map(leaveToItem)

    const allInc = ((incRes.data as IncidentRow[]) ?? [])
      .slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
    const incItems: UnifiedItem[] = allInc.map(incidentToItem)

    const merged = [...appItems, ...leaveItems, ...incItems]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    setItems(merged)
    setLoading(false)
  }

  async function markRead(item: UnifiedItem) {
    if (item.source !== 'app') return
    if (!empId) return

    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_mark_notification_read_for_employee', {
        p_employee_id:      empId,
        p_notification_id:  item.id as number,
        p_session_token:    tok,
      })
      setItems(prev => prev.map(n => n.key === item.key ? { ...n, is_read: true } : n))
    } catch { /* non-critical */ }
  }

  async function markAllRead() {
    const unread = items.filter(n => !n.is_read && n.source === 'app')
    await Promise.all(unread.map(n => markRead(n)))
  }

  const unreadCount = items.filter(n => !n.is_read).length

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
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">notifications_none</span>
            <p className="text-[14px]">No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-divider">
            {items.map(n => (
              <div
                key={n.key}
                className={`flex gap-3 px-4 py-4 hover:bg-surface-elevated transition-colors ${
                  !n.is_read ? 'bg-primary/5' : ''
                } ${n.source === 'app' ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  if (n.source === 'app') {
                    if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
                      // Registration status notification — mark as read and stay on notifications
                      if (!n.is_read) markRead(n)
                      return
                    }
                    if (!n.is_read) markRead(n)
                  }
                }}
              >
                {/* Colored dot */}
                <div className="flex flex-col items-center pt-1.5 gap-1 shrink-0">
                  <div className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: n.is_read ? 'transparent' : n.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[14px] ${n.is_read ? 'text-text-secondary font-normal' : 'text-text-primary font-semibold'}`}>
                      {n.title}
                    </p>
                    <span className={`text-[10px] font-semibold px-1.5 py-[2px] rounded-full shrink-0 capitalize ${
                      n.source === 'app'      ? 'bg-primary/10 text-primary' :
                      n.source === 'leave'    ? 'bg-warning/10 text-warning' :
                      'bg-surface-elevated text-text-secondary'
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
