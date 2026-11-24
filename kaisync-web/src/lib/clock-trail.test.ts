import { beforeEach, describe, expect, it, vi } from 'vitest'
// Node test environment: give the trail a phone-like localStorage and navigator.
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(),
})
vi.stubGlobal('navigator', { onLine: true, userAgent: 'test-phone' })

import { flushClockTrail, logClockStep, pendingClockTrail } from './clock-trail'

const who = { companyId: 'c1', employeeId: 'e1', sessionToken: 't' }

function fakeClient(fail = false) {
  const calls: Record<string, unknown>[] = []
  const client = { rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => { calls.push(args); return { error: fail ? { message: 'Failed to fetch' } : null } }) }
  return { client: client as never, calls }
}

function setOnline(v: boolean) { Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true }) }

describe('clock-in trail', () => {
  beforeEach(() => { localStorage.clear(); setOnline(true) })

  it('sends a step straight away with the worker in meta', async () => {
    const { client, calls } = fakeClient()
    await logClockStep(client, who, 'tap', { attempt: 'a1', type: 'in' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ p_screen: 'clock', p_action: 'tap', p_level: 'info', p_session_token: 't' })
    expect((calls[0].p_meta as Record<string, unknown>).employee_id).toBe('e1')
    expect(pendingClockTrail()).toBe(0)
  })

  it('keeps steps on the phone with no signal and sends them later, oldest first', async () => {
    setOnline(false)
    const { client, calls } = fakeClient()
    await logClockStep(client, who, 'tap', { attempt: 'a1' })
    await logClockStep(client, who, 'saved_on_phone', { attempt: 'a1' })
    await logClockStep(client, { ...who, employeeId: 'e2' }, 'tap')
    expect(calls).toHaveLength(0)
    expect(pendingClockTrail()).toBe(3)
    setOnline(true)
    expect(await flushClockTrail(client, 'e1', 't')).toBe(2)
    expect(calls.map(c => c.p_action)).toEqual(['tap', 'saved_on_phone'])
    expect(pendingClockTrail()).toBe(1) // another worker's step waits for their own sign-in
  })

  it('keeps the step when the server cannot be reached, and never throws', async () => {
    const { client } = fakeClient(true)
    await expect(logClockStep(client, who, 'failed', {}, 'boom')).resolves.toBeUndefined()
    expect(pendingClockTrail()).toBe(1)
  })
})
