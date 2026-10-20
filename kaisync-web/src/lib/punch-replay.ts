import type { SupabaseClient } from '@supabase/supabase-js'
import { needsPlaceName, reverseGeocodeRequired } from '@/lib/geo-location'
import { dequeue, isSessionAuthError, queuedPunchesFor, SESSION_ENDED_MESSAGE, type QueuedPunch } from '@/lib/punch-queue'

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

/**
 * Upload the signed-in worker's saved clock-ins, oldest first, using that worker's own sign-in.
 * Clock-ins saved on this phone by other workers are left in place: they cannot be sent with
 * this worker's sign-in (the server rejects them) and must not block this worker's clock-ins.
 * They upload when their own worker signs in on this phone.
 * Stops at the first failure so this worker's clock-ins stay in order.
 */
export async function flushQueuedPunchesFor(
  supabase: SupabaseClient,
  employeeId: string,
  sessionToken: string | null,
): Promise<{ flushed: number; error: string | null }> {
  let flushed = 0
  for (const punch of queuedPunchesFor(employeeId)) {
    const result = await insertQueuedPunch(supabase, punch, sessionToken)
    if (!result.ok) {
      return {
        flushed,
        error: isSessionAuthError(result.message) ? SESSION_ENDED_MESSAGE : result.message,
      }
    }
    dequeue(punch.idempotency_key)
    flushed += 1
  }
  return { flushed, error: null }
}
