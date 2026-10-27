/**
 * Work reports on a job: many per job (each technician, each visit). Table job_reports.
 * Technicians (code login) use employee_list_job_reports / employee_save_job_report;
 * the office reads and writes the table directly (RLS: jobs.view / jobs.edit);
 * clients see the ones marked visible_to_client through client_portal_list_job_reports.
 * Older job cards (job_cards) are mirrored into one report each by a database trigger.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

export type JobReport = {
  id: string
  employee_id: string | null
  author: string | null
  report_date: string
  start_time: string | null
  end_time: string | null
  work_performed: string
  materials_used: string | null
  marks_job_complete: boolean
  visible_to_client?: boolean
  created_at?: string
  updated_at?: string
  /** Technician screen only: written by the signed-in technician (they may edit it). */
  mine?: boolean
}

export type ReportInput = {
  reportDate: string
  startTime: string | null
  endTime: string | null
  workPerformed: string
  materialsUsed: string
  marksJobComplete: boolean
}

function friendly(message: string): string {
  if (/WORK_PERFORMED_REQUIRED|work_performed/.test(message)) return 'Write what was done under Work performed.'
  if (/REPORT_NOT_YOURS/.test(message)) return 'You can only change your own reports.'
  if (/NOT_ASSIGNED_TO_JOB/.test(message)) return 'You are not assigned to this job.'
  if (/job_reports_check|end_time >= start_time/.test(message)) return 'The end time is before the start time.'
  if (/row-level security|permission denied/i.test(message)) return 'You do not have permission to do this.'
  return message
}

export function reportDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (!Number.isFinite(mins) || mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')
}

export function fmtReportDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtReportTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
}

export function todaySast(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
}

function check(input: ReportInput): string | null {
  if (!input.workPerformed.trim()) return 'Write what was done under Work performed.'
  if (input.startTime && input.endTime && new Date(input.endTime) < new Date(input.startTime)) return 'The end time is before the start time.'
  return null
}

// ── Office ────────────────────────────────────────────────────────────────────

const OFFICE_COLUMNS =
  'id, employee_id, report_date, start_time, end_time, work_performed, materials_used, marks_job_complete, visible_to_client, created_at, updated_at, employee:employee_id(name, surname)'

export async function listJobReports(supabase: SupabaseClient, companyId: string, jobId: string): Promise<Result<JobReport[]>> {
  const { data, error } = await supabase.from('job_reports').select(OFFICE_COLUMNS)
    .eq('company_id', companyId).eq('job_id', jobId)
    .order('report_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) return { ok: false, message: friendly(error.message) }
  type Row = Omit<JobReport, 'author'> & { employee: { name: string | null; surname: string | null } | null }
  return {
    ok: true,
    data: ((data ?? []) as unknown as Row[]).map(({ employee, ...r }) => ({
      ...r,
      author: employee ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim() || null : null,
    })),
  }
}

export async function saveOfficeReport(
  supabase: SupabaseClient, companyId: string, jobId: string, input: ReportInput & { employeeId: string | null }, id?: string,
): Promise<Result<void>> {
  const bad = check(input); if (bad) return { ok: false, message: bad }
  const row = {
    employee_id: input.employeeId || null,
    report_date: input.reportDate,
    start_time: input.startTime,
    end_time: input.endTime,
    work_performed: input.workPerformed,
    materials_used: input.materialsUsed || null,
    marks_job_complete: input.marksJobComplete,
  }
  const { error } = id
    ? await supabase.from('job_reports').update(row).eq('id', id).eq('company_id', companyId)
    : await supabase.from('job_reports').insert({ company_id: companyId, job_id: jobId, ...row })
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export async function setReportVisibleToClient(supabase: SupabaseClient, companyId: string, id: string, visible: boolean): Promise<Result<void>> {
  const { error } = await supabase.from('job_reports').update({ visible_to_client: visible }).eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export async function removeReport(supabase: SupabaseClient, companyId: string, id: string): Promise<Result<void>> {
  const { error } = await supabase.from('job_reports').delete().eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

// ── Technician (code login) ───────────────────────────────────────────────────

export async function workerListReports(
  supabase: SupabaseClient, companyId: string, employeeId: string, jobId: string, sessionToken: string | null,
): Promise<Result<JobReport[]>> {
  const { data, error } = await supabase.rpc('employee_list_job_reports', {
    p_company_id: companyId, p_employee_id: employeeId, p_job_id: jobId, p_session_token: sessionToken,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (Array.isArray(data) ? data : []) as JobReport[] }
}

export async function workerSaveReport(
  supabase: SupabaseClient, companyId: string, employeeId: string, jobId: string,
  input: ReportInput, sessionToken: string | null, reportId?: string,
): Promise<Result<void>> {
  const bad = check(input); if (bad) return { ok: false, message: bad }
  const { error } = await supabase.rpc('employee_save_job_report', {
    p_company_id: companyId, p_employee_id: employeeId, p_job_id: jobId, p_report_id: reportId ?? null,
    p_report_date: input.reportDate, p_start_time: input.startTime, p_end_time: input.endTime,
    p_work_performed: input.workPerformed, p_materials_used: input.materialsUsed || null,
    p_marks_job_complete: input.marksJobComplete, p_session_token: sessionToken,
  })
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}
