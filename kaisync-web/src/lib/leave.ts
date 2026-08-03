/**
 * Shared Leave API for the HR web app.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LeaveResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type LeaveDecision = 'approved' | 'declined'

export async function decideLeaveRequest(
  supabase: SupabaseClient,
  input: {
    companyId: string
    leaveRequestId: string
    decision: LeaveDecision
    note?: string | null
  }
): Promise<LeaveResult<void>> {
  const { error } = await supabase.rpc('decide_leave_request', {
    p_company_id: input.companyId,
    p_leave_request_id: input.leaveRequestId,
    p_decision: input.decision,
    p_note: input.note?.trim() || null,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

/** Friendly message for common decide_leave_request failures. */
export function formatLeaveDecideError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('insufficient') || m.includes('permission') || m.includes('not authorized')) {
    return 'You do not have permission to approve or decline leave requests.'
  }
  if (m.includes('not pending') || m.includes('already')) {
    return 'This leave request is no longer pending.'
  }
  return message
}
