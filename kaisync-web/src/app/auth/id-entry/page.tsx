'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function IdEntryPage() {
  const router = useRouter()
  const [companyCode, setCompanyCode] = useState('')
  const [portalCode, setPortalCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyCode.trim() || !portalCode.trim()) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('authenticate_portal_code', {
        p_company_code: companyCode.trim().toUpperCase(),
        p_portal_code: portalCode.trim(),
      })
      if (rpcError) throw rpcError
      if (!data) throw new Error('Invalid credentials')
      router.push('/dashboard/overview')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid company or portal code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="material-icons text-white text-3xl">business</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">Welcome back</h1>
          <p className="text-[13px] text-text-secondary mt-1 text-center">
            Enter your company and portal codes to continue
          </p>
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
              Company Code
            </label>
            <input
              type="text"
              value={companyCode}
              onChange={e => setCompanyCode(e.target.value)}
              placeholder="e.g. KAI-001"
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Portal Code
            </label>
            <input
              type="password"
              value={portalCode}
              onChange={e => setPortalCode(e.target.value)}
              placeholder="Enter your portal code"
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !companyCode.trim() || !portalCode.trim()}
            className="h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-divider">
          <p className="text-[12px] text-text-secondary text-center">
            HR / Manager?{' '}
            <Link href="/auth/hr-sign-in" className="text-primary font-medium hover:underline">
              Sign in with email
            </Link>
          </p>
          <p className="text-[12px] text-text-secondary text-center mt-2">
            New company?{' '}
            <Link href="/auth/hr-register" className="text-primary font-medium hover:underline">
              Register here
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
