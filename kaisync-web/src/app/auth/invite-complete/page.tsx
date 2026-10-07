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
 * Establishes session from the URL hash, links the auth user to the
 * employee row, then routes to Set Password (or dashboard if ready).
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

        // Magic-link tokens arrive in the URL hash; give the client a moment
        // to persist the session before we claim the employee row.
        let session = (await supabase.auth.getSession()).data.session
        if (!session) {
          await new Promise(r => setTimeout(r, 400))
          session = (await supabase.auth.getSession()).data.session
        }
        if (!session) {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
            throw new Error('Invite link expired or already used. Ask HR to send a new invite.')
          }
        }

        if (cancelled) return
        setStatus('Linking your account…')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: claimErr } = await (supabase.rpc as any)('claim_employee_invite')
        if (claimErr) throw new Error(claimErr.message)

        const claim = data as ClaimResult | null
        if (!claim?.employee_id) {
          // Fallback: already linked via a previous visit
          const emp = await getCurrentJwtEmployee(supabase)
          if (!emp) throw new Error('Could not link your invite. Contact HR.')
          if (cancelled) return
          router.replace(routeAfterEmailSignIn(emp.login_password_ready))
          return
        }

        const { data: empRow } = await supabase
          .from('employees')
          .select('id, company_id, access_level, name, surname, companies(name, code)')
          .eq('id', claim.employee_id)
          .maybeSingle()

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
              Already have a password? Sign in there. Otherwise ask HR to resend your invite.
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
