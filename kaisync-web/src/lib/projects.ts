/**
 * Shared Projects API for the HR web app (client_deals).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildProjectCreatePayload,
  nextProjectCode,
  type ProjectCreateInput,
} from '@/lib/project-create-payload'
import { logProjectEvent } from '@/lib/project-events'

export type ProjectResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type CreateProjectOptions = ProjectCreateInput & {
  existingCodes?: (string | null | undefined)[]
  companyCode?: string | null
  /** When true, allocate a permanent P{company}#### code if none provided. */
  assignCode?: boolean
}

async function resolveProjectCode(
  supabase: SupabaseClient,
  companyId: string,
  opts?: {
    existingCodes?: (string | null | undefined)[]
    companyCode?: string | null
    explicit?: string | null
  },
): Promise<string | null> {
  if (opts?.explicit?.trim()) return opts.explicit.trim().toUpperCase()

  let codes = opts?.existingCodes
  let companyCode = opts?.companyCode ?? ''

  if (!codes) {
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', companyId).maybeSingle(),
      supabase.from('client_deals').select('project_code').eq('company_id', companyId),
    ])
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
    codes = (existing ?? []).map(r => (r as { project_code: string | null }).project_code)
  } else if (opts?.companyCode == null) {
    const { data: company } = await supabase
      .from('companies')
      .select('code')
      .eq('id', companyId)
      .maybeSingle()
    companyCode = (company as { code?: string | null } | null)?.code ?? ''
  }

  const code = nextProjectCode(companyCode, codes)
  if (opts?.existingCodes) opts.existingCodes.push(code)
  return code
}

export async function allocateProjectCode(
  supabase: SupabaseClient,
  companyId: string,
): Promise<ProjectResult<string>> {
  try {
    const code = await resolveProjectCode(supabase, companyId)
    if (!code) return { ok: false, message: 'Could not allocate a project code.' }
    return { ok: true, data: code }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function createProject(
  supabase: SupabaseClient,
  input: CreateProjectOptions,
): Promise<ProjectResult<{ id: string }>> {
  try {
    const projectCode =
      input.projectCode?.trim()
        ? input.projectCode.trim().toUpperCase()
        : input.assignCode
          ? await resolveProjectCode(supabase, input.companyId, {
              existingCodes: input.existingCodes,
              companyCode: input.companyCode,
            })
          : null

    const payload = buildProjectCreatePayload({
      ...input,
      projectCode,
    })

    const { data, error } = await supabase
      .from('client_deals')
      .insert(payload)
      .select('id')
      .single()

    if (error) return { ok: false, message: error.message }
    const id = (data as { id: string }).id
    await logProjectEvent(supabase, {
      companyId: input.companyId,
      screen: 'HrProjectDetails',
      action: 'project_created',
      meta: { project_id: id, title: input.title.trim(), project_code: projectCode },
    })
    return { ok: true, data: { id } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function updateProject(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    projectId: string
    payload: Record<string, unknown>
    previousStatus?: string | null
  },
): Promise<ProjectResult<void>> {
  const { error } = await supabase
    .from('client_deals')
    .update(opts.payload)
    .eq('id', opts.projectId)
    .eq('company_id', opts.companyId)
  if (error) return { ok: false, message: error.message }

  const nextStatus = typeof opts.payload.status === 'string' ? opts.payload.status : null
  if (nextStatus && opts.previousStatus && nextStatus !== opts.previousStatus) {
    await logProjectEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrProjectDetails',
      action: 'stage_changed',
      meta: {
        project_id: opts.projectId,
        status_from: opts.previousStatus,
        status_to: nextStatus,
      },
    })
    await supabase.from('client_deal_updates').insert({
      company_id: opts.companyId,
      deal_id: opts.projectId,
      body: `Status changed from ${opts.previousStatus} to ${nextStatus}`,
      status_from: opts.previousStatus,
      status_to: nextStatus,
    })
  } else {
    await logProjectEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrProjectDetails',
      action: 'project_updated',
      meta: { project_id: opts.projectId },
    })
  }

  return { ok: true, data: undefined }
}

export async function sendProjectQuotation(
  supabase: SupabaseClient,
  opts: { companyId: string; projectId: string; previousStatus?: string | null },
): Promise<ProjectResult<void>> {
  const { error } = await supabase
    .from('client_deals')
    .update({
      status: 'sent',
      quotation_sent_at: new Date().toISOString(),
      last_update_at: new Date().toISOString(),
      last_update_summary: 'Quotation sent',
    })
    .eq('id', opts.projectId)
    .eq('company_id', opts.companyId)
  if (error) return { ok: false, message: error.message }

  await logProjectEvent(supabase, {
    companyId: opts.companyId,
    screen: 'HrProjectDetails',
    action: 'quotation_sent',
    meta: { project_id: opts.projectId },
  })
  await supabase.from('client_deal_updates').insert({
    company_id: opts.companyId,
    deal_id: opts.projectId,
    body: 'Quotation sent to client',
    status_from: opts.previousStatus ?? null,
    status_to: 'sent',
  })
  return { ok: true, data: undefined }
}
