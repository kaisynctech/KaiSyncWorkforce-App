/**
 * Shared Jobs API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildJobCreatePayload, type JobCreateInput } from '@/lib/job-create-payload'
import { logJobEvent } from '@/lib/job-events'
import { jobPhotoStoragePath } from '@/lib/job-media'

export type JobResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export async function allocateJobCode(
  supabase: SupabaseClient,
  companyId: string,
): Promise<JobResult<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('_next_job_code', {
      p_company_id: companyId,
    })
    if (error) return { ok: false, message: error.message }
    const code = typeof data === 'string' ? data : String(data ?? '')
    if (!code) return { ok: false, message: 'Could not allocate a job code.' }
    return { ok: true, data: code }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function createJob(
  supabase: SupabaseClient,
  input: JobCreateInput & { assignCode?: boolean },
): Promise<JobResult<{ id: string; job_code: string | null }>> {
  try {
    let jobCode = input.jobCode?.trim() || null
    if (!jobCode && input.assignCode !== false) {
      const codeRes = await allocateJobCode(supabase, input.companyId)
      if (!codeRes.ok) return codeRes
      jobCode = codeRes.data
    }

    const payload = buildJobCreatePayload({ ...input, jobCode })
    const { data, error } = await supabase
      .from('jobs')
      .insert(payload)
      .select('id, job_code')
      .single()

    if (error) return { ok: false, message: error.message }
    const id = (data as { id: string; job_code: string | null }).id

    // Persist uuid[] via SECURITY DEFINER RPC (PostgREST array quirks)
    const assignee = (payload.assignee_employee_id as string | null) ?? null
    const assigned = (payload.assigned_employee_ids as string[]) ?? []
    if (assignee || assigned.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('hr_set_job_assignments', {
        p_job_id: id,
        p_company_id: input.companyId,
        p_assignee_employee_id: assignee,
        p_assigned_employee_ids: assigned,
      })
    }

    await logJobEvent(supabase, {
      companyId: input.companyId,
      screen: 'HrJobs',
      action: 'job_created',
      meta: { job_id: id, title: input.title.trim(), job_code: jobCode },
    })

    return {
      ok: true,
      data: { id, job_code: (data as { job_code: string | null }).job_code ?? jobCode },
    }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function setJobAssignments(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    jobId: string
    assigneeEmployeeId?: string | null
    assignedEmployeeIds: string[]
  },
): Promise<JobResult<void>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('hr_set_job_assignments', {
      p_job_id: opts.jobId,
      p_company_id: opts.companyId,
      p_assignee_employee_id: opts.assigneeEmployeeId ?? null,
      p_assigned_employee_ids: opts.assignedEmployeeIds,
    })
    if (error) return { ok: false, message: error.message }
    await logJobEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrJobDetails',
      action: 'job_team_updated',
      meta: {
        job_id: opts.jobId,
        assignee_employee_id: opts.assigneeEmployeeId ?? null,
        team_count: opts.assignedEmployeeIds.length,
      },
    })
    return { ok: true, data: undefined }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function appendJobPhoto(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    jobId: string
    phase: 'before' | 'after'
    file: File
  },
): Promise<JobResult<string>> {
  try {
    const ext = opts.file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = jobPhotoStoragePath(opts.companyId, opts.jobId, opts.phase, ext)
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, opts.file, { upsert: true, contentType: opts.file.type || undefined })
    if (upErr) return { ok: false, message: upErr.message }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('append_job_photo', {
      p_company_id: opts.companyId,
      p_job_id: opts.jobId,
      p_phase: opts.phase,
      p_photo_url: path,
    })
    if (error) return { ok: false, message: error.message }

    await logJobEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrJobDetails',
      action: 'job_photo_added',
      meta: { job_id: opts.jobId, phase: opts.phase },
    })
    return { ok: true, data: path }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function openJobTeamThread(
  supabase: SupabaseClient,
  opts: { companyId: string; jobId: string },
): Promise<JobResult<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('ensure_job_team_message_thread', {
      p_company_id: opts.companyId,
      p_job_id: opts.jobId,
    })
    if (error) return { ok: false, message: error.message }
    const threadId = typeof data === 'string' ? data : (data as { id?: string } | null)?.id ?? String(data ?? '')
    if (!threadId) return { ok: false, message: 'Could not open job chat thread.' }
    return { ok: true, data: threadId }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
