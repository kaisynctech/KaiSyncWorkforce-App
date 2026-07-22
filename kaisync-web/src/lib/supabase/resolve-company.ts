import type { SupabaseClient } from '@supabase/supabase-js'
import { getCodeSession, getEmpContext } from '@/lib/auth/code-session'

export type CurrentMember = {
  employeeId: string
  companyId: string
  sessionToken: string | null
}

/**
 * Resolves the active employee + company for RPC calls.
 * Prefer company selected via company picker (kf_emp_ctx) for JWT users.
 * Fall back to code session (kf_cs) when no Supabase user.
 */
export async function resolveCurrentMember(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const ctx = typeof window !== 'undefined' ? getEmpContext() : null
    if (ctx?.employee_id && ctx.company_id) {
      const { data } = await supabase
        .from('employees')
        .select('id, company_id')
        .eq('id', ctx.employee_id)
        .eq('company_id', ctx.company_id)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()
      if (data?.company_id) {
        return { employeeId: data.id, companyId: data.company_id, sessionToken: null }
      }
    }

    const { data } = await supabase
      .from('employees')
      .select('id, company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (data?.company_id) {
      return { employeeId: data.id, companyId: data.company_id, sessionToken: null }
    }
  }

  if (typeof window !== 'undefined') {
    const cs = getCodeSession()
    if (cs?.employee_id && cs.company_id) {
      return {
        employeeId: cs.employee_id,
        companyId: cs.company_id,
        sessionToken: cs.session_token ?? null,
      }
    }
  }

  return null
}
