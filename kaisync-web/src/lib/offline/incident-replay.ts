/**
 * Replay a queued incident (shared by list page and central flush).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { queuedPhotoToBlob, type QueuedIncident } from '@/lib/incident-queue'
import { uploadIncidentPhoto } from '@/lib/incident-media'

export async function submitQueuedIncident(
  supabase: SupabaseClient,
  item: QueuedIncident,
  sessionToken: string | null,
): Promise<void> {
  const photoUrls: string[] = []
  for (const photo of item.photos) {
    const blob = queuedPhotoToBlob(photo)
    const path = await uploadIncidentPhoto({
      supabase,
      companyId: item.company_id,
      employeeId: item.employee_id,
      file: blob,
      fileName: photo.name,
      sessionToken,
      softFail: true,
    })
    if (path) photoUrls.push(path)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('employee_insert_incident', {
    p_company_id: item.company_id,
    p_employee_id: item.employee_id,
    p_description: item.description,
    p_severity: item.severity,
    p_job_id: item.job_id,
    p_site_id: item.site_id,
    p_assignee_id: item.assignee_id,
    p_photo_urls: photoUrls.length > 0 ? photoUrls : null,
    p_reported_by_name: item.reported_by_name,
    p_title: item.title,
    p_category: item.category,
    p_occurred_at: item.occurred_at,
    p_latitude: item.latitude,
    p_longitude: item.longitude,
    p_location_text: item.location_text,
    p_session_token: sessionToken,
  })
  if (error) throw error
}
