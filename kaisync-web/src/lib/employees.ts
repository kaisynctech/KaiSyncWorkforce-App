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
} from '@/lib/employee-taxonomy'
import { executeWithStepUp } from '@/lib/step-up'
import type { Branch, Employee, ShiftTemplate } from '@/types/database'

export type EmployeeResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

async function getCallerRole(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_role', { p_company_id: companyId })
  if (error) return null
  return typeof data === 'string' ? data : null
}

function normBank(v: string | null | undefined): string {
  return (v ?? '').trim()
}

function normAccountType(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

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
  const desiredRole = normalizeAccessLevel(input.accessLevel)

  // Owner cannot be assigned at create — use ownership transfer.
  if (desiredRole === 'owner') {
    return {
      ok: false,
      message: 'Owner cannot be assigned when creating an employee. Create as HR/Manager, then transfer ownership.',
    }
  }

  // Validate elevate permission before insert (avoids orphan employee + failed role).
  if (desiredRole === 'manager' || desiredRole === 'hr') {
    const callerRole = await getCallerRole(supabase, input.companyId)
    if (callerRole !== 'owner' && callerRole !== 'hr') {
      return {
        ok: false,
        message: 'Only Owner or HR can assign Manager or HR access levels.',
      }
    }
    if (desiredRole === 'hr' && callerRole !== 'owner') {
      return {
        ok: false,
        message: 'Only the company Owner can assign the HR access level.',
      }
    }
  }

  const org = await buildOrgWriteFields(supabase, input.companyId, {
    department: input.department,
    branchId: input.branchId,
    branchName: input.branchName,
    managerId: input.managerId,
  })

  // ARCH-009: INSERT RLS only allows access_level = 'employee'.
  // Elevate manager/hr after insert via set_employee_role (SECURITY DEFINER).
  const payload = buildEmployeeCreatePayload({
    ...input,
    employmentType: normalizeEmploymentType(input.employmentType),
    workerType: 'employee',
    accessLevel: 'employee',
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

  let employee = data as Employee

  if (desiredRole === 'manager' || desiredRole === 'hr') {
    const { error: roleErr } = await supabase.rpc('set_employee_role', {
      p_company_id: input.companyId,
      p_employee_id: employee.id,
      p_new_role: desiredRole,
    })
    if (roleErr) {
      return {
        ok: false,
        message: `Employee created, but role could not be set to ${desiredRole}: ${roleErr.message}`,
      }
    }
    employee = { ...employee, access_level: desiredRole }
  }

  return { ok: true, data: employee }
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

export type EmployeeUpdateOptions = {
  /** Required when banking fields change and company has step-up enabled. */
  promptPassword?: () => Promise<string | null>
}

export async function updateEmployee(
  supabase: SupabaseClient,
  employeeId: string,
  input: EmployeeUpdateInput,
  opts?: EmployeeUpdateOptions
): Promise<EmployeeResult<void>> {
  const desiredRole = normalizeAccessLevel(input.accessLevel)

  const currentRes = await getEmployee(supabase, input.companyId, employeeId)
  if (!currentRes.ok) return currentRes
  const current = currentRes.data
  if (!current) return { ok: false, message: 'Employee not found.' }

  const currentRole = normalizeAccessLevel(current.access_level)
  if (desiredRole === 'owner' && currentRole !== 'owner') {
    return {
      ok: false,
      message: 'Owner cannot be assigned here. Use ownership transfer in Settings.',
    }
  }

  const org = await buildOrgWriteFields(supabase, input.companyId, {
    department: input.department,
    branchId: input.branchId,
    branchName: input.branchName,
    managerId: input.managerId,
  })

  // Direct UPDATE only for ARCH-007-granted (+ post-ARCH-007 org/pay) columns.
  // access_level → set_employee_role; banking → update_employee_banking.
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
      worker_type: 'employee',
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
    })
    .eq('id', employeeId)
    .eq('company_id', input.companyId)
  if (error) return { ok: false, message: error.message }

  // Never mutate owner via this path; use transfer_company_ownership.
  if (currentRole !== 'owner' && desiredRole !== 'owner' && desiredRole !== currentRole) {
    const { error: roleErr } = await supabase.rpc('set_employee_role', {
      p_company_id: input.companyId,
      p_employee_id: employeeId,
      p_new_role: desiredRole,
    })
    if (roleErr) return { ok: false, message: roleErr.message }
  }

  const nextBank = {
    bank_name: normBank(input.bankName) || null,
    bank_account: normBank(input.bankAccount) || null,
    bank_branch_code: normBank(input.bankBranchCode) || null,
    account_type: normAccountType(input.accountType) || null,
  }
  const currHasBanking = Boolean(
    normBank(current.bank_name) ||
      normBank(current.bank_account) ||
      normBank(current.bank_branch_code) ||
      normAccountType(current.account_type)
  )
  const nextHasCoreBanking = Boolean(
    nextBank.bank_name || nextBank.bank_account || nextBank.bank_branch_code
  )
  // Ignore account_type-only defaults when no real banking was set before or after.
  const accountTypeChanged =
    normAccountType(current.account_type) !== (nextBank.account_type ?? '') &&
    (currHasBanking || nextHasCoreBanking || Boolean(normAccountType(current.account_type)))
  const bankingChanged =
    normBank(current.bank_name) !== (nextBank.bank_name ?? '') ||
    normBank(current.bank_account) !== (nextBank.bank_account ?? '') ||
    normBank(current.bank_branch_code) !== (nextBank.bank_branch_code ?? '') ||
    accountTypeChanged

  if (bankingChanged) {
    const prompt = opts?.promptPassword
    if (!prompt) {
      return {
        ok: false,
        message: 'Banking details changed — step-up verification is required to save them.',
      }
    }
    const bankResult = await executeWithStepUp(
      supabase,
      input.companyId,
      async () => {
        const { error: bankErr } = await supabase.rpc('update_employee_banking', {
          p_company_id: input.companyId,
          p_employee_id: employeeId,
          p_bank_account: nextBank.bank_account,
          p_bank_name: nextBank.bank_name,
          p_bank_branch_code: nextBank.bank_branch_code,
          p_account_type: nextBank.account_type,
        })
        if (bankErr) return { ok: false as const, message: bankErr.message }
        return { ok: true as const, data: undefined }
      },
      prompt
    )
    if (!bankResult.ok) return bankResult
  }

  return { ok: true, data: undefined }
}

export { setEmployeeActive, deleteEmployee, loadScopedEmployeeIds }
