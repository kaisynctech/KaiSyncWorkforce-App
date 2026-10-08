/**
 * Team / manager-line scoping for operational roles.
 * Ports KaiFlow.Timesheets.Maui/Services/EmployeeScopeService.cs
 *
 * Canonical report line: employees.manager_id → employees.id
 * Legacy fallback: employees.manager_user_id → viewer's auth user_id
 * Plus work-team leadership / membership expansion.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeAccessLevel, type AccessLevelValue } from '@/lib/employee-taxonomy'
import { memberIdsOf, type WorkTeamRow } from '@/lib/work-teams'

export type ScopeViewer = {
  id: string
  company_id: string
  user_id: string | null
  access_level: string | null
}

export type ScopeEmployee = {
  id: string
  manager_id?: string | null
  manager_user_id?: string | null
}

/** Owner / Admin / HR see the full company. Managers are line-scoped. */
export function viewerSeesAllCompany(accessLevel: string | null | undefined): boolean {
  const level: AccessLevelValue = normalizeAccessLevel(accessLevel)
  return level === 'owner' || level === 'admin' || level === 'hr'
}

export function getScopedEmployeeIds(
  viewer: ScopeViewer,
  companyEmployees: ScopeEmployee[],
  teams: WorkTeamRow[]
): Set<string> {
  const ids = new Set<string>([viewer.id])

  for (const e of companyEmployees) {
    if (e.manager_id && e.manager_id === viewer.id) {
      ids.add(e.id)
      continue
    }
    // : reports linked via manager's auth uid
    if (viewer.user_id && e.manager_user_id && e.manager_user_id === viewer.user_id) {
      ids.add(e.id)
    }
  }

  for (const team of teams) {
    const members = memberIdsOf(team)
    if (team.leader_employee_id === viewer.id) {
      for (const memberId of members) ids.add(memberId)
    } else if (members.includes(viewer.id) && team.leader_employee_id) {
      ids.add(team.leader_employee_id)
    }
  }

  return ids
}

export function filterEmployeesByScope<T extends ScopeEmployee>(
  viewer: ScopeViewer,
  companyEmployees: T[],
  teams: WorkTeamRow[]
): T[] {
  if (viewerSeesAllCompany(viewer.access_level)) return companyEmployees
  const allowed = getScopedEmployeeIds(viewer, companyEmployees, teams)
  return companyEmployees.filter(e => allowed.has(e.id))
}

export function filterTeamsByScope(
  viewer: ScopeViewer,
  teams: WorkTeamRow[]
): WorkTeamRow[] {
  if (viewerSeesAllCompany(viewer.access_level)) return teams
  return teams.filter(
    t => t.leader_employee_id === viewer.id || memberIdsOf(t).includes(viewer.id)
  )
}

export type ScopedIdsResult =
  | { ok: true; seesAll: true; ids: null; viewer: ScopeViewer }
  | { ok: true; seesAll: false; ids: Set<string>; viewer: ScopeViewer }
  | { ok: false; message: string }

/**
 * Load viewer + company employees + teams, return allowed employee id set.
 * When seesAll is true, callers should not filter by ids.
 */
type ScopeStatePayload = {
  sees_all?: boolean
  ids?: string[] | null
  viewer?: ScopeViewer | null
}

/**
 * Server-enforced scope. Owner, Admin, and HR see the company.
 * Managers receive only their own line and work-team ids — not the full roster.
 */
export async function loadScopedEmployeeIds(
  supabase: SupabaseClient,
  companyId: string,
  viewerEmployeeId: string
): Promise<ScopedIdsResult> {
  const { data, error } = await supabase.rpc('employee_scope_state', {
    p_company_id: companyId,
  })
  if (error) return { ok: false, message: error.message }

  const body = (data ?? {}) as ScopeStatePayload
  if (!body.viewer?.id) {
    if (body.sees_all) {
      return {
        ok: true,
        seesAll: true,
        ids: null,
        viewer: {
          id: viewerEmployeeId,
          company_id: companyId,
          user_id: null,
          access_level: 'admin',
        },
      }
    }
    return { ok: false, message: 'Viewer employee not found.' }
  }

  const viewer = body.viewer
  if (body.sees_all) return { ok: true, seesAll: true, ids: null, viewer }
  return { ok: true, seesAll: false, ids: new Set(body.ids ?? []), viewer }
}

export function isInScope(
  scope: ScopedIdsResult,
  employeeId: string
): boolean {
  if (!scope.ok) return false
  if (scope.seesAll) return true
  return scope.ids.has(employeeId)
}
