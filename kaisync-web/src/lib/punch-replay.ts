import type { SupabaseClient } from '@supabase/supabase-js'
import { needsPlaceName, reverseGeocodeRequired } from '@/lib/geo-location'
import type { QueuedPunch } from '@/lib/punch-queue'

type PunchJson = { id?: string; address?: string | null }

/**
 * Upload one punch that was saved on the phone. GPS is already on the queue.
 * The street name needs the internet, so it is written immediately after upload.
 */
export async function insertQueuedPunch(
  supabase: SupabaseClient,
  punch: QueuedPunch,
  sessionToken: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
  const { data, error } = await rpc('employee_insert_punch', {
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
  if (error) return { ok: false, message: error.message }

  const row = (data && typeof data === 'object' ? data : null) as PunchJson | null
  const punchId = row?.id ? String(row.id) : null
  const address = typeof row?.address === 'string' ? row.address : punch.address
  if (punchId && needsPlaceName(address, punch.latitude, punch.longitude)) {
    try {
      const named = await reverseGeocodeRequired(punch.latitude!, punch.longitude!, { maxAttempts: 3 })
      if (named) {
        await rpc('backfill_punch_address', {
          p_company_id: punch.company_id,
          p_punch_id: punchId,
          p_address: named,
          p_session_token: sessionToken,
        })
      }
    } catch (e) {
      console.error('[punch] place name backfill failed:', e)
    }
  }
  return { ok: true }
}
