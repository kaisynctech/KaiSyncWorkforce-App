import { shouldQueuePunchFailure } from '@/lib/punch-queue'

const QUEUE_KEY = 'kf_incident_queue'

export type QueuedIncidentPhoto = {
  name: string
  type: string
  base64: string
}

export type QueuedIncident = {
  local_id: string
  company_id: string
  employee_id: string
  description: string
  severity: string
  category: string
  title: string | null
  job_id: string | null
  site_id: string | null
  assignee_id: string | null
  reported_by_name: string | null
  occurred_at: string
  latitude: number | null
  longitude: number | null
  location_text: string | null
  photos: QueuedIncidentPhoto[]
  queued_at: string
}

export function getIncidentQueue(): QueuedIncident[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedIncident[]
  } catch {
    return []
  }
}

export function enqueueIncident(item: QueuedIncident): void {
  const q = getIncidentQueue()
  if (q.some((p) => p.local_id === item.local_id)) return
  q.push(item)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function dequeueIncident(localId: string): void {
  const q = getIncidentQueue().filter((p) => p.local_id !== localId)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function pendingIncidentCount(): number {
  return getIncidentQueue().length
}

export function shouldQueueIncidentFailure(errorMessage: string | null | undefined): boolean {
  return shouldQueuePunchFailure(errorMessage)
}

export async function fileToQueuedPhoto(file: File): Promise<QueuedIncidentPhoto> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return {
    name: file.name,
    type: file.type || 'image/jpeg',
    base64: btoa(binary),
  }
}

export function queuedPhotoToBlob(photo: QueuedIncidentPhoto): Blob {
  const binary = atob(photo.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: photo.type || 'image/jpeg' })
}
