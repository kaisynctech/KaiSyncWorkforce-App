/**
 * Mirrors KaiFlow.Timesheets.Models.LeavePolicy (BCEA defaults).
 */

export const LEAVE_TYPES = [
  { key: 'Annual Leave', label: 'Annual Leave', annualDays: 15, color: '#3B82F6', icon: 'beach_access' },
  { key: 'Sick Leave', label: 'Sick Leave', annualDays: 10, color: '#22C55E', icon: 'local_hospital' },
  { key: 'Family Responsibility', label: 'Family Responsibility', annualDays: 3, color: '#A855F7', icon: 'family_restroom' },
  { key: 'Maternity Leave', label: 'Maternity Leave', annualDays: 60, color: '#EC4899', icon: 'pregnant_woman' },
  { key: 'Paternity Leave', label: 'Paternity Leave', annualDays: 10, color: '#0EA5E9', icon: 'child_friendly' },
  { key: 'Study Leave', label: 'Study Leave', annualDays: 5, color: '#F59E0B', icon: 'school' },
  { key: 'Unpaid Leave', label: 'Unpaid Leave', annualDays: 365, color: '#64748B', icon: 'money_off' },
] as const

export const LEAVE_TYPE_KEYS = LEAVE_TYPES.map((t) => t.key)

export function getAnnualDays(leaveType: string): number {
  return LEAVE_TYPES.find((t) => t.key.toLowerCase() === leaveType.toLowerCase())?.annualDays ?? 0
}

export function getLeaveIcon(leaveType: string): string {
  return LEAVE_TYPES.find((t) => t.key.toLowerCase() === leaveType.toLowerCase())?.icon ?? 'event_busy'
}

export type LeaveRequestLike = {
  leave_type: string
  start_date: string
  total_days: number
  status: string
}

export type LeaveSummary = {
  leave_type: string
  annual_days: number
  days_approved: number
  days_pending: number
  days_remaining: number
}

export function computeLeaveSummary(requests: LeaveRequestLike[]): LeaveSummary[] {
  const thisYear = new Date().getFullYear()
  const yearly = requests.filter((r) => new Date(r.start_date).getFullYear() === thisYear)
  return LEAVE_TYPE_KEYS.map((leaveType) => {
    const forType = yearly.filter((r) => r.leave_type === leaveType)
    const approved = forType
      .filter((r) => r.status === 'approved')
      .reduce((s, r) => s + r.total_days, 0)
    const pending = forType
      .filter((r) => r.status === 'pending')
      .reduce((s, r) => s + r.total_days, 0)
    const annual = getAnnualDays(leaveType)
    return {
      leave_type: leaveType,
      annual_days: annual,
      days_approved: approved,
      days_pending: pending,
      days_remaining: Math.max(0, annual - approved),
    }
  }).filter((s) => s.days_approved > 0 || s.days_pending > 0 || s.annual_days > 0)
}

export function calcLeaveTotalDays(start: string, end: string): number {
  if (!start || !end) return 1
  return Math.max(
    1,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1,
  )
}

/** MAUI leave attachment accept list */
export const LEAVE_ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx'
