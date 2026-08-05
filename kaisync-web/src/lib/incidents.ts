/**
 * Shared Incidents API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logIncidentEvent } from '@/lib/incident-events'

export type IncidentResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export async function hrUpdateIncident(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    incidentId: string
    status?: string | null
    resolutionNotes?: string | null
    assigneeId?: string | null
    clearAssignee?: boolean
  },
): Promise<IncidentResult<Record<string, unknown>>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('hr_update_incident', {
      p_company_id: opts.companyId,
      p_incident_id: opts.incidentId,
      p_status: opts.status ?? null,
      p_resolution_notes: opts.resolutionNotes ?? null,
      p_assignee_id: opts.assigneeId ?? null,
      p_clear_assignee: opts.clearAssignee ?? false,
    })
    if (error) return { ok: false, message: error.message }

    await logIncidentEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrIncidentDetails',
      action: opts.status ? 'incident.status_changed' : 'incident.updated',
      meta: {
        incident_id: opts.incidentId,
        status: opts.status ?? undefined,
        assignee_id: opts.clearAssignee ? null : opts.assigneeId,
      },
    })

    return { ok: true, data: (data ?? {}) as Record<string, unknown> }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function hrAddIncidentComment(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    incidentId: string
    body: string
    authorEmployeeId: string
    authorName?: string | null
  },
): Promise<IncidentResult<{ id: string }>> {
  try {
    const { data, error } = await supabase
      .from('incident_comments')
      .insert({
        company_id: opts.companyId,
        incident_id: opts.incidentId,
        author_employee_id: opts.authorEmployeeId,
        author_name: opts.authorName ?? null,
        body: opts.body.trim(),
      })
      .select('id')
      .single()

    if (error) return { ok: false, message: error.message }

    await logIncidentEvent(supabase, {
      companyId: opts.companyId,
      screen: 'HrIncidentDetails',
      action: 'incident.comment_added',
      meta: { incident_id: opts.incidentId, comment_id: data.id },
    })

    return { ok: true, data: { id: data.id as string } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
