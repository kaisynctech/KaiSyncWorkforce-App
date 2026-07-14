import type { SupabaseClient } from '@supabase/supabase-js'

export type CurrentMember = {
  employeeId: string
  companyId: string
}

export async function resolveCurrentMember(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('employees')
    .select('id, company_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!data?.company_id) return null
  return { employeeId: data.id, companyId: data.company_id }
}
