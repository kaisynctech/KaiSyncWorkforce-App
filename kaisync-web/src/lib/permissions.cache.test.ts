import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clearPermissionsCache, loadPermissions } from '@/lib/permissions'

function fakeSupabase(userId: string, keys: string[]) {
  const rpc = vi.fn(async () => ({ data: keys.map(k => ({ permission_key: k, allowed: true })), error: null }))
  const getSession = vi.fn(async () => ({ data: { session: { user: { id: userId } } } }))
  return { client: { rpc, auth: { getSession } } as unknown as SupabaseClient, rpc }
}

beforeEach(() => clearPermissionsCache())

describe('loadPermissions cache', () => {
  it('gate and page share one my_permissions call', async () => {
    const { client, rpc } = fakeSupabase('u1', ['clients.view'])
    const [a, b] = await Promise.all([loadPermissions(client, 'c1', 'hr'), loadPermissions(client, 'c1', 'hr')])
    expect(a.has('clients.view') && b.has('clients.view')).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('separate per user and per company; callers cannot change the cached set', async () => {
    const one = fakeSupabase('u1', ['clients.view'])
    const s = await loadPermissions(one.client, 'c1', 'hr')
    s.add('payroll.run')
    expect((await loadPermissions(one.client, 'c1', 'hr')).has('payroll.run')).toBe(false)
    const two = fakeSupabase('u2', [])
    await loadPermissions(two.client, 'c1', 'hr')
    expect(two.rpc).toHaveBeenCalledTimes(1)
    await loadPermissions(one.client, 'c2', 'hr')
    expect(one.rpc).toHaveBeenCalledTimes(2)
  })
})
