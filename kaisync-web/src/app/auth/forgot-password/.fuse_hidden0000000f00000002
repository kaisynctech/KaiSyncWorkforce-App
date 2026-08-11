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

function ForgotPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('Enter your email address first.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
      )
      if (resetErr) throw resetErr
      setSent(true)
    } catch (err: unknown) {
      // Match MAUI: still show success-style message for privacy; surface real errors if thrown
      setSent(true)
      if (err instanceof Error && err.message) {
        // Prefer generic success UX like MAUI DisplayAlert
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthBackButton onClick={() => router.push(AUTH_ROUTES.idEntry)} />
        <div>
          <h1 className="text-[22px] font-bold text-white">Forgot password</h1>
          <p className="text-slate-400 text-[13px]">We&apos;ll email a reset link if the account exists</p>
        </div>
      </div>

      <AuthError message={error} />

      {sent ? (
        <div
          className="p-4 rounded-xl text-[14px] text-slate-200 space-y-3"
          style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}
        >
          <p className="font-semibold text-green-400">Reset Link Sent</p>
          <p>
            If this email has an account, a password reset link was sent. Check your inbox.
          </p>
          <button
            type="button"
            onClick={() => router.push(AUTH_ROUTES.idEntry)}
            className="text-blue-400 text-[13px] font-semibold"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-400 mb-2">Email address</label>
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
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40"
            style={authPrimaryButtonStyle}
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-slate-400 text-center py-10">Loading…</p>}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  )
}
