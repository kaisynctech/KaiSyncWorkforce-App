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

export async function downloadJobPack(
  supabase: SupabaseClient,
  opts: { companyId: string; employeeId: string; sessionToken: string | null },
): Promise<JobPack> {
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

  const details: Record<string, PackedJobDetail> = {}
  for (const row of packList) {
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
      details[row.id] = {
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
      details[row.id] = { job: row, card: null, checklist: [] }
    }
  }

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
