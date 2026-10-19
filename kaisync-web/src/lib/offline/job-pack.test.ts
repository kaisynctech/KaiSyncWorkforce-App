import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const store = new Map<string, unknown>()
vi.mock('@/lib/offline/idb', () => ({
  idbGet: async (s: string, k: string) => store.get(`${s}/${k}`),
  idbSet: async (s: string, k: string, v: unknown) => { store.set(`${s}/${k}`, v) },
}))

import {
  downloadJobPack,
  isPackFresh,
  JOB_PACK_CONCURRENCY,
  mapWithConcurrency,
  type JobPack,
} from '@/lib/offline/job-pack'

const CO = 'company-1'
const EMP = 'emp-1'

function jobRow(id: string, status = 'scheduled') {
  return {
    id,
    title: `Job ${id}`,
    status,
    priority: null,
    scheduled_start: null,
    scheduled_end: null,
    job_code: null,
    description: null,
    created_at: '2026-10-01T00:00:00Z',
    assignee_employee_id: EMP,
    assigned_employee_ids: [EMP],
    created_by_employee_id: null,
  }
}

const tick = () => new Promise(r => setTimeout(r, 1))

/** Fake client: list returns `rows`; per-job RPCs resolve after a tick and track concurrency. */
function fakeClient(rows: ReturnType<typeof jobRow>[], opts?: { failJob?: string }) {
  const calls: string[] = []
  let activeJobs = 0
  let peakJobs = 0
  const activeByJob = new Map<string, number>()
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push(fn)
    if (fn === 'employee_get_jobs_for_employee') return { data: rows, error: null }
    const jobId = String(args.p_job_id)
    if (fn !== 'employee_get_job_card_for_job') {
      const n = (activeByJob.get(jobId) ?? 0) + 1
      activeByJob.set(jobId, n)
      if (n === 1) { activeJobs += 1; peakJobs = Math.max(peakJobs, activeJobs) }
    }
    await tick()
    if (fn !== 'employee_get_job_card_for_job') {
      const n = (activeByJob.get(jobId) ?? 1) - 1
      activeByJob.set(jobId, n)
      if (n === 0) activeJobs -= 1
    }
    if (opts?.failJob === jobId && fn === 'employee_get_job_for_employee') throw new Error('boom')
    if (fn === 'employee_get_job_for_employee') return { data: [{ ...rows.find(r => r.id === jobId), detail: true }], error: null }
    if (fn === 'employee_get_job_card_for_employee') return { data: null, error: null }
    if (fn === 'employee_get_job_card_for_job') return { data: { id: `card-${jobId}`, is_completed: 1 }, error: null }
    if (fn === 'employee_get_checklist_for_job') return { data: [{ id: `c-${jobId}`, is_checked: 0 }], error: null }
    return { data: null, error: null }
  })
  const client = { rpc } as unknown as SupabaseClient
  return { client, calls, peak: () => peakJobs }
}

beforeEach(() => { store.clear() })

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 1, 2], 3, async (n, i) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, n))
      active -= 1
      return `${i}:${n}`
    })
    expect(out).toEqual(['0:5', '1:1', '2:4', '3:2', '4:3', '5:1', '6:2'])
    expect(peak).toBe(3)
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})

describe('isPackFresh', () => {
  const now = Date.parse('2026-10-19T08:00:00Z')
  it('is fresh only inside the window', () => {
    expect(isPackFresh('2026-10-19T07:59:00Z', 120_000, now)).toBe(true)
    expect(isPackFresh('2026-10-19T07:57:59Z', 120_000, now)).toBe(false)
  })
  it('treats force, missing, invalid and future timestamps as stale', () => {
    expect(isPackFresh('2026-10-19T07:59:59Z', 0, now)).toBe(false)
    expect(isPackFresh(null, 120_000, now)).toBe(false)
    expect(isPackFresh('nope', 120_000, now)).toBe(false)
    expect(isPackFresh('2026-10-19T09:00:00Z', 120_000, now)).toBe(false)
  })
})

