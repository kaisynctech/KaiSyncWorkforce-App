import type { SupabaseClient } from '@supabase/supabase-js'
import {
  needsPlaceName,
  resolveMissingPunchAddresses,
} from '@/lib/geo-location'
import type { PunchSessionRow } from '@/lib/punch-session'

/**
 * Resolve missing place names for attendance sessions and persist via RPC.
 * Returns an updated session list (same order) with addresses filled in.
 */
export async function enrichSessionsWithPlaceNames(
  supabase: SupabaseClient,
  companyId: string,
  sessions: PunchSessionRow[],
  sessionToken: string | null = null,
): Promise<PunchSessionRow[]> {
  const punches: Array<{
    id: string
    address: string | null
    latitude: number | null
    longitude: number | null
  }> = []

  for (const s of sessions) {
    if (s.clockInPunchId && needsPlaceName(s.clockInAddress, s.clockInLat, s.clockInLng)) {
      punches.push({
        id: s.clockInPunchId,
        address: s.clockInAddress,
        latitude: s.clockInLat,
        longitude: s.clockInLng,
      })
    }
    if (s.clockOutPunchId && needsPlaceName(s.clockOutAddress, s.clockOutLat, s.clockOutLng)) {
      punches.push({
        id: s.clockOutPunchId,
        address: s.clockOutAddress,
        latitude: s.clockOutLat,
        longitude: s.clockOutLng,
      })
    }
  }

  if (punches.length === 0) return sessions

  const named = await resolveMissingPunchAddresses(punches, {
    limit: 40,
    persist: async (punchId, address) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('backfill_punch_address', {
        p_company_id: companyId,
        p_punch_id: punchId,
        p_address: address,
        p_session_token: sessionToken,
      })
    },
  })

  if (named.size === 0) return sessions

  return sessions.map(s => {
    const inName = s.clockInPunchId ? named.get(s.clockInPunchId) : undefined
    const outName = s.clockOutPunchId ? named.get(s.clockOutPunchId) : undefined
    if (!inName && !outName) return s
    return {
      ...s,
      clockInAddress: inName ?? s.clockInAddress,
      clockOutAddress: outName ?? s.clockOutAddress,
    }
  })
}
