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
}

export function dequeue(idempotency_key: string): void {
  const q = getQueue().filter((p) => p.idempotency_key !== idempotency_key)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY)
}

/** Queue on offline OR transport/network-style RPC failures (MAUI OfflineQueueService). */
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
