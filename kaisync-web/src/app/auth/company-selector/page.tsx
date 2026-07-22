'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { saveEmpContext, clearAllAuthLocalState, hasCodeSession } from '@/lib/auth/code-session'
import { AUTH_ROUTES, routeAfterCompanySelected } from '@/lib/auth/employee-routing'
import {
  getMyMemberships,
  isMembershipPending,
  isMembershipRejected,
  revokeCodeSession,
  type EmployeeMembership,
} from '@/lib/auth/session'
import {
  AuthError,
  AuthShell,
  authPrimaryButtonStyle,
} from '@/components/AuthShell'

export default function CompanySelectorPage() {
  const router = useRouter()
  const [memberships, setMemberships] = useState<EmployeeMembership[]>([])
  const [employeeName, setEmployeeName] = useState('')
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alert, setAlert] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const list = await getMyMemberships(supabase)
      setMemberships(list)
      const first = list[0]
      setEmployeeName(first ? `${first.name} ${first.surname}`.trim() : '')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load companies.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function selectMembership(m: EmployeeMembership) {
    if (isMembershipRejected(m)) {
      setAlert(
        `Your request to join ${m.company_name} was declined. Contact their HR team if you need help.`,
      )
      return
    }

    setSelecting(true)
    setError(null)
    try {
      const supabase = createClient()

      // Prefer live employee row for access_level when JWT is present
      const { data: { user } } = await supabase.auth.getUser()
      let accessLevel = m.access_level
      if (user) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id, access_level, name, surname, registration_status, is_active')
          .eq('user_id', user.id)
          .eq('company_id', m.company_id)
          .maybeSingle()
        if (emp) {
          accessLevel = emp.access_level ?? accessLevel
          saveEmpContext({
            employee_id: emp.id,
            company_id: m.company_id,
            access_level: accessLevel,
            name: emp.name ?? m.name,
            surname: emp.surname ?? m.surname,
            company_name: m.company_name,
            company_code: m.company_code,
            registration_status: emp.registration_status ?? m.registration_status,
          })
        } else {
          saveEmpContext({
            employee_id: m.employee_id,
            company_id: m.company_id,
            access_level: accessLevel,
            name: m.name,
            surname: m.surname,
            company_name: m.company_name,
            company_code: m.company_code,
            registration_status: m.registration_status,
          })
        }
      } else {
        saveEmpContext({
          employee_id: m.employee_id,
          company_id: m.company_id,
          access_level: accessLevel,
          name: m.name,
          surname: m.surname,
          company_name: m.company_name,
          company_code: m.company_code,
          registration_status: m.registration_status,
        })
      }

      if (isMembershipPending(m)) {
        router.push(AUTH_ROUTES.employeeDashboard)
        return
      }

      router.push(routeAfterCompanySelected(accessLevel))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not select company.')
    } finally {
      setSelecting(false)
    }
  }

  async function signOut() {
    const supabase = createClient()
    await revokeCodeSession(supabase)
    await supabase.auth.signOut()
    clearAllAuthLocalState()
    router.replace(AUTH_ROUTES.idEntry)
  }

  async function linkAnother() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      setAlert(
        'Link another company after you sign in with your email and password, or complete self-registration.',
      )
      return
    }
    const first = memberships[0]
    const params = new URLSearchParams({
      email: user.email,
      firstName: first?.name ?? '',
      lastName: first?.surname ?? '',
    })
    router.push(`${AUTH_ROUTES.linkCompany}?${params.toString()}`)
  }

  const canReturn = memberships.length > 0 || hasCodeSession()

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold text-white">My Companies</h1>
            <p className="text-slate-400 text-[13px] mt-1">
              {employeeName ? `Signed in as ${employeeName}` : 'Select a company to continue'}
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-slate-400 hover:text-white"
            aria-label="Refresh"
          >
            <span className="material-icons text-[22px]">refresh</span>
          </button>
        </div>

        <AuthError message={error} />
        {alert && (
          <div
            className="p-3 rounded-xl text-[13px] text-amber-300"
            style={{ backgroundColor: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            {alert}
            <button
              type="button"
              className="block mt-2 text-blue-400 text-[12px]"
              onClick={() => setAlert(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-[14px] py-8 justify-center">
            <span className="material-icons animate-spin text-blue-400">refresh</span>
            Loading…
          </div>
        ) : memberships.length === 0 ? (
          <p className="text-slate-400 text-[14px] text-center py-6">
            No companies linked yet. Link a company to continue.
          </p>
        ) : (
          <div className="space-y-3">
            {memberships.map((m) => {
              const statusColor = isMembershipRejected(m)
                ? '#EF4444'
                : isMembershipPending(m)
                  ? '#F59E0B'
                  : '#22C55E'
              const statusLabel = isMembershipRejected(m)
                ? 'Declined'
                : isMembershipPending(m)
                  ? 'Awaiting HR approval'
                  : 'Active'

              return (
                <button
                  key={`${m.company_id}-${m.employee_id}`}
                  type="button"
                  disabled={selecting}
                  onClick={() => selectMembership(m)}
                  className="w-full text-left p-4 rounded-2xl border transition-all disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-white text-[15px] font-semibold">{m.company_name || 'Company'}</p>
                      <p className="text-slate-500 text-[12px] mt-0.5">
                        Code {m.company_code || '—'} · {m.access_level}
                      </p>
                    </div>
                    <span
                      className="text-[11px] font-semibold px-2 py-1 rounded-full"
                      style={{ color: statusColor, backgroundColor: `${statusColor}22` }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={linkAnother}
            className="w-full h-11 rounded-xl text-white text-[14px] font-semibold"
            style={authPrimaryButtonStyle}
          >
            Link another company
          </button>

          {canReturn && (
            <button
              type="button"
              onClick={() => router.push(AUTH_ROUTES.employeeDashboard)}
              className="w-full h-11 rounded-xl text-[14px] font-medium text-slate-300"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
            >
              Back to dashboard
            </button>
          )}

          <button
            type="button"
            onClick={signOut}
            className="w-full h-11 rounded-xl text-[14px] font-medium text-red-400"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </AuthShell>
  )
}
