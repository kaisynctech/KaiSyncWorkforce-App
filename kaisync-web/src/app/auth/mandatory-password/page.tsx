'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AUTH_ROUTES } from '@/lib/auth/employee-routing'
import { getCurrentJwtEmployee } from '@/lib/auth/session'
import {
  AuthError,
  AuthShell,
  authInputClass,
  authInputFocusHandlers,
  authInputStyle,
  authPrimaryButtonStyle,
} from '@/components/AuthShell'

export default function MandatoryPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
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
      const { error: updateErr } = await supabase.auth.updateUser({ password })
      if (updateErr) throw updateErr

      const current = await getCurrentJwtEmployee(supabase)
      if (current?.id) {
        await supabase
          .from('employees')
          .update({ login_password_ready: true })
          .eq('id', current.id)
      }

      router.push(AUTH_ROUTES.companyPicker)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not set password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-[22px] font-bold text-white">Set Your Password</h1>
          <p className="text-slate-400 text-[13px] mt-1">
            Create a password to sign in with email next time.
          </p>
        </div>

        <AuthError message={error} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-400 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authInputClass}
                style={authInputStyle}
                {...authInputFocusHandlers()}
                disabled={loading}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                aria-label="Toggle password visibility"
              >
                <span className="material-icons text-[20px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-400 mb-2">Confirm password</label>
            <input
              type={showPassword ? 'text' : 'password'}
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
            {loading ? 'Saving...' : 'Set password'}
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
