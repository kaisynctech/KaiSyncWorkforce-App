import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
})
vi.stubGlobal('window', { location: { pathname: '/dashboard/employee/overview' } })

import { currentMediaReader, signWorkforceMedia, signWorkforceMediaMany } from '@/lib/media-read'

function fakeSupabase(opts?: { grantFails?: boolean }) {
  const rpc = vi.fn(async (fn: string) => {
    if (opts?.grantFails) throw new Error('network')
    return { data: [fn], error: null }
  })
  const createSignedUrl = vi.fn(async (name: string) => ({ data: { signedUrl: `signed:${name}` }, error: null }))
  const client = { rpc, storage: { from: () => ({ createSignedUrl }) } } as unknown as SupabaseClient
  return { client, rpc, createSignedUrl }
}

beforeEach(() => mem.clear())

describe('currentMediaReader', () => {
  it('code-sign-in worker on employee pages', () => {
    mem.set('kf_cs', JSON.stringify({ session_token: 't', employee_id: 'e', company_id: 'c' }))
    expect(currentMediaReader('/dashboard/employee/jobs/1')).toEqual({ kind: 'employee', companyId: 'c', employeeId: 'e', sessionToken: 't' })
  })
  it('client and contractor portals use their own sessions', () => {
    mem.set('kf_cps', JSON.stringify({ client_id: 'k', company_id: 'c', company_code: '28', client_code: 'C1', client_name: 'x' }))
    mem.set('kf_ctps', JSON.stringify({ contractor_id: 'x', company_id: 'c', company_code: '28', contractor_code: 'K1', contractor_name: 'y' }))
    expect(currentMediaReader('/client-portal/jobs/1')).toEqual({ kind: 'client', companyCode: '28', clientCode: 'C1' })
    expect(currentMediaReader('/contractor-portal/home')).toEqual({ kind: 'contractor', companyCode: '28', contractorCode: 'K1' })
  })
  it('staff with an account (no code session) need no grant', () => {
    expect(currentMediaReader('/dashboard/clients/1')).toBeNull()
  })
})

describe('signWorkforceMediaMany', () => {
  it('grants the storage paths once, signs each, and passes web links through', async () => {
    const { client, rpc, createSignedUrl } = fakeSupabase()
    const reader = { kind: 'employee' as const, companyId: 'c', employeeId: 'e', sessionToken: 't' }
    const out = await signWorkforceMediaMany(client, ['job_photos/c/j/a.png', 'https://x/y.png', 'job_photos/c/j/a.png'], 3600, reader)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('employee_grant_media_read', {
      p_company_id: 'c', p_employee_id: 'e', p_paths: ['job_photos/c/j/a.png'], p_session_token: 't',
    })
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    expect(out.get('job_photos/c/j/a.png')).toBe('signed:job_photos/c/j/a.png')
    expect(out.get('https://x/y.png')).toBe('https://x/y.png')
  })

  it('still signs when granting fails (no screen loses files)', async () => {
    const { client, createSignedUrl } = fakeSupabase({ grantFails: true })
    const reader = { kind: 'client' as const, companyCode: '28', clientCode: 'C1' }
    expect(await signWorkforceMedia(client, 'client_documents/c/k/a.pdf', 60, reader)).toBe('signed:client_documents/c/k/a.pdf')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('staff: no grant call, signing as before', async () => {
    const { client, rpc } = fakeSupabase()
    expect(await signWorkforceMedia(client, 'company_logos/c/logo.png', 120, null)).toBe('signed:company_logos/c/logo.png')
    expect(rpc).not.toHaveBeenCalled()
  })
})
