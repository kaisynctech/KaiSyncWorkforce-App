import { afterEach, describe, expect, it, vi } from 'vitest'
import { READ_ONLY_MESSAGE, friendlyPlanLimit, friendlyReadOnly, isPlanLimit, readOnlyFetch } from './read-only-fetch'

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

  it('turns the Starter limit into the upgrade message', async () => {
    expect(friendlyPlanLimit('PLAN_EMPLOYEE_LIMIT:15')).toMatch(/^You've reached 15 employees, the Starter limit\./)
    expect(friendlyPlanLimit('something else')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'P0001', message: 'PLAN_EMPLOYEE_LIMIT:15', hint: 'x' }), { status: 400 })))
    const r = await readOnlyFetch('https://x/rest/v1/employees', { method: 'POST' })
    const j = await r.json()
    expect(r.status).toBe(400)
    expect(j.message).toMatch(/Move to Business for R2,500\/month/)
    expect(isPlanLimit(j.message)).toBe(true)
    expect(isPlanLimit('Name is required')).toBe(false)
  })

  it('leaves other 400s alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad' }), { status: 400 })))
    expect((await (await readOnlyFetch('https://x', {})).json()).message).toBe('bad')
  })
})
