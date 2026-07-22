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
import { hasCodeSession } from '@/lib/auth/code-session'
import {
  getCurrentJwtEmployee,
  refreshCodeSession,
  signInWithCode,
} from '@/lib/auth/session'
import {
  AuthBackButton,
  AuthError,
  AuthShell,
  authInputClass,
  authInputFocusHandlers,
  authInputStyle,
  authPrimaryButtonStyle,
} from '@/components/AuthShell'

type Step = 'role' | 'employee'
type AuthMethod = 'code' | 'email'

export default function IdEntryPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('role')
  const [authMethod, setAuthMethod] = useState<AuthMethod>('code')
  const [companyCode, setCompanyCode] = useState('')
  const [portalCode, setPortalCode] = useState('')
  const [email, setEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mirror IdEntryViewModel.InitializeAsync — restore JWT or code session
  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const supabase = createClient()
        const jwtEmp = await getCurrentJwtEmployee(supabase)
        if (cancelled) return
        if (jwtEmp) {
          router.replace(routeAfterEmailSignIn(jwtEmp.login_password_ready))
          return
        }

        if (hasCodeSession()) {
          const session = await refreshCodeSession(supabase)
          if (cancelled) return
          if (session) {
            router.replace(routeAfterCompanySelected(session.employee.access_level))
            return
          }
        }

        // Authenticated but no employee — resume self-registration link company
        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return
        if (user?.email) {
          const params = new URLSearchParams({
            email: user.email.trim().toLowerCase(),
            firstName: '',
            lastName: '',
          })
          router.replace(`${AUTH_ROUTES.linkCompany}?${params.toString()}`)
        }
      } catch {
        // stay on login
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }
    restore()
    return () => { cancelled = true }
  }, [router])

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!companyCode.trim() || !portalCode.trim()) {
      setError('Enter both company code and login code.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const session = await signInWithCode(supabase, companyCode, portalCode)
      router.push(routeAfterCompanySelected(session.employee.access_level))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid company code or login code.')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }
    if (!emailPassword) {
      setError('Please enter your password.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const normalized = email.trim().toLowerCase()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalized,
        password: emailPassword,
      })
      if (signInError) throw signInError

      const employee = await getCurrentJwtEmployee(supabase)
      if (!employee) {
        setError('No account found for this email. Contact your administrator.')
        await supabase.auth.signOut()
        return
      }

      router.push(routeAfterEmailSignIn(employee.login_password_ready))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      setError(
        msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials')
          ? 'No account found for this email. Contact your administrator.'
          : (msg || 'No account found for this email. Contact your administrator.'),
      )
    } finally {
      setLoading(false)
    }
  }

  if (restoring) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 text-slate-400 text-[14px] py-20">
          <span className="material-icons animate-spin text-blue-400 text-[20px]">refresh</span>
          Checking session…
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      {step === 'role' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-[26px] font-bold text-white">Welcome back</h1>
            <p className="text-slate-400 text-[14px] mt-1">Select your portal to continue</p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setStep('employee')}
              className="w-full group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200 text-left"
              style={{ backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)' }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
              >
                <span className="material-icons text-white text-[20px]">badge</span>
              </div>
              <div className="flex-1">
                <p className="text-white text-[15px] font-semibold">Employee</p>
                <p className="text-slate-400 text-[12px] mt-0.5">Sign in with company &amp; login code</p>
              </div>
              <span className="material-icons text-slate-500 group-hover:text-blue-400 transition-colors text-[20px]">
                arrow_forward_ios
              </span>
            </button>

            <Link
              href="/auth/hr-sign-in"
              className="w-full group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200"
              style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)' }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}
              >
                <span className="material-icons text-white text-[20px]">manage_accounts</span>
              </div>
              <div className="flex-1">
                <p className="text-white text-[15px] font-semibold">HR / Employer</p>
                <p className="text-slate-400 text-[12px] mt-0.5">Sign in with email and password</p>
              </div>
              <span className="material-icons text-slate-500 group-hover:text-indigo-400 transition-colors text-[20px]">
                arrow_forward_ios
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <span className="text-slate-500 text-[12px]">Other portals</span>
            <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: 'work_outline', label: 'Job Portal', sub: 'Guest', href: '/jobs' },
              { icon: 'handshake', label: 'Client', sub: 'Portal', href: '/client-portal' },
              { icon: 'engineering', label: 'Contractor', sub: 'Portal', href: '/contractor-portal' },
            ].map((p) => (
              <Link
                key={p.label}
                href={p.href}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 text-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <span className="material-icons text-slate-400 text-[22px]">{p.icon}</span>
                <div>
                  <p className="text-slate-300 text-[11px] font-medium">{p.label}</p>
                  <p className="text-slate-500 text-[10px]">{p.sub}</p>
                </div>
              </Link>
            ))}
          </div>

          <p className="text-center text-[13px] text-slate-500">
            New company?{' '}
            <Link href="/auth/hr-register" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
              Register here
            </Link>
          </p>
        </div>
      )}

      {step === 'employee' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <AuthBackButton onClick={() => { setStep('role'); setError(null) }} />
            <div>
              <h1 className="text-[22px] font-bold text-white">Employee sign in</h1>
              <p className="text-slate-400 text-[13px]">
                {authMethod === 'code'
                  ? 'Use company code + login code from your employer.'
                  : 'Sign in with the email and password you set after joining.'}
              </p>
            </div>
          </div>

          <div className="flex rounded-xl overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={() => { setAuthMethod('code'); setError(null) }}
              className="flex-1 py-2.5 text-[13px] font-semibold transition-all"
              style={authMethod === 'code'
                ? { background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff' }
                : { background: 'transparent', color: '#94a3b8' }}
            >
              Login code
            </button>
            <button
              type="button"
              onClick={() => { setAuthMethod('email'); setError(null) }}
              className="flex-1 py-2.5 text-[13px] font-semibold transition-all"
              style={authMethod === 'email'
                ? { background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff' }
                : { background: 'transparent', color: '#94a3b8' }}
            >
              Email
            </button>
          </div>

          <AuthError message={error} />

          {authMethod === 'code' && (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-400 mb-2">Company code</label>
                <input
                  type="text"
                  value={companyCode}
                  onChange={(e) => setCompanyCode(e.target.value)}
                  placeholder="e.g. 01"
                  className={authInputClass}
                  style={authInputStyle}
                  {...authInputFocusHandlers()}
                  autoCapitalize="characters"
                  autoComplete="off"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-400 mb-2">Login code</label>
                <input
                  type="password"
                  value={portalCode}
                  onChange={(e) => setPortalCode(e.target.value)}
                  placeholder="Your employee / ID code"
                  className={authInputClass}
                  style={authInputStyle}
                  {...authInputFocusHandlers()}
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>

              <p className="text-[11px] text-slate-500">
                Ask your employer for both codes. Example: Company code 01, Login code = your employee / ID code.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                style={authPrimaryButtonStyle}
              >
                {loading ? 'Signing in...' : 'Sign in with code'}
              </button>
            </form>
          )}

          {authMethod === 'email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-400 mb-2">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={authInputClass}
                  style={authInputStyle}
                  {...authInputFocusHandlers()}
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-400 mb-2">Password</label>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="Your password"
                  className={authInputClass}
                  style={authInputStyle}
                  {...authInputFocusHandlers()}
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>

              <p className="text-[11px] text-slate-500">
                Don&apos;t have a password yet? Use email verification code below, then you&apos;ll create one.
              </p>

              <button
                type="button"
                onClick={() => {
                  if (!email.trim()) {
                    setError('Enter your email address first.')
                    return
                  }
                  router.push(`${AUTH_ROUTES.emailOtp}?email=${encodeURIComponent(email.trim())}`)
                }}
                className="text-[13px] font-semibold text-blue-400 hover:text-blue-300"
              >
                Sign in with email verification code
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!email.trim()) {
                    setError('Enter your email address first.')
                    return
                  }
                  router.push(`${AUTH_ROUTES.forgotPassword}?email=${encodeURIComponent(email.trim())}`)
                }}
                className="block text-[12px] text-blue-400 hover:text-blue-300"
              >
                Forgot password?
              </button>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                style={authPrimaryButtonStyle}
              >
                {loading ? 'Signing in...' : 'Sign in with email'}
              </button>
            </form>
          )}

          <p className="text-center text-[13px] text-slate-500">
            New employee?{' '}
            <Link href={AUTH_ROUTES.selfRegister} className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
              Create account
            </Link>
          </p>
        </div>
      )}
    </AuthShell>
  )
}
