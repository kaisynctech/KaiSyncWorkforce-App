import type { SupabaseClient } from '@supabase/supabase-js'

export type CurrentMember = {
  employeeId: string
  companyId: string
  sessionToken: string | null
}

export async function resolveCurrentMember(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('employees')
      .select('id, company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()
    if (data?.company_id) {
      return { employeeId: data.id, companyId: data.company_id, sessionToken: null }
    }
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('kf_cs')
      if (raw) {
        const cs = JSON.parse(raw) as {
          employee_id?: string
          company_id?: string
          session_token?: string
        }
        if (cs.employee_id && cs.company_id) {
          return { employeeId: cs.employee_id, companyId: cs.company_id, sessionToken: cs.session_token ?? null }
        }
      }
    } catch {
      // corrupt localStorage — ignore
    }
  }
  return null
}
