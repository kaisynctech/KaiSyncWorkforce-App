import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
vi.stubGlobal('window', globalThis)

import {
  clearCompanyWorkspaceCache,
  clearEmployeeWorkspaceCache,
  loadCompanyWorkspace,
  loadEmployeeWorkspace,
  primeCompanyWorkspace,
  primeEmployeeWorkspace,
} from '@/lib/employee-workspace'

function fakeSupabase() {
  const query = { select: () => query, eq: () => query, maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
  const from = vi.fn(() => query)
  const getSession = vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } }))
  return { client: { from, auth: { getSession } } as unknown as SupabaseClient, from }
}

beforeEach(() => { clearCompanyWorkspaceCache(); clearEmployeeWorkspaceCache() })

describe('workspace priming from the dashboard layout', () => {
  it('a primed company is answered without reading companies', async () => {
    const { client, from } = fakeSupabase()
    primeCompanyWorkspace({ id: 'c1', name: 'Ironvale', enabled_modules: { jobs: true }, custom_settings: { dispatch_settings: { radius: 200 } } })
    expect(await loadCompanyWorkspace(client, 'c1')).toEqual({ id: 'c1', name: 'Ironvale', enabled_modules: { jobs: true }, dispatch_settings: { radius: 200 } })
    expect(from).not.toHaveBeenCalled()
  })

  it('a primed employee is answered without reading employees', async () => {
    const { client, from } = fakeSupabase()
    primeEmployeeWorkspace({ id: 'e1', company_id: 'c1', name: 'Thandi', surname: 'M', branch_id: null, branch: null, enforce_branch_geofence: false, registration_status: 'active', is_active: true, access_level: 'owner' })
    const ws = await loadEmployeeWorkspace(client, 'e1')
    expect(ws).toMatchObject({ id: 'e1', access_level: 'owner', enforce_branch_geofence: false })
    expect(from).not.toHaveBeenCalled()
  })

  it('clearing the cache (sign-out, company switch) forgets primed rows', async () => {
    const { client, from } = fakeSupabase()
    primeEmployeeWorkspace({ id: 'e1', company_id: 'c1', access_level: 'owner' })
    primeCompanyWorkspace({ id: 'c1', name: 'Ironvale' })
    clearEmployeeWorkspaceCache()
    clearCompanyWorkspaceCache()
    await loadEmployeeWorkspace(client, 'e1')
    await loadCompanyWorkspace(client, 'c1')
    expect(from).toHaveBeenCalledTimes(2)
  })
})
