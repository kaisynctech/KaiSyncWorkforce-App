'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Step 1b of HR sign-up: enter the 6-digit code from the confirmation email. */
function VerifyForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    const token = code.replace(/\D/g, '')
    if (!email.trim() || token.length < 6) return
    setLoading(true); setError(null); setInfo(null)
    try {
      const supabase = createClient()
      const { error: vErr } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'signup' })
      if (vErr) {
        // An already-confirmed address can still sign in with an email code.
        const { error: v2 } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' })
        if (v2) throw new Error('That code is wrong or has expired. Check the latest email, or send a new code.')
      }
      router.push('/auth/hr-register-company')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setLoading(true); setError(null); setInfo(null)
    try {
      const { error: rErr } = await createClient().auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
      if (rErr) throw rErr
      setInfo('A new code is on its way. Check your inbox (and spam folder).')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send a new code.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors'

  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-16 h-16 rounded-full bg-success-dark flex items-center justify-center mb-4">
            <span className="material-icons text-success text-3xl">mark_email_unread</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">Verify your email</h1>
          <p className="text-[13px] text-text-secondary mt-1">
            We sent a 6-digit code to {params.get('email') ? <span className="text-text-primary">{params.get('email')}</span> : 'your email'}.
            Enter it below to continue.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-dark rounded-md flex items-center gap-2">
            <span className="material-icons text-error text-[18px]">error_outline</span>
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}
        {info && <div className="mb-4 p-3 bg-background rounded-md text-[13px] text-text-secondary">{info}</div>}

        <form onSubmit={verify} className="flex flex-col gap-4">
          {!params.get('email') && (
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="you@company.com" />
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="123456"
              className={`${inputClass} tracking-[0.4em] text-center text-[18px]`}
              disabled={loading}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading || code.replace(/\D/g, '').length < 6 || !email.trim()}
            className="h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Verify and continue'}
          </button>
          <button type="button" onClick={() => void resend()} disabled={loading} className="text-[13px] font-semibold text-primary hover:underline">
            Send a new code
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <Link href="/auth/hr-register" className="block text-[12px] text-text-secondary hover:text-primary">Wrong email? Start again</Link>
          <Link href="/auth/hr-sign-in" className="block text-[12px] text-text-secondary hover:text-primary">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}

export default function HrRegisterVerifyPage() {
  return (
    <Suspense fallback={<p className="text-text-secondary text-center py-10">Loading…</p>}>
      <VerifyForm />
    </Suspense>
  )
}
