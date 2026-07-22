'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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

export default function EmployeeRegisterPage() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.')
      return
    }
    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const normalizedEmail = email.trim().toLowerCase()

      // Mirror SendHrRegistrationOtpAsync: SignUp → OTP; else SignIn → skip verify
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      })

      if (!signUpErr) {
        // New/unconfirmed — verify OTP then link company
        const params = new URLSearchParams({
          email: normalizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password,
        })
        // If session already returned (email confirm disabled), go straight to link
        if (signUpData.session) {
          router.push(`${AUTH_ROUTES.linkCompany}?${new URLSearchParams({
            email: normalizedEmail,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
          }).toString()}`)
          return
        }
        router.push(`${AUTH_ROUTES.registerVerify}?${params.toString()}`)
        return
      }

      // Email already exists — try sign in
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })
      if (signInErr) {
        throw new Error(
          'This email is already registered. Sign in with your password, or use Forgot Password if you need to reset it.',
        )
      }

      router.push(`${AUTH_ROUTES.linkCompany}?${new URLSearchParams({
        email: normalizedEmail,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      }).toString()}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <AuthBackButton onClick={() => router.push(AUTH_ROUTES.idEntry)} />
          <div>
            <h1 className="text-[22px] font-bold text-white">Create Account</h1>
            <p className="text-slate-400 text-[13px]">Register as an employee</p>
          </div>
        </div>

        <AuthError message={error} />

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-slate-400 mb-2">First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={authInputClass}
                style={authInputStyle}
                {...authInputFocusHandlers()}
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-400 mb-2">Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={authInputClass}
                style={authInputStyle}
                {...authInputFocusHandlers()}
                disabled={loading}
              />
            </div>
          </div>

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
            <label className="block text-[12px] font-medium text-slate-400 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
              style={authInputStyle}
              {...authInputFocusHandlers()}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-400 mb-2">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={authInputClass}
              style={authInputStyle}
              {...authInputFocusHandlers()}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40"
            style={authPrimaryButtonStyle}
          >
            {loading ? 'Creating...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-[13px] text-slate-500">
          Already have an account?{' '}
          <Link href={AUTH_ROUTES.idEntry} className="text-blue-400 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
