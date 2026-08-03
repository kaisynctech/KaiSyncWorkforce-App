import { describe, expect, it } from 'vitest'
import {
  filterEmployeesByScope,
  filterTeamsByScope,
  getScopedEmployeeIds,
  viewerSeesAllCompany,
} from '@/lib/employee-scope'
import type { WorkTeamRow } from '@/lib/work-teams'

const viewer = {
  id: 'mgr-1',
  company_id: 'co-1',
  user_id: 'auth-mgr',
  access_level: 'manager',
}

const employees = [
  { id: 'mgr-1', manager_id: null, manager_user_id: null },
  { id: 'e-direct', manager_id: 'mgr-1', manager_user_id: null },
  { id: 'e-legacy', manager_id: null, manager_user_id: 'auth-mgr' },
  { id: 'e-other', manager_id: 'other', manager_user_id: null },
]

const teams: WorkTeamRow[] = [
  {
    id: 't1',
    company_id: 'co-1',
    name: 'Crew',
    description: null,
    leader_employee_id: 'mgr-1',
    member_ids: ['e-team', 'mgr-1'],
    is_active: true,
  },
  {
    id: 't2',
    company_id: 'co-1',
    name: 'Other',
    description: null,
    leader_employee_id: 'e-other',
    member_ids: ['e-other'],
    is_active: true,
  },
]

describe('viewerSeesAllCompany', () => {
  it('is true for owner and hr only', () => {
    expect(viewerSeesAllCompany('owner')).toBe(true)
    expect(viewerSeesAllCompany('hr_admin')).toBe(true)
    expect(viewerSeesAllCompany('manager')).toBe(false)
    expect(viewerSeesAllCompany('employee')).toBe(false)
  })
})

describe('getScopedEmployeeIds', () => {
  it('includes self, manager_id reports, manager_user_id reports, and led team members', () => {
    const ids = getScopedEmployeeIds(viewer, employees, teams)
    expect(ids.has('mgr-1')).toBe(true)
    expect(ids.has('e-direct')).toBe(true)
    expect(ids.has('e-legacy')).toBe(true)
    expect(ids.has('e-team')).toBe(true)
    expect(ids.has('e-other')).toBe(false)
  })
})

describe('filterEmployeesByScope / filterTeamsByScope', () => {
  it('returns all employees for owner', () => {
    const all = filterEmployeesByScope(
      { ...viewer, access_level: 'owner' },
      employees,
      teams
    )
    expect(all).toHaveLength(employees.length)
  })

  it('filters teams to led or joined for managers', () => {
    const scoped = filterTeamsByScope(viewer, teams)
    expect(scoped.map(t => t.id)).toEqual(['t1'])
  })
})