describe('downloadJobPack', () => {
  it('runs at most JOB_PACK_CONCURRENCY jobs at once, keeps order and isolates failures', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => jobRow(`j${i}`))
    const { client, peak } = fakeClient(rows, { failJob: 'j3' })
    const pack = await downloadJobPack(client, { companyId: CO, employeeId: EMP, sessionToken: 't', maxAgeMs: 0 })

    expect(peak()).toBe(JOB_PACK_CONCURRENCY)
    expect(pack.jobs.map(j => j.id)).toEqual(rows.map(r => r.id))
    expect(Object.keys(pack.details)).toEqual(rows.map(r => r.id))
    expect(pack.details.j3).toEqual({ job: rows[3], card: null, checklist: [] })
    expect(pack.details.j0.job).toMatchObject({ id: 'j0', detail: true })
    expect(pack.details.j0.card).toMatchObject({ id: 'card-j0', is_completed: true, work_performed: null, photo_urls: null })
    expect(pack.details.j0.checklist).toEqual([{ id: 'c-j0', description: null, is_checked: false, sort_order: null }])
  })

  it('caps the pack at 40 jobs: open first, then up to 20 closed', async () => {
    const open = Array.from({ length: 30 }, (_, i) => jobRow(`o${i}`))
    const done = Array.from({ length: 25 }, (_, i) => jobRow(`d${i}`, 'completed'))
    const { client } = fakeClient([...done, ...open])
    const pack = await downloadJobPack(client, { companyId: CO, employeeId: EMP, sessionToken: 't', maxAgeMs: 0 })
    expect(pack.jobs).toHaveLength(40)
    expect(pack.jobs.slice(0, 30).map(j => j.id)).toEqual(open.map(j => j.id))
    expect(pack.jobs.slice(30).map(j => j.id)).toEqual(done.slice(0, 10).map(j => j.id))
  })

  it('shares one in-flight download between concurrent callers', async () => {
    const { client, calls } = fakeClient([jobRow('a'), jobRow('b')])
    const opts = { companyId: CO, employeeId: EMP, sessionToken: 't', maxAgeMs: 0 }
    const p1 = downloadJobPack(client, opts)
    const p2 = downloadJobPack(client, opts)
    expect(p2).toBe(p1)
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toBe(b)
    expect(calls.filter(c => c === 'employee_get_jobs_for_employee')).toHaveLength(1)
  })

  it('does not share downloads across employees', async () => {
    const { client, calls } = fakeClient([jobRow('a')])
    await Promise.all([
      downloadJobPack(client, { companyId: CO, employeeId: EMP, sessionToken: 't', maxAgeMs: 0 }),
      downloadJobPack(client, { companyId: CO, employeeId: 'emp-2', sessionToken: 't', maxAgeMs: 0 }),
    ])
    expect(calls.filter(c => c === 'employee_get_jobs_for_employee')).toHaveLength(2)
  })

  it('clears the in-flight entry after a failure so the next call retries', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'down' } })
      .mockResolvedValue({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient
    const opts = { companyId: CO, employeeId: EMP, sessionToken: 't', maxAgeMs: 0 }
    await expect(downloadJobPack(client, opts)).rejects.toEqual({ message: 'down' })
    await expect(downloadJobPack(client, opts)).resolves.toMatchObject({ jobs: [] })
  })

  it('reuses a fresh stored pack without network calls, and refreshes when forced', async () => {
    const fresh: JobPack = {
      companyId: CO, employeeId: EMP, syncedAt: new Date().toISOString(), jobs: [], details: {},
    }
    store.set(`job_pack/${CO}:${EMP}`, fresh)
    const { client, calls } = fakeClient([jobRow('a')])

    const reused = await downloadJobPack(client, { companyId: CO, employeeId: EMP, sessionToken: 't' })
    expect(reused).toEqual(fresh)
    expect(calls).toHaveLength(0)

    const forced = await downloadJobPack(client, { companyId: CO, employeeId: EMP, sessionToken: 't', maxAgeMs: 0 })
    expect(forced.jobs.map(j => j.id)).toEqual(['a'])
    expect(calls[0]).toBe('employee_get_jobs_for_employee')
  })

  it('downloads when the stored pack is older than the window', async () => {
    store.set(`job_pack/${CO}:${EMP}`, {
      companyId: CO, employeeId: EMP, syncedAt: new Date(Date.now() - 180_000).toISOString(), jobs: [], details: {},
    })
    const { client, calls } = fakeClient([jobRow('a')])
    const pack = await downloadJobPack(client, { companyId: CO, employeeId: EMP, sessionToken: 't' })
    expect(pack.jobs.map(j => j.id)).toEqual(['a'])
    expect(calls.length).toBeGreaterThan(0)
  })
})
