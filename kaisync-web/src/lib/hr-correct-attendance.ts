/**
 * HR/owner/manager attendance correction.
 * Replaces a day's punches and can clear daily_absences (server-enforced + audited).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { manualTimesheetIsOvernight } from '@/lib/manual-timesheet'

export type HrCorrectAttendanceInput = {
  companyId: string
  employeeId: string
  workDate: string
  timeIn: string
  timeOut: string
  reason: string
  clearAbsence?: boolean
}

export function hrCorrectAttendanceProblem(input: {
  workDate: string
  timeIn: string
  timeOut: string
  employeeId?: string
  reason?: string
}): string | null {
  if (!input.employeeId) return 'Choose an employee.'
  if (!input.workDate) return 'Choose a date.'
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(input.timeIn) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(input.timeOut)) {
    return 'Enter time in and time out.'
  }
  const [ih, im] = input.timeIn.split(':').map(Number)
  const [oh, om] = input.timeOut.split(':').map(Number)
  if (ih * 60 + im === oh * 60 + om) return 'Time out must be different from time in.'
  if (!input.reason?.trim()) return 'Enter a reason for the correction.'
  return null
}

export async function submitHrCorrectAttendance(
  supabase: SupabaseClient,
  input: HrCorrectAttendanceInput,
): Promise<{ ok: true; overnight: boolean } | { ok: false; message: string }> {
  const problem = hrCorrectAttendanceProblem(input)
  if (problem) return { ok: false, message: problem }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('hr_correct_attendance', {
    p_company_id: input.companyId,
    p_employee_id: input.employeeId,
    p_work_date: input.workDate,
    p_time_in: input.timeIn,
    p_time_out: input.timeOut,
    p_reason: input.reason.trim(),
    p_clear_absence: input.clearAbsence !== false,
  })
  if (error) return { ok: false, message: error.message }
  return {
    ok: true,
    overnight: manualTimesheetIsOvernight(input.timeIn, input.timeOut),
  }
}
