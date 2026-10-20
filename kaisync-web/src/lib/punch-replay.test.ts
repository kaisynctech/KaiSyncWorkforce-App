import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Node test environment: give the queue a window + localStorage.
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
})
vi.stubGlobal('window', globalThis)
vi.mock('@/lib/offline/meta', () => ({ notifyOfflineChanged: () => {} }))
vi.mock('@/lib/geo-location', () => ({ needsPlaceName: () => false, reverseGeocodeRequired: async () => null }))

import { enqueue, getQueue, isSessionAuthError, otherWorkersQueuedCount, SESSION_ENDED_MESSAGE, type QueuedPunch } from '@/lib/punch-queue'
import { flushQueuedPunchesFor } from '@/lib/punch-replay'

function punch(key: string, employee: string, type: 'in' | 'out' = 'in'): QueuedPunch {
  return {
    idempotency_key: key, company_id: 'co', employee_id: employee, type,
    date_time: `2026-10-20T05:2${key.length}:00Z`, latitude: null, longitude: null,
    address: null, job_id: null, notes: null, queued_at: '2026-10-20T05:20:00Z',
  }
}

/** Fake server: a token may only punch for its own worker. */
function fakeSupabase(tokens: Record<string, string>, opts?: { failKey?: string }) {
  const calls: Array<{ key: string; employee: string }> = []
  const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
    calls.push({ key: String(args.p_idempotency_key), employee: String(args.p_employee_id) })
    if (opts?.failKey === args.p_idempotency_key) return { data: null, error: { message: 'Failed to fetch' } }
    if (tokens[String(args.p_session_token)] !== args.p_employee_id) {
      return { data: null, error: { message: 'UNAUTHORIZED' } }
    }
    return { data: { id: `row-${args.p_idempotency_key}` }, error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, calls }
}

describe('flushQueuedPunchesFor (shared phone)', () => {
  beforeEach(() => mem.clear())

  it("never sends another worker's clock-in with this worker's sign-in", async () => {
    enqueue(punch('a1', 'A'))
    enqueue(punch('b1', 'B'))
    const { client, calls } = fakeSupabase({ tokB: 'B' })
    const res = await flushQueuedPunchesFor(client, 'B', 'tokB')
    expect(res).toEqual({ flushed: 1, error: null })
    expect(calls.map(c => c.employee)).toEqual(['B'])
    // A's clock-in is kept for A, not lost.
    expect(getQueue().map(p => p.idempotency_key)).toEqual(['a1'])
    expect(otherWorkersQueuedCount('B')).toBe(1)
  })

  it("does not let another worker's clock-in block this worker's", async () => {
    enqueue(punch('a1', 'A'))
    enqueue(punch('b1', 'B'))
    enqueue(punch('b2', 'B', 'out'))
    const { client } = fakeSupabase({ tokB: 'B' })
    const res = await flushQueuedPunchesFor(client, 'B', 'tokB')
    expect(res.flushed).toBe(2)
    expect(getQueue().map(p => p.idempotency_key)).toEqual(['a1'])
  })

  it("uploads A's saved clock-in when A signs in on the phone", async () => {
    enqueue(punch('a1', 'A'))
    const { client } = fakeSupabase({ tokA: 'A' })
    expect(await flushQueuedPunchesFor(client, 'A', 'tokA')).toEqual({ flushed: 1, error: null })
    expect(getQueue()).toEqual([])
  })

  it("keeps this worker's clock-ins in order: stops at the first failure", async () => {
    enqueue(punch('b1', 'B'))
    enqueue(punch('b2', 'B', 'out'))
    const { client, calls } = fakeSupabase({ tokB: 'B' }, { failKey: 'b1' })
    const res = await flushQueuedPunchesFor(client, 'B', 'tokB')
    expect(res.flushed).toBe(0)
    expect(res.error).toBe('Failed to fetch')
    expect(calls).toHaveLength(1)
    expect(getQueue()).toHaveLength(2)
  })

  it('explains an ended sign-in instead of showing UNAUTHORIZED', async () => {
    enqueue(punch('b1', 'B'))
    const { client } = fakeSupabase({ tokB: 'B' })
    const res = await flushQueuedPunchesFor(client, 'B', 'revoked-token')
    expect(res.error).toBe(SESSION_ENDED_MESSAGE)
    expect(getQueue()).toHaveLength(1)
  })
})

describe('isSessionAuthError', () => {
  it('matches the server rejections for ended sign-ins only', () => {
    expect(isSessionAuthError('UNAUTHORIZED')).toBe(true)
    expect(isSessionAuthError('Code session expired or invalid')).toBe(true)
    expect(isSessionAuthError('Failed to fetch')).toBe(false)
    expect(isSessionAuthError('You are on approved leave today')).toBe(false)
    expect(isSessionAuthError(null)).toBe(false)
  })
})
