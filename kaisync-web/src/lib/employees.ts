/**
 * Shared Employees API for the HR web app.
 * Pages should prefer these helpers over ad-hoc PostgREST calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildEmployeeCreatePayload,
  type EmployeeCreateInput,
} from '@/lib/employee-create-payload'
import { deleteEmployee, setEmployeeActive } from '@/lib/employee-lifecycle'
import { buildOrgWriteFields } from '@/lib/employee-org'
import { loadScopedEmployeeIds } from '@/lib/employee-scope'
import {
  MANAGER_ACCESS_LEVELS,
  normalizeAccessLevel,
  normalizeEmploymentType,
  normalizeWorkerType,
} from '@/lib/employee-taxonomy'
import type { Branch, Employee, ShiftTemplate } from '@/types/database'

export type EmployeeResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export async function listEmployees(
  supabase: SupabaseClient,
  companyId: string,
  opts?: { activeOnly?: boolean }
): Promise<EmployeeResult<Employee[]>> {
  let q = supabase
    .from('employees')
    .select('*')
    .eq('company_id', companyId)
    .order('name')
  if (opts?.activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data ?? []) as Employee[] }
}

/**
 * Company employees filtered by viewer role (owner/HR = all; manager = line + teams).
 * Pass viewerEmployeeId from resolveCurrentMember.
 */
export async function listEmployeesScoped(
  supabase: SupabaseClient,
  companyId: string,
  viewerEmployeeId: string,
  opts?: { activeOnly?: boolean }
): Promise<EmployeeResult<Employee[]>> {
  const [listRes, scopeRes] = await Promise.all([
    listEmployees(supabase, companyId, opts),
    loadScopedEmployeeIds(supabase, companyId, viewerEmployeeId),
  ])
  if (!listRes.ok) return listRes
  if (!scopeRes.ok) return { ok: false, message: scopeRes.message }
  if (scopeRes.seesAll) return listRes

  return {
    ok: true,
    data: listRes.data.filter(e => scopeRes.ids.has(e.id)),
  }
}

export async function getEmployee(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<EmployeeResult<Employee | null>> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data as Employee | null) ?? null }
}

export async function listManagerOptions(
  supabase: SupabaseClient,
  companyId: string,
  excludeEmployeeId?: string
): Promise<EmployeeResult<Pick<Employee, 'id' | 'name' | 'surname'>[]>> {
  let q = supabase
    .from('employees')
    .select('id, name, surname')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('access_level', [...MANAGER_ACCESS_LEVELS])
    .order('name')
  if (excludeEmployeeId) q = q.neq('id', excludeEmployeeId)
  const { data, error } = await q
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[] }
}

export async function listBranches(
  supabase: SupabaseClient,
  companyId: string
): Promise<EmployeeResult<Branch[]>> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, company_id, name, address')
    .eq('company_id', companyId)
    .order('name')
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data ?? []) as Branch[] }
}

export async function listShiftTemplates(
  supabase: SupabaseClient,
  companyId: string
): Promise<EmployeeResult<ShiftTemplate[]>> {
  const { data, error } = await supabase
    .from('employee_shift_templates')
    .select('id, company_id, name, start_time, end_time, is_default')
    .eq('company_id', companyId)
    .order('name')
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data as ShiftTemplate[]) ?? [] }
}

export async function createEmployee(
  supabase: SupabaseClient,
  input: EmployeeCreateInput
): Promise<EmployeeResult<Employee>> {
  const org = await buildOrgWriteFields(supabase, input.companyId, {
    department: input.department,
    branchId: input.branchId,
    branchName: input.branchName,
    managerId: input.managerId,
  })
  const payload = buildEmployeeCreatePayload({
    ...input,
    employmentType: normalizeEmploymentType(input.employmentType),
    workerType: normalizeWorkerType(input.workerType),
    accessLevel: normalizeAccessLevel(input.accessLevel),
    department: org.department,
    branchId: org.branch_id,
    branchName: org.branch,
    managerId: org.manager_id,
    managerUserId: org.manager_user_id,
  })
  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select()
    .single()
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: data as Employee }
}

export type EmployeeUpdateInput = {
  companyId: string
  name: string
  surname: string
  email?: string | null
  phone?: string | null
  idNumber?: string | null
  position?: string | null
  department?: string | null
  branchId?: string | null
  branchName?: string | null
  shiftTemplateId?: string | null
  employmentType: string
  workerType: string
  accessLevel: string
  managerId?: string | null
  employmentDate?: string | null
  monthlySalary: number
  payByHour: boolean
  payBasis?: string | null
  payeRatePercent?: number | null
  uifExempt: boolean
  medicalAidDeduction: number
  pensionDeduction: number
  unionDeduction: number
  workDaysWeekly: number
  dailyHours: number
  hourlyRate: number
  dailyRate: number
  bankName?: string | null
  bankAccount?: string | null
  bankBranchCode?: string | null
  accountType?: string | null
}

export async function updateEmployee(
  supabase: SupabaseClient,
  employeeId: string,
  input: EmployeeUpdateInput
): Promise<EmployeeResult<void>> {
  const org = await buildOrgWriteFields(supabase, input.companyId, {
    department: input.department,
    branchId: input.branchId,
    branchName: input.branchName,
    managerId: input.managerId,
  })
  const { error } = await supabase
    .from('employees')
    .update({
      name: input.name.trim(),
      surname: input.surname.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      id_number: input.idNumber?.trim() || null,
      position: input.position?.trim() || null,
      department: org.department,
      cost_center: org.cost_center,
      branch_id: org.branch_id,
      branch: org.branch,
      shift_template_id: input.shiftTemplateId || null,
      employment_type: normalizeEmploymentType(input.employmentType),
      worker_type: normalizeWorkerType(input.workerType),
      access_level: normalizeAccessLevel(input.accessLevel),
      manager_id: org.manager_id,
      manager_user_id: org.manager_user_id,
      employment_date: input.employmentDate || null,
      monthly_salary: input.monthlySalary,
      pay_by_hour: input.payByHour,
      pay_basis: input.payByHour ? (input.payBasis || null) : null,
      paye_rate_percent: input.payeRatePercent ?? null,
      uif_exempt: input.uifExempt,
      medical_aid_deduction: input.medicalAidDeduction,
      pension_deduction: input.pensionDeduction,
      union_deduction: input.unionDeduction,
      work_days_weekly: input.workDaysWeekly,
      daily_hours: input.dailyHours,
      hourly_rate: input.hourlyRate,
      daily_rate: input.dailyRate,
      bank_name: input.bankName?.trim() || null,
      bank_account: input.bankAccount?.trim() || null,
      bank_branch_code: input.bankBranchCode?.trim() || null,
      account_type: input.accountType || null,
    })
    .eq('id', employeeId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

export { setEmployeeActive, deleteEmployee, loadScopedEmployeeIds }
