/**
 * Assigned-job pack stored on device for offline reading.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { idbGet, idbSet } from '@/lib/offline/idb'
import { notifyOfflineChanged, setLastSyncedAt } from '@/lib/offline/meta'
import { isAssignedTo } from '@/lib/job-ownership'

export type PackedJobListRow = {
  id: string
  title: string
  status: string | null
  priority: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  job_code: string | null
  description: string | null
  created_at: string
  assignee_employee_id: string | null
  assigned_employee_ids: string[] | null
  created_by_employee_id: string | null
  contractor_employee_id?: string | null
}

export type PackedChecklistItem = {
  id: string
  description: string | null
  is_checked: boolean
  sort_order?: number | null
}

export type PackedJobCard = {
  id?: string
  work_performed: string | null
  materials_used: string | null
  start_time: string | null
  end_time: string | null
  is_completed: boolean
  photo_urls: string[] | null
  client_signature_url?: string | null
}

export type PackedJobDetail = {
  job: PackedJobListRow & Record<string, unknown>
  card: PackedJobCard | null
  checklist: PackedChecklistItem[]
}

export type JobPack = {
  companyId: string
  employeeId: string
  syncedAt: string
  jobs: PackedJobListRow[]
  details: Record<string, PackedJobDetail>
}

function packKey(companyId: string, employeeId: string): string {
  return `${companyId}:${employeeId}`
}

export async function loadJobPack(companyId: string, employeeId: string): Promise<JobPack | null> {
  try {
    return (await idbGet<JobPack>('job_pack', packKey(companyId, employeeId))) ?? null
  } catch {
    return null
  }
}

export async function saveJobPack(pack: JobPack): Promise<void> {
  await idbSet('job_pack', packKey(pack.companyId, pack.employeeId), pack)
  await setLastSyncedAt(pack.syncedAt)
  notifyOfflineChanged()
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: T[] }).data
  }
  return []
}

function asObject<T extends object>(data: unknown): T | null {
  if (!data || typeof data !== 'object') return null
  if (Array.isArray(data)) return (data[0] as T) ?? null
  return data as T
}

/** A stored pack younger than this is reused instead of downloaded again. */
export const JOB_PACK_MAX_AGE_MS = 120_000
/** Jobs fetched at the same time while building a pack (each job is 3–4 RPCs). */
export const JOB_PACK_CONCURRENCY = 4

/** Map items with at most `limit` running at once. Results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export function isPackFresh(
  syncedAt: string | null | undefined,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  if (!syncedAt || maxAgeMs <= 0) return false
  const at = new Date(syncedAt).getTime()
  if (Number.isNaN(at)) return false
  const age = now - at
  return age >= 0 && age < maxAgeMs
}

type JobPackOpts = { companyId: string; employeeId: string; sessionToken: string | null }

/** One network download per company:employee at a time; concurrent callers share it. */
const inFlightDownloads = new Map<string, Promise<JobPack>>()

/**
 * Returns the assigned-job pack, downloading it unless the stored pack for this
 * company/employee is younger than `maxAgeMs` (default 2 min; pass 0 to force).
 */
export function downloadJobPack(
  supabase: SupabaseClient,
  opts: JobPackOpts & { maxAgeMs?: number },
): Promise<JobPack> {
  const key = packKey(opts.companyId, opts.employeeId)
  const running = inFlightDownloads.get(key)
  if (running) return running

  const start = (): Promise<JobPack> => {
    // A download may have started while the stored pack was being read.
    const started = inFlightDownloads.get(key)
    if (started) return started
    const download = fetchJobPack(supabase, opts).finally(() => {
      if (inFlightDownloads.get(key) === download) inFlightDownloads.delete(key)
    })
    inFlightDownloads.set(key, download)
    return download
  }

  const maxAgeMs = opts.maxAgeMs ?? JOB_PACK_MAX_AGE_MS
  if (maxAgeMs <= 0) return start()
  return loadJobPack(opts.companyId, opts.employeeId).then(stored =>
    stored && isPackFresh(stored.syncedAt, maxAgeMs) ? stored : start(),
  )
}

