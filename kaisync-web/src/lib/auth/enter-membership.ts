import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEmpContext } from '@/lib/auth/code-session'
import { AUTH_ROUTES, routeAfterCompanySelected } from '@/lib/auth/employee-routing'
import {
  getMyMemberships,
  isMembershipApproved,
  isMembershipPending,
  isMembershipRejected,
  type EmployeeMembership,
} from '@/lib/auth/session'

export function persistMembershipContext(m: EmployeeMembership): void {
  saveEmpContext({
    employee_id: m.employee_id,
    company_id: m.company_id,
    access_level: m.access_level,
    name: m.name,
    surname: m.surname,
    company_name: m.company_name,
    company_code: m.company_code,
    registration_status: m.registration_status,
  })
}

export function routeForMembership(m: EmployeeMembership): string {
  if (isMembershipPending(m)) return AUTH_ROUTES.employeeDashboard
  return routeAfterCompanySelected(m.access_level)
}

export type PostAuthRoute =
  | { kind: 'enter'; path: string; membership: EmployeeMembership }
  | { kind: 'picker'; path: typeof AUTH_ROUTES.companyPicker }
  | { kind: 'none' }

/**
 * After email/password auth: one usable membership → persist context and enter
 * that company; several → company picker; none → caller handles link/register.
 */
export async function resolvePostAuthRoute(
  supabase: SupabaseClient,
): Promise<PostAuthRoute> {
  const memberships = await getMyMemberships(supabase)
  const usable = memberships.filter((m) => !isMembershipRejected(m))
  const approved = usable.filter(isMembershipApproved)
  const candidates = approved.length > 0 ? approved : usable.filter(isMembershipPending)

  if (candidates.length === 1) {
    const membership = candidates[0]
    persistMembershipContext(membership)
    return { kind: 'enter', path: routeForMembership(membership), membership }
  }

  if (candidates.length > 1 || usable.length > 0) {
    return { kind: 'picker', path: AUTH_ROUTES.companyPicker }
  }

  return { kind: 'none' }
}
