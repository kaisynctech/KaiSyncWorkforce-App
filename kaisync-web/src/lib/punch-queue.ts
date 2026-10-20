import { notifyOfflineChanged } from '@/lib/offline/meta'

const QUEUE_KEY = 'kf_punch_queue'

export interface QueuedPunch {
  idempotency_key: string
  company_id: string
  employee_id: string
  type: 'in' | 'out'
  date_time: string
  latitude: number | null
  longitude: number | null
  address: string | null
  job_id: string | null
  notes: string | null
  queued_at: string
}

export function getQueue(): QueuedPunch[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedPunch[]
  } catch {
    return []
  }
}

export function enqueue(punch: QueuedPunch): void {
  const q = getQueue()
  if (q.some((p) => p.idempotency_key === punch.idempotency_key)) return
  q.push(punch)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  notifyOfflineChanged()
}

export function dequeue(idempotency_key: string): void {
  const q = getQueue().filter((p) => p.idempotency_key !== idempotency_key)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  notifyOfflineChanged()
}

export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY)
  notifyOfflineChanged()
}

/**
 * Clock-ins saved on this phone for one worker, in the order they were made.
 * The queue is shared by everyone who signs in on the phone, so a worker's
 * sign-in may only upload that worker's own clock-ins.
 */
export function queuedPunchesFor(employeeId: string): QueuedPunch[] {
  return getQueue().filter((p) => p.employee_id === employeeId)
}

/** Count of clock-ins saved on this phone for workers other than this one. */
export function otherWorkersQueuedCount(employeeId: string): number {
  return getQueue().filter((p) => p.employee_id !== employeeId).length
}

/** True when the server rejected the call because the worker's sign-in is no longer valid. */
export function isSessionAuthError(errorMessage: string | null | undefined): boolean {
  const msg = (errorMessage ?? '').toLowerCase()
  return (
    msg.includes('unauthorized')
    || msg.includes('session expired')
    || msg.includes('expired or invalid')
    || msg.includes('invalid_or_expired_session')
    || msg.includes('session_token_required')
  )
}

/** Message shown when a clock-in is rejected because the sign-in ended. */
export const SESSION_ENDED_MESSAGE =
  'Your sign-in on this phone has ended (you may have signed in on another phone). Sign out and sign in again, then clock in.'

/** Queue on offline OR transport/network-style RPC failures . */
export function shouldQueuePunchFailure(errorMessage: string | null | undefined): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = (errorMessage ?? '').toLowerCase()
  return (
    msg.includes('network')
    || msg.includes('fetch')
    || msg.includes('failed to fetch')
    || msg.includes('timeout')
    || msg.includes('offline')
  )
}
