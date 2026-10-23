/**
 * Manual timesheet. The server inserts the punch pair.
 * A time out earlier than the time in is a night shift that ends the next morning (W5).
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
  if (clockMinutes(input.timeOut) === clockMinutes(input.timeIn)) return 'Time out must be different from time in.'
  return null
}

function clockMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** True when the shift ends the next day (time out earlier than time in). */
export function manualTimesheetIsOvernight(timeIn: string, timeOut: string): boolean {
  if (!/^\d{1,2}:\d{2}/.test(timeIn) || !/^\d{1,2}:\d{2}/.test(timeOut)) return false
  return clockMinutes(timeOut) < clockMinutes(timeIn)
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
