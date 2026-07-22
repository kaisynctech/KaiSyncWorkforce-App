import { isIncidentOpen } from '@/lib/incident-types'

export type NotificationSource = 'app' | 'leave' | 'incident'

export type AppNotificationRow = {
  id: number
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  /** RPC column is `type` (not notification_type). */
  type?: string | null
  notification_type?: string | null
}

export type UnifiedNotificationItem = {
  key: string
  id: number | string
  title: string
  body: string | null
  created_at: string
  is_read: boolean
  /** App notification type, or synthetic leave/incident. */
  type: string | null
  color: string
  source: NotificationSource
}

export function parseNotificationsRpcJson(data: unknown): AppNotificationRow[] {
  let rows: unknown = data
  if (typeof data === 'string') {
    try { rows = JSON.parse(data) } catch { return [] }
  }
  if (!Array.isArray(rows)) return []
  return rows as AppNotificationRow[]
}

export function notificationTypeOf(n: AppNotificationRow): string | null {
  return n.type ?? n.notification_type ?? null
}

export function appNotificationColor(type: string | null): string {
  if (type === 'registration_approved') return '#22C55E'
  if (type === 'registration_rejected') return '#EF4444'
  if (type === 'client_portal_message') return '#8B5CF6'
  return '#6366F1'
}

export function withinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false
  return (Date.now() - new Date(iso).getTime()) < days * 86400000
}

function fmtLeaveType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** MAUI: approved/declined unread only when decided within 7 days. Pending is read. */
export function leaveToNotificationItem(l: {
  id: string
  leave_type: string
  status: string
  decided_at: string | null
  created_at: string
  start_date: string
  end_date: string
}): UnifiedNotificationItem {
  const status = (l.status ?? '').toLowerCase()
  const declined = status === 'declined' || status === 'rejected'
  let title = 'Leave Pending Review'
  let color = '#94A3B8'
  if (status === 'approved') { title = 'Leave Approved'; color = '#22C55E' }
  else if (declined) { title = 'Leave Declined'; color = '#EF4444' }

  let is_read = true
  if (status === 'approved' || declined) {
    is_read = !withinDays(l.decided_at, 7)
  }

  return {
    key: `leave-${l.id}`,
    id: l.id,
    title,
    body: `${fmtLeaveType(l.leave_type)} — ${l.start_date} to ${l.end_date}`,
    created_at: l.created_at,
    is_read,
    type: 'leave',
    color,
    source: 'leave',
  }
}

/** MAUI: open incidents unread; closed = read. */
export function incidentToNotificationItem(i: {
  id: string
  title: string | null
  description: string | null
  is_closed: boolean | null
  status: string | null
  created_at: string
}): UnifiedNotificationItem {
  const open = isIncidentOpen(i.status, i.is_closed)
  return {
    key: `inc-${i.id}`,
    id: i.id,
    title: open ? 'Incident Reported' : 'Incident Closed',
    body: i.title ?? i.description ?? 'Incident report',
    created_at: i.created_at,
    is_read: !open,
    type: 'incident',
    color: open ? '#94A3B8' : '#22C55E',
    source: 'incident',
  }
}

export function mapAppNotification(n: AppNotificationRow): UnifiedNotificationItem {
  const type = notificationTypeOf(n)
  return {
    key: `app-${n.id}`,
    id: n.id,
    title: n.title,
    body: n.body,
    created_at: n.created_at,
    is_read: n.is_read,
    type,
    color: appNotificationColor(type),
    source: 'app',
  }
}

/** MAUI dashboard badge: unread app_notifications only. */
export function countUnreadAppNotifications(items: UnifiedNotificationItem[]): number {
  return items.filter(i => i.source === 'app' && !i.is_read).length
}

export function sortNotificationsUnreadFirst(items: UnifiedNotificationItem[]): UnifiedNotificationItem[] {
  return [...items].sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}
