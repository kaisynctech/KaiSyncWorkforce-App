import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
})
vi.stubGlobal('window', globalThis)

import { clearCurrentMemberCache, resolveCurrentMember } from '@/lib/supabase/resolve-company'

function fakeSupabase(userId: string | null, empRow: { id: string; company_id: string } | null) {
  const getUser = vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } }))
  const getSession = vi.fn(async () => ({ data: { session: userId ? { user: { id: userId } } : null } }))
  const query = {
    select: () => query, eq: () => query, limit: () => query,
    maybeSingle: vi.fn(async () => ({ data: empRow, error: null })),
  }
  const from = vi.fn(() => query)
  const client = { auth: { getUser, getSession }, from } as unknown as SupabaseClient
  return { client, getUser, from }
}

beforeEach(() => { mem.clear(); clearCurrentMemberCache() })

describe('resolveCurrentMember', () => {
  it('verifies once, then answers from cache without network', async () => {
    const { client, getUser, from } = fakeSupabase('u1', { id: 'e1', company_id: 'c1' })
    expect(await resolveCurrentMember(client)).toEqual({ employeeId: 'e1', companyId: 'c1', sessionToken: null })
    expect(await resolveCurrentMember(client)).toEqual({ employeeId: 'e1', companyId: 'c1', sessionToken: null })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('callers at the same moment share one lookup (layout + gate + page)', async () => {
    const { client, getUser } = fakeSupabase('u1', { id: 'e1', company_id: 'c1' })
    const results = await Promise.all([resolveCurrentMember(client), resolveCurrentMember(client), resolveCurrentMember(client)])
    expect(new Set(results.map(r => r?.employeeId))).toEqual(new Set(['e1']))
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it("a different signed-in user never gets the previous user's member", async () => {
    const a = fakeSupabase('u1', { id: 'e1', company_id: 'c1' })
    await resolveCurrentMember(a.client)
    const b = fakeSupabase('u2', { id: 'e2', company_id: 'c2' })
    expect(await resolveCurrentMember(b.client)).toEqual({ employeeId: 'e2', companyId: 'c2', sessionToken: null })
    expect(b.getUser).toHaveBeenCalledTimes(1)
  })

  it('switching company (kf_emp_ctx) is a new lookup', async () => {
    const { client, getUser } = fakeSupabase('u1', { id: 'e1', company_id: 'c1' })
    await resolveCurrentMember(client)
    mem.set('kf_emp_ctx', JSON.stringify({ employee_id: 'e9', company_id: 'c9' }))
    await resolveCurrentMember(client)
    expect(getUser).toHaveBeenCalledTimes(2)
  })
})
