import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const codeSession = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/auth/code-session', () => ({ getCodeSession: () => codeSession.current }))

import {
  clearCompanyWorkspaceCache,
  clearEmployeeWorkspaceCache,
  loadCompanyWorkspace,
  loadEmployeeWorkspace,
} from '@/lib/employee-workspace'

const CO = 'co-1'
const EMP = 'emp-1'

function fakeClient(opts: { authSession: boolean; companyRow?: object | null; employeeRow?: object | null }) {
  const from = vi.fn((table: string) => {
    const row = table === 'companies' ? opts.companyRow ?? null : opts.employeeRow ?? null
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => new Promise(r => setTimeout(() => r({ data: row, error: null }), 1)),
    }
    return chain
  })
  const client = {
    from,
    auth: { getSession: async () => ({ data: { session: opts.authSession ? { access_token: 'jwt' } : null } }) },
  } as unknown as SupabaseClient
  return { client, from }
}

beforeEach(() => {
  clearCompanyWorkspaceCache()
  clearEmployeeWorkspaceCache()
  codeSession.current = null
})

describe('loadCompanyWorkspace', () => {
  it('shares one request between concurrent callers', async () => {
    const { client, from } = fakeClient({
      authSession: true,
      companyRow: { id: CO, name: 'Acme', enabled_modules: { jobs: true }, custom_settings: {} },
    })
    const [a, b, c] = await Promise.all([
      loadCompanyWorkspace(client, CO),
      loadCompanyWorkspace(client, CO),
      loadCompanyWorkspace(client, CO),
    ])
    expect(from).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(c?.name).toBe('Acme')
  })

  it('skips the companies read for a code session with no auth session', async () => {
    codeSession.current = { company_id: CO, company: { name: 'Code Co' }, employee_id: EMP }
    const { client, from } = fakeClient({ authSession: false })
    const ws = await loadCompanyWorkspace(client, CO)
    expect(from).not.toHaveBeenCalled()
    expect(ws).toEqual({ id: CO, name: 'Code Co', enabled_modules: {}, dispatch_settings: {} })
  })

  it('keeps the table read for email-login (JWT) users', async () => {
    codeSession.current = { company_id: CO, company: { name: 'Code Co' }, employee_id: EMP }
    const { client, from } = fakeClient({
      authSession: true,
      companyRow: { id: CO, name: 'Acme', enabled_modules: {}, custom_settings: { dispatch_settings: { a: 1 } } },
    })
    const ws = await loadCompanyWorkspace(client, CO)
    expect(from).toHaveBeenCalledWith('companies')
    expect(ws).toEqual({ id: CO, name: 'Acme', enabled_modules: {}, dispatch_settings: { a: 1 } })
  })

  it('does not cache a result that finishes after the cache was cleared', async () => {
    const { client, from } = fakeClient({
      authSession: true,
      companyRow: { id: CO, name: 'Old', enabled_modules: {}, custom_settings: {} },
    })
    const pending = loadCompanyWorkspace(client, CO)
    clearCompanyWorkspaceCache()
    await pending
    await loadCompanyWorkspace(client, CO)
    expect(from).toHaveBeenCalledTimes(2)
  })
})

describe('loadEmployeeWorkspace', () => {
  it('shares one request between concurrent callers', async () => {
    const { client, from } = fakeClient({
      authSession: true,
      employeeRow: { id: EMP, company_id: CO, name: 'A', surname: 'B', branch_id: 'br', branch: 'X',
        enforce_branch_geofence: false, registration_status: 'active', is_active: true, access_level: 'employee' },
    })
    const [a, b] = await Promise.all([loadEmployeeWorkspace(client, EMP), loadEmployeeWorkspace(client, EMP)])
    expect(from).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(a?.enforce_branch_geofence).toBe(false)
  })

  it('does not cache between sequential calls (realtime membership refresh needs fresh data)', async () => {
    const { client, from } = fakeClient({ authSession: true, employeeRow: { id: EMP, company_id: CO } })
    await loadEmployeeWorkspace(client, EMP)
    await loadEmployeeWorkspace(client, EMP)
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('uses the code session without reading employees when there is no auth session', async () => {
    codeSession.current = {
      company_id: CO, employee_id: EMP,
      employee: { name: 'N', surname: 'S', branch: 'Main', access_level: 'employee', registration_status: 'active', is_active: true },
    }
    const { client, from } = fakeClient({ authSession: false })
    const ws = await loadEmployeeWorkspace(client, EMP)
    expect(from).not.toHaveBeenCalled()
    expect(ws).toMatchObject({ id: EMP, company_id: CO, branch: 'Main', branch_id: null, enforce_branch_geofence: true })
  })

  it('does not use another employee\'s code session', async () => {
    codeSession.current = { company_id: CO, employee_id: 'someone-else', employee: {} }
    const { client, from } = fakeClient({ authSession: false, employeeRow: null })
    expect(await loadEmployeeWorkspace(client, EMP)).toBeNull()
    expect(from).toHaveBeenCalledWith('employees')
  })
})
