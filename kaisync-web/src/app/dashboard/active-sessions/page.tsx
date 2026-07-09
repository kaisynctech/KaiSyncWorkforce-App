'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const fmtDt = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))

interface Session {
  session_id: string
  employee_id: string
  employee_name: string
  login_method_display: string
  created_at: string
  expires_at: string
}

export default function ActiveSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: me } = await supabase.from('employees').select('company_id').eq('user_id', user.id).maybeSingle()
    if (!me) { setLoading(false); return }

    const { data, error } = await supabase
      .from('employee_sessions')
      .select('id, employee_id, login_method, created_at, expires_at, employees(name, surname)')
      .eq('company_id', me.company_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) { setErrorMessage(error.message); setLoading(false); return }

    setSessions((data ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees as { name: string; surname: string } | null
      return {
        session_id: r.id as string,
        employee_id: r.employee_id as string,
        employee_name: emp ? `${emp.name} ${emp.surname}` : '—',
        login_method_display: (r.login_method as string) ?? 'Unknown',
        created_at: r.created_at as string,
        expires_at: r.expires_at as string,
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function revoke(sessionId: string) {
    setIsBusy(true)
    setErrorMessage('')
    const supabase = createClient()
    try {
      await supabase.rpc('revoke_employee_session', { session_id: sessionId })
      setSessions(prev => prev.filter(s => s.session_id !== sessionId))
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to revoke session.')
    }
    setIsBusy(false)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Active Sessions</h1>
        <button
          onClick={load}
          disabled={isBusy || loading}
          className="bg-surface-dark text-primary h-[40px] px-4 rounded-lg text-[13px] font-semibold hover:opacity-80 disabled:opacity-50 transition-opacity"
        >
          Refresh
        </button>
      </div>

      {errorMessage && (
        <p className="text-error text-[13px] px-4 mt-1 py-1">{errorMessage}</p>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 mt-8">
            <p className="text-text-secondary text-sm">No active sessions</p>
            <p className="text-text-secondary text-xs">All employees are signed out.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map(s => (
              <div key={s.session_id} className="card p-4">
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  {/* Row 0 */}
                  <p className="text-sm font-semibold text-text-primary">{s.employee_name}</p>
                  <p className="text-[11px] text-primary text-right">{s.login_method_display}</p>
                  {/* Row 1 */}
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <p className="text-[11px]">
                      <span className="text-text-secondary">Signed in: </span>
                      <span className="text-text-primary">{fmtDt(s.created_at)}</span>
                    </p>
                    <p className="text-[11px]">
                      <span className="text-text-secondary">Expires: </span>
                      <span className="text-text-secondary">{fmtDt(s.expires_at)}</span>
                    </p>
                  </div>
                  {/* Row 2 */}
                  <div className="col-span-2 mt-1">
                    <button
                      onClick={() => revoke(s.session_id)}
                      disabled={isBusy}
                      className="h-[36px] px-3 text-[12px] rounded-md disabled:opacity-50 transition-opacity"
                      style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}
                    >
                      Revoke session
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
