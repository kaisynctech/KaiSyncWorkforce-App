/**
 * Live work_teams schema (UUID era):
 *   member_ids uuid[] + leader_employee_id
 * There is no work_team_members join table.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkTeamRow = {
  id: string
  company_id: string
  name: string
  description: string | null
  leader_employee_id: string | null
  member_ids: string[] | null
  is_active: boolean
  created_at?: string
}

export type WorkTeamMemberView = {
  /** Same as employee_id — no separate membership row id in live schema */
  id: string
  employee_id: string
  is_leader: boolean
  employee?: {
    name: string
    surname: string
    branch_id?: string | null
    position?: string | null
  }
}

export type WorkTeamResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

const TEAM_SELECT =
  'id, company_id, name, description, leader_employee_id, member_ids, is_active, created_at'

export function memberIdsOf(team: { member_ids?: string[] | null }): string[] {
  return Array.isArray(team.member_ids) ? team.member_ids : []
}

export function memberCountOf(team: { member_ids?: string[] | null }): number {
  return memberIdsOf(team).length
}

export function withMemberCount<T extends { member_ids?: string[] | null }>(
  team: T
): T & { member_count: number } {
  return { ...team, member_count: memberCountOf(team) }
}

export async function listWorkTeams(
  supabase: SupabaseClient,
  companyId: string,
  opts?: { activeOnly?: boolean }
): Promise<WorkTeamResult<(WorkTeamRow & { member_count: number })[]>> {
  let q = supabase
    .from('work_teams')
    .select(TEAM_SELECT)
    .eq('company_id', companyId)
    .order('name')
  if (opts?.activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) return { ok: false, message: error.message }
  return {
    ok: true,
    data: (data ?? []).map(t => withMemberCount(t as WorkTeamRow)),
  }
}

export async function getWorkTeam(
  supabase: SupabaseClient,
  companyId: string,
  teamId: string
): Promise<WorkTeamResult<WorkTeamRow | null>> {
  const { data, error } = await supabase
    .from('work_teams')
    .select(TEAM_SELECT)
    .eq('id', teamId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data as WorkTeamRow | null) ?? null }
}

export async function createWorkTeam(
  supabase: SupabaseClient,
  input: {
    companyId: string
    name: string
    description?: string | null
    isActive?: boolean
  }
): Promise<WorkTeamResult<WorkTeamRow>> {
  const { data, error } = await supabase
    .from('work_teams')
    .insert({
      company_id: input.companyId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_active: input.isActive ?? true,
      member_ids: [],
    })
    .select(TEAM_SELECT)
    .single()
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: data as WorkTeamRow }
}

export async function updateWorkTeam(
  supabase: SupabaseClient,
  teamId: string,
  input: {
    name: string
    description?: string | null
    isActive: boolean
    memberIds?: string[]
    leaderEmployeeId?: string | null
  }
): Promise<WorkTeamResult<void>> {
  const patch: Record<string, unknown> = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    is_active: input.isActive,
  }
  if (input.memberIds) patch.member_ids = input.memberIds
  if (input.leaderEmployeeId !== undefined) patch.leader_employee_id = input.leaderEmployeeId

  const { error } = await supabase.from('work_teams').update(patch).eq('id', teamId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

export async function setWorkTeamMembers(
  supabase: SupabaseClient,
  teamId: string,
  memberIds: string[],
  leaderEmployeeId?: string | null
): Promise<WorkTeamResult<void>> {
  const patch: Record<string, unknown> = { member_ids: memberIds }
  if (leaderEmployeeId !== undefined) patch.leader_employee_id = leaderEmployeeId
  const { error } = await supabase.from('work_teams').update(patch).eq('id', teamId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

export async function setWorkTeamLeader(
  supabase: SupabaseClient,
  teamId: string,
  leaderEmployeeId: string | null
): Promise<WorkTeamResult<void>> {
  const { error } = await supabase
    .from('work_teams')
    .update({ leader_employee_id: leaderEmployeeId })
    .eq('id', teamId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

/** Soft-archive / reactivate — prefer over hard delete. */
export async function setWorkTeamActive(
  supabase: SupabaseClient,
  teamId: string,
  isActive: boolean
): Promise<WorkTeamResult<void>> {
  const { error } = await supabase
    .from('work_teams')
    .update({ is_active: isActive })
    .eq('id', teamId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

/** Resolve leader display names for a list of teams (batched). */
export async function resolveTeamLeaderNames(
  supabase: SupabaseClient,
  teams: { leader_employee_id?: string | null }[]
): Promise<WorkTeamResult<Map<string, string>>> {
  const ids = [
    ...new Set(
      teams
        .map(t => t.leader_employee_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]
  const map = new Map<string, string>()
  if (ids.length === 0) return { ok: true, data: map }

  const { data, error } = await supabase
    .from('employees')
    .select('id, name, surname')
    .in('id', ids)
  if (error) return { ok: false, message: error.message }

  for (const e of data ?? []) {
    map.set(e.id, `${e.name ?? ''} ${e.surname ?? ''}`.trim())
  }
  return { ok: true, data: map }
}

export async function resolveWorkTeamMembers(
  supabase: SupabaseClient,
  memberIds: string[],
  leaderId: string | null
): Promise<WorkTeamResult<WorkTeamMemberView[]>> {
  if (memberIds.length === 0) return { ok: true, data: [] }
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, surname, branch_id, position')
    .in('id', memberIds)
  if (error) return { ok: false, message: error.message }

  const byId = new Map((data ?? []).map(e => [e.id, e]))
  return {
    ok: true,
    data: memberIds.map(id => {
      const emp = byId.get(id)
      return {
        id,
        employee_id: id,
        is_leader: leaderId === id,
        employee: emp
          ? {
              name: emp.name,
              surname: emp.surname,
              branch_id: emp.branch_id,
              position: emp.position,
            }
          : undefined,
      }
    }),
  }
}
