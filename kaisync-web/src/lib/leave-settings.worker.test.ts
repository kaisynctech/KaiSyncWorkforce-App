import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLeaveSettings, loadWorkerCompanySettings } from '@/lib/leave-settings'

function client(results: Record<string, { data: unknown; error: { message: string } | null }>) {
  const rpc = vi.fn(async (fn: string) => results[fn] ?? { data: null, error: { message: 'missing' } })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

const LEAVE = { 'Annual Leave': { days: 21 } }

describe('loadWorkerCompanySettings', () => {
  it('code-sign-in worker reads through employee_get_company_settings with their sign-in', async () => {
    const { client: c, rpc } = client({
      employee_get_company_settings: { data: { timezone: 'Africa/Johannesburg', leave_settings: LEAVE }, error: null },
    })
    const res = await loadWorkerCompanySettings(c, 'co', { employeeId: 'e1', sessionToken: 'tok' })
    expect(res.error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('employee_get_company_settings', {
      p_company_id: 'co', p_employee_id: 'e1', p_session_token: 'tok',
    })
    expect(rpc).not.toHaveBeenCalledWith('get_company_settings', expect.anything())
  })

  it('falls back to get_company_settings when the worker call fails (e.g. not deployed yet)', async () => {
    const { client: c, rpc } = client({
      employee_get_company_settings: { data: null, error: { message: 'Could not find the function' } },
      get_company_settings: { data: { leave_settings: LEAVE }, error: null },
    })
    const res = await loadLeaveSettings(c, 'co', { employeeId: 'e1', sessionToken: 'tok' })
    expect(res).toEqual({ ok: true, data: LEAVE })
    expect(rpc).toHaveBeenLastCalledWith('get_company_settings', { p_company_id: 'co' })
  })

  it('HR and email-sign-in callers are unchanged: get_company_settings only', async () => {
    const { client: c, rpc } = client({ get_company_settings: { data: { leave_settings: LEAVE }, error: null } })
    expect(await loadLeaveSettings(c, 'co')).toEqual({ ok: true, data: LEAVE })
    expect(await loadLeaveSettings(c, 'co', { employeeId: 'e1', sessionToken: null })).toEqual({ ok: true, data: LEAVE })
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['get_company_settings', 'get_company_settings'])
  })
})
