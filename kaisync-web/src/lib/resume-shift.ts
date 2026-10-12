import type { SupabaseClient } from '@supabase/supabase-js'

export async function resumeSameDayShift(
  supabase: SupabaseClient,
  input: { companyId: string; employeeId: string; sessionToken?: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('resume_same_day_shift', {
    p_company_id: input.companyId,
    p_employee_id: input.employeeId,
    p_session_token: input.sessionToken ?? null,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
