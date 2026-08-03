/**
 * Live work_teams schema (UUID era):
 *   member_ids uuid[] + leader_employee_id
 * There is no work_team_members join table.
 */

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
