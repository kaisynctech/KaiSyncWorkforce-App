/**
 * Central flush: punches, incidents, job actions, then refresh job pack.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { dequeue, getQueue } from '@/lib/punch-queue'
import { dequeueIncident, getIncidentQueue } from '@/lib/incident-queue'
import { submitQueuedIncident } from '@/lib/offline/incident-replay'
import {
  deleteBlob,
  dequeueJobAction,
  listJobActions,
  loadBlob,
  type JobQueuedAction,
} from '@/lib/offline/job-queue'
import { downloadJobPack } from '@/lib/offline/job-pack'
import { notifyOfflineChanged, setLastSyncedAt } from '@/lib/offline/meta'
import { uploadJobPhoto } from '@/lib/job-media'

export type FlushResult = {
  ok: boolean
  flushed: number
  remaining: number
  message: string | null
  packUpdated: boolean
}

async function flushPunches(
  supabase: SupabaseClient,
  sessionToken: string | null,
): Promise<{ flushed: number; error: string | null }> {
  const queue = getQueue()
  let flushed = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
  for (const punch of queue) {
    const { error } = await rpc('employee_insert_punch', {
      p_company_id: punch.company_id,
      p_employee_id: punch.employee_id,
      p_type: punch.type,
      p_date_time: punch.date_time,
      p_latitude: punch.latitude,
      p_longitude: punch.longitude,
      p_address: punch.address,
      p_job_id: punch.job_id,
      p_notes: punch.notes,
      p_punched_by_manager_id: null,
      p_idempotency_key: punch.idempotency_key,
      p_session_token: sessionToken,
    })
    if (error) return { flushed, error: error.message }
    dequeue(punch.idempotency_key)
    flushed += 1
  }
  return { flushed, error: null }
}

async function flushIncidents(
  supabase: SupabaseClient,
  sessionToken: string | null,
): Promise<{ flushed: number; error: string | null }> {
  const queue = getIncidentQueue()
  let flushed = 0
  for (const item of queue) {
    try {
      await submitQueuedIncident(supabase, item, sessionToken)
      dequeueIncident(item.local_id)
      flushed += 1
    } catch (e) {
      return { flushed, error: e instanceof Error ? e.message : 'Incident sync failed' }
    }
  }
  return { flushed, error: null }
}

async function replayJobAction(
  supabase: SupabaseClient,
  action: JobQueuedAction,
  sessionToken: string | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

  if (action.type === 'upsert_card') {
    const { error } = await rpc('employee_upsert_job_card', {
      p_company_id: action.company_id,
      p_employee_id: action.employee_id,
      p_job_id: action.job_id,
      p_start_time: action.payload.start_time,
      p_end_time: action.payload.end_time,
      p_work_performed: action.payload.work_performed,
      p_materials_used: action.payload.materials_used,
      p_photo_urls: action.payload.photo_urls,
      p_is_completed: action.payload.is_completed,
      p_client_signature_url: action.payload.client_signature_url,
      p_session_token: sessionToken,
    })
    if (error) throw error
    return
  }

  if (action.type === 'checklist_toggle') {
    const { error } = await rpc('employee_update_checklist_item', {
      p_company_id: action.company_id,
      p_employee_id: action.employee_id,
      p_item_id: action.item_id,
      p_is_checked: action.is_checked,
      p_session_token: sessionToken,
    })
    if (error) throw error
    return
  }

  if (action.type === 'job_photo') {
    const blob = await loadBlob(action.blob_key)
    if (!blob) throw new Error('Offline photo is missing on this device.')
    const file = new File([blob], action.file_name, { type: action.content_type })
    await uploadJobPhoto({
      supabase,
      companyId: action.company_id,
      employeeId: action.employee_id,
      jobId: action.job_id,
      phase: action.phase,
      file,
      sessionToken,
    })
    await deleteBlob(action.blob_key)
  }
}

async function flushJobActions(
  supabase: SupabaseClient,
  sessionToken: string | null,
): Promise<{ flushed: number; error: string | null }> {
  const actions = await listJobActions()
  let flushed = 0
  for (const action of actions) {
    try {
      await replayJobAction(supabase, action, sessionToken)
      await dequeueJobAction(action.id)
      flushed += 1
    } catch (e) {
      return { flushed, error: e instanceof Error ? e.message : 'Job sync failed' }
    }
  }
  return { flushed, error: null }
}

export async function flushEmployeeOffline(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    employeeId: string
    sessionToken: string | null
    refreshPack?: boolean
  },
): Promise<FlushResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      flushed: 0,
      remaining: getQueue().length + getIncidentQueue().length + (await listJobActions()).length,
      message: 'You are offline. Changes stay on this device until you reconnect.',
      packUpdated: false,
    }
  }

  let flushed = 0
  const punch = await flushPunches(supabase, opts.sessionToken)
  flushed += punch.flushed
  if (punch.error) {
    notifyOfflineChanged()
    return {
      ok: false,
      flushed,
      remaining: getQueue().length + getIncidentQueue().length + (await listJobActions()).length,
      message: punch.error,
      packUpdated: false,
    }
  }

  const incidents = await flushIncidents(supabase, opts.sessionToken)
  flushed += incidents.flushed
  if (incidents.error) {
    notifyOfflineChanged()
    return {
      ok: false,
      flushed,
      remaining: getQueue().length + getIncidentQueue().length + (await listJobActions()).length,
      message: incidents.error,
      packUpdated: false,
    }
  }

  const jobs = await flushJobActions(supabase, opts.sessionToken)
  flushed += jobs.flushed
  if (jobs.error) {
    notifyOfflineChanged()
    return {
      ok: false,
      flushed,
      remaining: getQueue().length + getIncidentQueue().length + (await listJobActions()).length,
      message: jobs.error,
      packUpdated: false,
    }
  }

  let packUpdated = false
  if (opts.refreshPack !== false) {
    try {
      await downloadJobPack(supabase, {
        companyId: opts.companyId,
        employeeId: opts.employeeId,
        sessionToken: opts.sessionToken,
      })
      packUpdated = true
    } catch (e) {
      await setLastSyncedAt()
      notifyOfflineChanged()
      return {
        ok: flushed > 0,
        flushed,
        remaining: 0,
        message: e instanceof Error
          ? `Synced work, but job pack refresh failed: ${e.message}`
          : 'Synced work, but job pack refresh failed.',
        packUpdated: false,
      }
    }
  } else {
    await setLastSyncedAt()
  }

  notifyOfflineChanged()
  return {
    ok: true,
    flushed,
    remaining: 0,
    message: null,
    packUpdated,
  }
}
