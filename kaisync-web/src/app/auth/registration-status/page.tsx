'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { clearAllAuthLocalState } from '@/lib/auth/code-session'
import { AUTH_ROUTES } from '@/lib/auth/employee-routing'
import { revokeCodeSession } from '@/lib/auth/session'
import { AuthShell, authPrimaryButtonStyle } from '@/components/AuthShell'

function RegistrationStatusBody() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const status = searchParams.get('status') ?? 'pending'
  const isRejected = status === 'rejected'

  const headline = isRejected ? 'Registration Declined' : 'Awaiting HR Approval'
  const message = isRejected
    ? 'Your request to join this company was declined. Please contact your HR administrator if you believe this is a mistake.'
    : "Your registration request has been sent to HR. Sign in again once your account has been approved — you'll then have full access to the app."

  async function backToLogin() {
    const supabase = createClient()
    await revokeCodeSession(supabase)
    await supabase.auth.signOut()
    clearAllAuthLocalState()
    router.replace(AUTH_ROUTES.idEntry)
  }

  return (
    <div className="space-y-6 text-center">
      <div
        className="mx-auto w-14 h-14 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: isRejected ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
        }}
      >
        <span
          className="material-icons text-[28px]"
          style={{ color: isRejected ? '#EF4444' : '#F59E0B' }}
        >
          {isRejected ? 'cancel' : 'hourglass_empty'}
        </span>
      </div>

      <div>
        <h1 className="text-[22px] font-bold text-white">{headline}</h1>
        <p className="text-slate-400 text-[14px] mt-3 leading-relaxed">{message}</p>
      </div>

      <button
        type="button"
        onClick={backToLogin}
        className="w-full h-12 rounded-xl text-white text-[15px] font-semibold"
        style={authPrimaryButtonStyle}
      >
        Back to login
      </button>
    </div>
  )
}

export default function RegistrationStatusPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-slate-400 text-center py-10">Loading…</p>}>
        <RegistrationStatusBody />
      </Suspense>
    </AuthShell>
  )
}
