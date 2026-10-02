/**
 * Same-day manual timesheet. The server inserts the punch pair.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ManualTimesheetInput = {
  companyId: string
  employeeId: string
  workDate: string
  timeIn: string
  timeOut: string
  notes?: string
  sessionToken?: string | null
}

export function manualTimesheetProblem(input: {
  workDate: string
  timeIn: string
  timeOut: string
  employeeId?: string
}): string | null {
  if (!input.employeeId) return 'Choose an employee.'
  if (!input.workDate) return 'Choose a date.'
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(input.timeIn) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(input.timeOut)) {
    return 'Enter time in and time out.'
  }
  if (input.timeOut <= input.timeIn) return 'Time out must be after time in on the same day.'
  return null
}

export async function submitManualTimesheet(
  supabase: SupabaseClient,
  input: ManualTimesheetInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const problem = manualTimesheetProblem(input)
  if (problem) return { ok: false, message: problem }

  const { error } = await supabase.rpc('employee_submit_timesheet', {
    p_company_id: input.companyId,
    p_employee_id: input.employeeId,
    p_work_date: input.workDate,
    p_time_in: input.timeIn,
    p_time_out: input.timeOut,
    p_notes: input.notes?.trim() || null,
    p_session_token: input.sessionToken ?? null,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
