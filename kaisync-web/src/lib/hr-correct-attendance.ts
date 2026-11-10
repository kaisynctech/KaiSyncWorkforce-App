/**
 * HR/owner/manager attendance correction.
 * Supports full day (in+out), in-only (employee clocks out later), and out-only (forgot clock out).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { manualTimesheetIsOvernight } from '@/lib/manual-timesheet'

export type HrCorrectMode = 'full_day' | 'in_only' | 'out_only'

export type HrCorrectAttendanceInput = {
  companyId: string
  employeeId: string
  workDate: string
  mode: HrCorrectMode
  timeIn: string
  timeOut: string
  reason: string
  clearAbsence?: boolean
}

export function hrCorrectAttendanceProblem(input: {
  workDate: string
  mode: HrCorrectMode
  timeIn: string
  timeOut: string
  employeeId?: string
  reason?: string
}): string | null {
  if (!input.employeeId) return 'Choose an employee.'
  if (!input.workDate) return 'Choose a date.'
  if (!input.reason?.trim()) return 'Enter a reason for the correction.'

  const inOk = /^\d{1,2}:\d{2}(:\d{2})?$/.test(input.timeIn)
  const outOk = /^\d{1,2}:\d{2}(:\d{2})?$/.test(input.timeOut)

  if (input.mode === 'full_day') {
    if (!inOk || !outOk) return 'Enter time in and time out.'
    const [ih, im] = input.timeIn.split(':').map(Number)
    const [oh, om] = input.timeOut.split(':').map(Number)
    if (ih * 60 + im === oh * 60 + om) return 'Time out must be different from time in.'
    return null
  }
  if (input.mode === 'in_only') {
    if (!inOk) return 'Enter the clock-in time.'
    return null
  }
  if (!outOk) return 'Enter the clock-out time.'
  return null
}

export async function submitHrCorrectAttendance(
  supabase: SupabaseClient,
  input: HrCorrectAttendanceInput,
): Promise<
  | { ok: true; overnight: boolean; mode: HrCorrectMode }
  | { ok: false; message: string }
> {
  const problem = hrCorrectAttendanceProblem(input)
  if (problem) return { ok: false, message: problem }

  const timeIn = input.mode === 'out_only' ? '' : input.timeIn
  const timeOut = input.mode === 'in_only' ? '' : input.timeOut

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('hr_correct_attendance', {
    p_company_id: input.companyId,
    p_employee_id: input.employeeId,
    p_work_date: input.workDate,
    p_time_in: timeIn || null,
    p_time_out: timeOut || null,
    p_reason: input.reason.trim(),
    p_clear_absence: input.clearAbsence !== false,
  })
  if (error) return { ok: false, message: error.message }
  return {
    ok: true,
    mode: input.mode,
    overnight:
      input.mode === 'full_day'
        && Boolean(timeIn)
        && Boolean(timeOut)
        && manualTimesheetIsOvernight(timeIn, timeOut),
  }
}
