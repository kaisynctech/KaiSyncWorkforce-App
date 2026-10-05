/**
 * Queued job-report actions for offline replay.
 */

import { idbDelete, idbGet, idbGetAll, idbPut, idbSet } from '@/lib/offline/idb'
import { notifyOfflineChanged } from '@/lib/offline/meta'

export type JobCardPayload = {
  work_performed: string | null
  materials_used: string | null
  start_time: string | null
  end_time: string | null
  is_completed: boolean
  photo_urls: string[]
  client_signature_url: string | null
}

export type JobQueuedAction =
  | {
      id: string
      type: 'upsert_card'
      company_id: string
      employee_id: string
      job_id: string
      payload: JobCardPayload
      queued_at: string
    }
  | {
      id: string
      type: 'checklist_toggle'
      company_id: string
      employee_id: string
      job_id: string
      item_id: string
      is_checked: boolean
      queued_at: string
    }
  | {
      id: string
      type: 'job_photo'
      company_id: string
      employee_id: string
      job_id: string
      phase: 'before' | 'after'
      blob_key: string
      file_name: string
      content_type: string
      queued_at: string
    }

export async function listJobActions(): Promise<JobQueuedAction[]> {
  try {
    const rows = await idbGetAll<JobQueuedAction>('job_actions')
    return rows.sort((a, b) => a.queued_at.localeCompare(b.queued_at))
  } catch {
    return []
  }
}

export async function pendingJobActionCount(): Promise<number> {
  return (await listJobActions()).length
}

export async function enqueueJobAction(action: JobQueuedAction): Promise<void> {
  await idbPut('job_actions', action)
  notifyOfflineChanged()
}

export async function dequeueJobAction(id: string): Promise<void> {
  await idbDelete('job_actions', id)
  notifyOfflineChanged()
}

export async function storeBlob(key: string, blob: Blob): Promise<void> {
  await idbSet('blobs', key, blob)
}

export async function loadBlob(key: string): Promise<Blob | undefined> {
  return idbGet<Blob>('blobs', key)
}

export async function deleteBlob(key: string): Promise<void> {
  await idbDelete('blobs', key)
}

export async function enqueueJobCard(opts: {
  companyId: string
  employeeId: string
  jobId: string
  payload: JobCardPayload
}): Promise<string> {
  const id = crypto.randomUUID()
  await enqueueJobAction({
    id,
    type: 'upsert_card',
    company_id: opts.companyId,
    employee_id: opts.employeeId,
    job_id: opts.jobId,
    payload: opts.payload,
    queued_at: new Date().toISOString(),
  })
  return id
}

export async function enqueueChecklistToggle(opts: {
  companyId: string
  employeeId: string
  jobId: string
  itemId: string
  isChecked: boolean
}): Promise<string> {
  const id = crypto.randomUUID()
  await enqueueJobAction({
    id,
    type: 'checklist_toggle',
    company_id: opts.companyId,
    employee_id: opts.employeeId,
    job_id: opts.jobId,
    item_id: opts.itemId,
    is_checked: opts.isChecked,
    queued_at: new Date().toISOString(),
  })
  return id
}

export async function enqueueJobPhoto(opts: {
  companyId: string
  employeeId: string
  jobId: string
  phase: 'before' | 'after'
  file: File
}): Promise<string> {
  const id = crypto.randomUUID()
  const blobKey = `job_photo_${id}`
  await storeBlob(blobKey, opts.file)
  await enqueueJobAction({
    id,
    type: 'job_photo',
    company_id: opts.companyId,
    employee_id: opts.employeeId,
    job_id: opts.jobId,
    phase: opts.phase,
    blob_key: blobKey,
    file_name: opts.file.name,
    content_type: opts.file.type || 'image/jpeg',
    queued_at: new Date().toISOString(),
  })
  return id
}
