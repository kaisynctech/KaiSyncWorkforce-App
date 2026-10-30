/**
 * Linked companies, stage 3: a customer creates a job for its provider from its own app, and
 * may cancel it while the provider has not assigned anyone. See
 * supabase/migrations/20261031110000_linked_jobs.sql — the database checks the link and person.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LinkedSite = { id: string; name: string; address: string | null }
export type LinkedJobActions = { created_by_us: boolean; created_by_label: string | null; can_cancel: boolean }
export type NewLinkedJob = {
  title: string
  description?: string
  priority: 'low' | 'medium' | 'high'
  /** Local date-time from the form (yyyy-mm-ddThh:mm), or empty. */
  preferredStart?: string
  siteId?: string
  address?: string
}

type R<T> = { ok: true; data: T } | { ok: false; message: string }

const MESSAGES: [RegExp, string][] = [
  [/TITLE_REQUIRED/, 'Give the job a title.'],
  [/TOO_LONG/, 'Some of the text is too long.'],
  [/BAD_PRIORITY/, 'Choose a priority.'],
  [/SITE_NOT_FOUND/, 'That site was not found.'],
  [/JOB_ALREADY_ASSIGNED/, 'The job already has someone assigned, so it can no longer be cancelled here. Send a message instead.'],
  [/JOB_ALREADY_CLOSED/, 'This job is already closed or cancelled.'],
  [/JOB_NOT_YOURS|JOB_NOT_FOUND/, 'You can only cancel jobs your company created.'],
  [/LINK_NOT_FOUND/, 'This company is no longer linked to you.'],
  [/NOT_ALLOWED/, 'You do not have access to linked companies.'],
]

export function linkedJobError(raw: string | null | undefined): string {
  const text = raw ?? ''
  for (const [re, msg] of MESSAGES) if (re.test(text)) return msg
  return text || 'Something went wrong. Try again.'
}

/** The form's local date-time as an ISO time, or null. */
export function preferredStartIso(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function call<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<R<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args)
  if (error) return { ok: false, message: linkedJobError(error.message) }
  return { ok: true, data: data as T }
}

export async function linkedJobSites(supabase: SupabaseClient, companyId: string, linkId: string): Promise<R<LinkedSite[]>> {
  const res = await call<{ sites: LinkedSite[] }>(supabase, 'linked_job_options', { p_company_id: companyId, p_link_id: linkId })
  return res.ok ? { ok: true, data: res.data?.sites ?? [] } : res
}

export function createLinkedJob(supabase: SupabaseClient, companyId: string, linkId: string, job: NewLinkedJob) {
  return call<{ id: string; job_code: string | null }>(supabase, 'linked_create_job', {
    p_company_id: companyId,
    p_link_id: linkId,
    p_title: job.title.trim(),
    p_description: job.description?.trim() || null,
    p_priority: job.priority,
    p_scheduled_start: preferredStartIso(job.preferredStart),
    p_site_id: job.siteId || null,
    p_address: job.siteId ? null : job.address?.trim() || null,
  })
}

export function linkedJobActions(supabase: SupabaseClient, companyId: string, linkId: string, jobId: string) {
  return call<LinkedJobActions>(supabase, 'linked_job_actions', { p_company_id: companyId, p_link_id: linkId, p_job_id: jobId })
}

export function cancelLinkedJob(supabase: SupabaseClient, companyId: string, linkId: string, jobId: string) {
  return call<null>(supabase, 'linked_cancel_job', { p_company_id: companyId, p_link_id: linkId, p_job_id: jobId })
}
