'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AUTH_ROUTES } from '@/lib/auth/employee-routing'
import {
  AuthBackButton,
  AuthError,
  AuthShell,
  authInputClass,
  authInputFocusHandlers,
  authInputStyle,
  authPrimaryButtonStyle,
} from '@/components/AuthShell'

function RegisterVerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const firstName = searchParams.get('firstName') ?? ''
  const lastName = searchParams.get('lastName') ?? ''
  const password = searchParams.get('password') ?? ''

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    if (!email.trim()) return
    if (!password) {
      setError('Go back and re-enter your password to resend the code.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      await supabase.auth.signUp({ email: email.trim().toLowerCase(), password })
      setError('Code resent. Check your email.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not resend code.')
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
      const types = ['signup', 'magiclink', 'email'] as const
      let verified = false
      for (const type of types) {
        const { error: vErr } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token,
          type,
        })
        if (!vErr) {
          verified = true
          break
        }
      }
      if (!verified) {
        throw new Error('The verification code is incorrect or has expired. Please request a new one.')
      }

      const params = new URLSearchParams({
        email,
        firstName,
        lastName,
      })
      router.push(`${AUTH_ROUTES.linkCompany}?${params.toString()}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthBackButton onClick={() => router.push(AUTH_ROUTES.selfRegister)} />
        <div>
          <h1 className="text-[22px] font-bold text-white">Verify Email</h1>
          <p className="text-slate-400 text-[13px]">Code sent to {email || 'your email'}</p>
        </div>
      </div>

      <AuthError message={error} />

      <form onSubmit={verify} className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Verification code</label>
          <input
            type="text"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
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
          disabled={loading}
          className="w-full text-[13px] font-semibold text-blue-400"
        >
          Resend code
        </button>
      </form>
    </div>
  )
}

export default function EmployeeRegisterVerifyPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-slate-400 text-center py-10">Loading…</p>}>
        <RegisterVerifyForm />
      </Suspense>
    </AuthShell>
  )
}
