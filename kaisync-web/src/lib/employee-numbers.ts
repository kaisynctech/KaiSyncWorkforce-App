import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Employee (staff) numbers, e.g. IV-0001. Separate from employee_code, which is the
 * private sign-in code. The database gives the next number automatically when a new
 * employee is saved with a blank number, as long as the company has a prefix.
 */
export type EmployeeNumberSettings = {
  prefix: string | null
  nextNumber: number
  withoutNumber: number
  canEdit: boolean
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string }

export function formatEmployeeNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`
}

/** "IV-0012" when the company has a prefix, otherwise null. */
export function nextEmployeeNumberPreview(s: EmployeeNumberSettings | null): string | null {
  if (!s?.prefix) return null
  return formatEmployeeNumber(s.prefix, s.nextNumber)
}

/** 1 to 6 letters or digits, upper case. Returns the cleaned prefix or an error message. */
export function validateEmployeeNumberPrefix(raw: string): { prefix: string } | { error: string } {
  const prefix = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,6}$/.test(prefix)) return { error: 'Use 1 to 6 letters or digits, for example IV.' }
  return { prefix }
}

export async function getEmployeeNumberSettings(
  supabase: SupabaseClient,
  companyId: string
): Promise<Result<EmployeeNumberSettings>> {
  const { data, error } = await supabase.rpc('hr_get_employee_number_settings', { p_company_id: companyId })
  if (error) return { ok: false, message: error.message }
  const d = (data ?? {}) as { prefix?: string | null; next_number?: number; without_number?: number; can_edit?: boolean }
  return {
    ok: true,
    data: {
      prefix: d.prefix ?? null,
      nextNumber: d.next_number ?? 1,
      withoutNumber: d.without_number ?? 0,
      canEdit: Boolean(d.can_edit),
    },
  }
}

export async function setEmployeeNumberPrefix(
  supabase: SupabaseClient,
  companyId: string,
  prefix: string
): Promise<Result<void>> {
  const { error } = await supabase.rpc('hr_set_employee_number_prefix', { p_company_id: companyId, p_prefix: prefix })
  if (error) return { ok: false, message: error.message.replace(/^PREFIX_INVALID: /, '') }
  return { ok: true, data: undefined }
}

/** Gives a number to every employee who has none, oldest start date first. Returns how many. */
export async function assignMissingEmployeeNumbers(
  supabase: SupabaseClient,
  companyId: string
): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('hr_assign_missing_employee_numbers', { p_company_id: companyId })
  if (error) return { ok: false, message: error.message.replace(/^PREFIX_REQUIRED: /, '') }
  return { ok: true, data: Number(data) || 0 }
}
