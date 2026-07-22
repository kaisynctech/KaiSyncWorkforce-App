'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AUTH_ROUTES,
  routeAfterCompanySelected,
} from '@/lib/auth/employee-routing'
import { getCurrentJwtEmployee } from '@/lib/auth/session'
import {
  AuthBackButton,
  AuthError,
  AuthShell,
  authInputClass,
  authInputFocusHandlers,
  authInputStyle,
  authPrimaryButtonStyle,
} from '@/components/AuthShell'

function EmailOtpForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialEmail = searchParams.get('email') ?? ''

  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function resend() {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      })
      if (otpErr) throw otpErr
      setInfo('Code sent. Check your email.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send code.')
    } finally {
      setLoading(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!otp.trim()) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const token = otp.replace(/\D/g, '')
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: 'email',
      })
      if (verifyErr) {
        const { error: magicErr } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token,
          type: 'magiclink',
        })
        if (magicErr) throw new Error('Invalid or expired code.')
      }

      const employee = await getCurrentJwtEmployee(supabase)
      if (!employee) {
        setError('Invalid or expired code.')
        return
      }

      if (!employee.login_password_ready) {
        router.push(AUTH_ROUTES.mandatoryPassword)
        return
      }

      if (employee.company_id) {
        // Single known company — MAUI tries company then picker
        const { data: companies } = await supabase
          .from('employees')
          .select('company_id')
          .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')

        if (companies && companies.length === 1) {
          router.push(routeAfterCompanySelected(employee.access_level))
          return
        }
      }

      router.push(AUTH_ROUTES.companyPicker)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthBackButton onClick={() => router.push(AUTH_ROUTES.idEntry)} />
        <div>
          <h1 className="text-[22px] font-bold text-white">Enter Code</h1>
          <p className="text-slate-400 text-[13px]">Email verification code</p>
        </div>
      </div>

      <AuthError message={error} />
      {info && <p className="text-[13px] text-green-400">{info}</p>}

      <form onSubmit={verify} className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            style={authInputStyle}
            {...authInputFocusHandlers()}
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Verification code</label>
          <input
            type="text"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="6-digit code"
            className={authInputClass}
            style={authInputStyle}
            {...authInputFocusHandlers()}
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !otp.trim()}
          className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40"
          style={authPrimaryButtonStyle}
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>

        <button
          type="button"
          onClick={resend}
          disabled={loading || !email.trim()}
          className="w-full text-[13px] font-semibold text-blue-400"
        >
          Resend code
        </button>

        <button
          type="button"
          onClick={() => router.push(AUTH_ROUTES.idEntry)}
          className="w-full text-[13px] text-slate-400"
        >
          Change email
        </button>
      </form>
    </div>
  )
}

export default function EmailOtpPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-slate-400 text-center py-10">Loading…</p>}>
        <EmailOtpForm />
      </Suspense>
    </AuthShell>
  )
}
