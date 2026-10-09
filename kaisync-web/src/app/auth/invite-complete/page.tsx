'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  AUTH_ROUTES,
  routeAfterCompanySelected,
  routeAfterEmailSignIn,
} from '@/lib/auth/employee-routing'
import { establishSessionFromUrl } from '@/lib/auth/establish-session-from-url'
import { getCurrentJwtEmployee } from '@/lib/auth/session'
import { saveEmpContext } from '@/lib/auth/code-session'
import {
  AuthError,
  AuthShell,
} from '@/components/AuthShell'

type ClaimResult = {
  employee_id: string
  company_id: string
  access_level: string
  login_password_ready: boolean
  email: string
}

/**
 * Landing page for HR/employee invite magic links.
 * Establishes session from the URL (hash or ?code=), links the auth user
 * to the employee row, then routes to Set Password (or dashboard if ready).
 */
export default function InviteCompletePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Opening your invite…')

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const supabase = createClient()

        setStatus('Signing you in from the invite link…')
        const session = await establishSessionFromUrl(supabase, { timeoutMs: 10000 })
        if (cancelled) return

        if (!session) {
          throw new Error(
            'This invite link expired or was already opened. Ask HR to click Send Invite again, then open the newest email once.',
          )
        }

        setStatus('Linking your account…')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: claimErr } = await (supabase.rpc as any)('claim_employee_invite')
        if (claimErr) throw new Error(claimErr.message)

        const claim = data as ClaimResult | null
        if (!claim?.employee_id) {
          const emp = await getCurrentJwtEmployee(supabase)
          if (!emp) throw new Error('Could not link your invite. Contact HR.')
          if (cancelled) return
          router.replace(routeAfterEmailSignIn(emp.login_password_ready))
          return
        }

        saveEmpContext({
          employee_id: claim.employee_id,
          company_id: claim.company_id,
          access_level: claim.access_level ?? 'employee',
        })

        // Names are optional. A slow profile read must not keep this screen up.
        const profile = supabase
          .from('employees')
          .select('id, company_id, access_level, name, surname, companies(name, code)')
          .eq('id', claim.employee_id)
          .maybeSingle()
        const timed = await Promise.race([
          profile,
          new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
        ])
        const empRow = timed && 'data' in timed ? timed.data : null

        if (empRow) {
          const companies = empRow.companies as
            | { name?: string; code?: string }
            | { name?: string; code?: string }[]
            | null
          const co = Array.isArray(companies) ? companies[0] : companies
          saveEmpContext({
            employee_id: empRow.id,
            company_id: empRow.company_id,
            access_level: empRow.access_level ?? claim.access_level ?? 'employee',
            name: empRow.name ?? undefined,
            surname: empRow.surname ?? undefined,
            company_name: co?.name,
            company_code: co?.code ?? undefined,
          })
        }

        if (cancelled) return

        if (!claim.login_password_ready) {
          setStatus('Next: create your password…')
          router.replace(AUTH_ROUTES.mandatoryPassword)
          return
        }

        setStatus('Taking you to your dashboard…')
        router.replace(routeAfterCompanySelected(claim.access_level))
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not complete invite.')
          setStatus('')
        }
      }
    }

    void run()
    return () => { cancelled = true }
  }, [router])

  return (
    <AuthShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-white">Welcome to KaiSync</h1>
          <p className="text-slate-400 text-[13px] mt-1">
            {status || 'Something went wrong with this invite link.'}
          </p>
        </div>

        <AuthError message={error} />

        {error && (
          <div className="space-y-3">
            <Link
              href="/auth/hr-sign-in"
              className="block w-full h-12 rounded-xl text-center leading-[48px] text-white text-[15px] font-semibold"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
            >
              Go to HR sign in
            </Link>
            <p className="text-center text-[13px] text-slate-500">
              Open only the newest invite email once. Security scanners that open the link first can burn it.
            </p>
          </div>
        )}

        {!error && (
          <div className="flex items-center gap-2 text-slate-400 text-[13px]">
            <span className="material-icons animate-spin text-[18px]">progress_activity</span>
            Please wait…
          </div>
        )}
      </div>
    </AuthShell>
  )
}
