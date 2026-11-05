import { afterEach, describe, expect, it, vi } from 'vitest'
import { READ_ONLY_MESSAGE, friendlyReadOnly, readOnlyFetch } from './read-only-fetch'

const raw = 'new row violates row-level security policy "billing_read_only_insert" for table "finance_invoices"'

afterEach(() => vi.unstubAllGlobals())

describe('read-only messages', () => {
  it('recognises the billing lock policy only', () => {
    expect(friendlyReadOnly(raw)).toBe(READ_ONLY_MESSAGE)
    expect(friendlyReadOnly('new row violates row-level security policy "other"')).toBeNull()
  })

  it('rewrites a refused write', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: '42501', message: raw }), { status: 403 })))
    const r = await readOnlyFetch('https://x/rest/v1/finance_invoices', { method: 'POST' })
    expect(r.status).toBe(403)
    const j = await r.json()
    expect(j.message).toBe(READ_ONLY_MESSAGE)
    expect(j.code).toBe('42501')
  })

  it('leaves other responses alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 403 })))
    const r = await readOnlyFetch('https://x', {})
    expect((await r.json()).message).toBe('nope')
  })
})
