/**
 * Offline sync metadata and pending-count helpers for the employee pack.
 */

import { getQueue } from '@/lib/punch-queue'
import { getIncidentQueue } from '@/lib/incident-queue'
import { idbGet, idbGetAll, idbSet } from '@/lib/offline/idb'
import type { JobQueuedAction } from '@/lib/offline/job-queue'

const LAST_SYNC_KEY = 'last_synced_at'
const EVENT = 'kaisync-offline-changed'

export type OfflinePendingCounts = {
  punches: number
  incidents: number
  jobActions: number
  total: number
}

export function notifyOfflineChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(EVENT))
}

export function onOfflineChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  window.addEventListener('online', handler)
  window.addEventListener('offline', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
    window.removeEventListener('online', handler)
    window.removeEventListener('offline', handler)
  }
}

export async function getLastSyncedAt(): Promise<string | null> {
  try {
    return (await idbGet<string>('meta', LAST_SYNC_KEY)) ?? null
  } catch {
    return null
  }
}

export async function setLastSyncedAt(iso = new Date().toISOString()): Promise<void> {
  try {
    await idbSet('meta', LAST_SYNC_KEY, iso)
    notifyOfflineChanged()
  } catch {
    /* ignore */
  }
}

export async function getOfflinePendingCounts(): Promise<OfflinePendingCounts> {
  let jobActions = 0
  try {
    const actions = await idbGetAll<JobQueuedAction>('job_actions')
    jobActions = actions.length
  } catch {
    jobActions = 0
  }
  const punches = getQueue().length
  const incidents = getIncidentQueue().length
  return {
    punches,
    incidents,
    jobActions,
    total: punches + incidents + jobActions,
  }
}

export function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  return d.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function networkLooksDown(errorMessage?: string | null): boolean {
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
