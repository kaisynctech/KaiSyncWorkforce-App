import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlatformCompany, PlatformDashboard } from '@/lib/platform-types'

export async function fetchPlatformDashboard(
  supabase: SupabaseClient,
): Promise<PlatformDashboard | null> {
  const { data, error } = await supabase.rpc('platform_admin_dashboard')
  if (error || !data) return null
  const raw = data as Record<string, unknown>
  return {
    kpis: (raw.kpis ?? {}) as PlatformDashboard['kpis'],
    trends: (raw.trends ?? {}) as PlatformDashboard['trends'],
  }
}

export async function searchPlatformCompanies(
  supabase: SupabaseClient,
  query = '',
  limit = 100,
  offset = 0,
): Promise<PlatformCompany[]> {
  const { data, error } = await supabase.rpc('platform_search_companies', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  })
  if (error || !data) return []
  // RETURNS SETOF jsonb — may arrive as array of objects
  const rows = Array.isArray(data) ? data : [data]
  return rows.map(r => {
    const row = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      code: String(row.code ?? ''),
      plan_code: (row.plan_code as string | null) ?? null,
      subscription_status: String(row.subscription_status ?? 'unknown'),
      employee_count: Number(row.employee_count ?? 0),
      employee_limit: Number(row.employee_limit ?? 0),
      monthly_charge: Number(row.monthly_charge ?? 0),
      created_at: String(row.created_at ?? ''),
      subscription_active: Boolean(row.subscription_active),
    }
  }).filter(r => r.id)
}

export async function setCompanySubscriptionStatus(
  supabase: SupabaseClient,
  companyId: string,
  status: 'active' | 'suspended' | 'trialing' | 'past_due' | 'cancelled',
  note?: string,
) {
  const { error } = await supabase.rpc('platform_set_subscription_status', {
    p_company_id: companyId,
    p_status: status,
    p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function refreshCompanySubscription(
  supabase: SupabaseClient,
  companyId: string,
) {
  const { data, error } = await supabase.rpc('platform_refresh_company_subscription', {
    p_company_id: companyId,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function fetchPlatformAudit(
  supabase: SupabaseClient,
  limit = 50,
) {
  const { data } = await supabase
    .from('saas_platform_audit_log')
    .select('id, action, target_type, target_id, company_id, created_at, detail_json')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
