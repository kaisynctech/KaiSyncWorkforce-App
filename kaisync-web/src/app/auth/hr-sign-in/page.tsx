'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function HrSignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
      router.push('/dashboard/overview')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="material-icons text-white text-3xl">manage_accounts</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">HR Sign In</h1>
          <p className="text-[13px] text-text-secondary mt-1">Sign in with your email address</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-dark rounded-md flex items-center gap-2">
            <span className="material-icons text-error text-[18px]">error_outline</span>
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12px] font-medium text-text-secondary">Password</label>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-divider text-center">
          <p className="text-[12px] text-text-secondary">
            Employee / Contractor?{' '}
            <Link href="/auth/id-entry" className="text-primary font-medium hover:underline">
              Use portal code
            </Link>
          </p>
          <p className="text-[12px] text-text-secondary mt-2">
            New to KaiSync?{' '}
            <Link href="/auth/hr-register" className="text-primary font-medium hover:underline">
              Register your company
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