async function fetchJobPack(supabase: SupabaseClient, opts: JobPackOpts): Promise<JobPack> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

  const { data: listData, error: listErr } = await rpc('employee_get_jobs_for_employee', {
    p_employee_id: opts.employeeId,
    p_company_id: opts.companyId,
    p_session_token: opts.sessionToken,
  })
  if (listErr) throw listErr

  const allJobs = asArray<PackedJobListRow>(listData)
  const jobs = allJobs.filter(
    j => isAssignedTo(j, opts.employeeId) || j.created_by_employee_id === opts.employeeId,
  )
  const openJobs = jobs.filter(j => {
    const s = (j.status ?? '').toLowerCase()
    return s !== 'completed' && s !== 'cancelled' && s !== 'closed'
  })
  // Keep recently completed too (last 20 assigned) so reports still open offline.
  const packList = [
    ...openJobs,
    ...jobs.filter(j => !openJobs.some(o => o.id === j.id)).slice(0, 20),
  ].slice(0, 40)

  const packed = await mapWithConcurrency(packList, JOB_PACK_CONCURRENCY, async (row): Promise<PackedJobDetail> => {
    try {
      const [jobRes, cardEmpRes, checkRes] = await Promise.all([
        rpc('employee_get_job_for_employee', {
          p_company_id: opts.companyId,
          p_employee_id: opts.employeeId,
          p_job_id: row.id,
          p_session_token: opts.sessionToken,
        }),
        rpc('employee_get_job_card_for_employee', {
          p_company_id: opts.companyId,
          p_employee_id: opts.employeeId,
          p_job_id: row.id,
          p_session_token: opts.sessionToken,
        }),
        rpc('employee_get_checklist_for_job', {
          p_company_id: opts.companyId,
          p_job_id: row.id,
          p_employee_id: opts.employeeId,
          p_session_token: opts.sessionToken,
        }),
      ])

      let card = asObject<PackedJobCard>(cardEmpRes.data)
      if (!card) {
        const cardJobRes = await rpc('employee_get_job_card_for_job', {
          p_company_id: opts.companyId,
          p_job_id: row.id,
          p_session_token: opts.sessionToken,
        })
        card = asObject<PackedJobCard>(cardJobRes.data)
      }

      const job = asObject<PackedJobListRow & Record<string, unknown>>(jobRes.data) ?? {
        ...row,
      }
      return {
        job,
        card: card
          ? {
              ...card,
              work_performed: card.work_performed ?? null,
              materials_used: card.materials_used ?? null,
              start_time: card.start_time ?? null,
              end_time: card.end_time ?? null,
              is_completed: Boolean(card.is_completed),
              photo_urls: card.photo_urls ?? null,
            }
          : null,
        checklist: asArray<PackedChecklistItem>(checkRes.data).map(item => ({
          id: item.id,
          description: item.description ?? null,
          is_checked: Boolean(item.is_checked),
          sort_order: item.sort_order ?? null,
        })),
      }
    } catch {
      return { job: row, card: null, checklist: [] }
    }
  })

  const details: Record<string, PackedJobDetail> = {}
  packList.forEach((row, i) => { details[row.id] = packed[i] })

  const pack: JobPack = {
    companyId: opts.companyId,
    employeeId: opts.employeeId,
    syncedAt: new Date().toISOString(),
    jobs: packList,
    details,
  }
  await saveJobPack(pack)
  return pack
}

export async function getPackedJobDetail(
  companyId: string,
  employeeId: string,
  jobId: string,
): Promise<PackedJobDetail | null> {
  const pack = await loadJobPack(companyId, employeeId)
  return pack?.details[jobId] ?? null
}

export function applyLocalCardToPackDetail(
  detail: PackedJobDetail,
  patch: Partial<PackedJobCard>,
): PackedJobDetail {
  const base: PackedJobCard = detail.card ?? {
    work_performed: null,
    materials_used: null,
    start_time: null,
    end_time: null,
    is_completed: false,
    photo_urls: null,
  }
  return { ...detail, card: { ...base, ...patch } }
}
