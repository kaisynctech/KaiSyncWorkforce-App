'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AuthBackButton,
  AuthError,
  AuthShell,
  authInputClass,
  authInputFocusHandlers,
  authInputStyle,
  authPrimaryButtonStyle,
} from '@/components/AuthShell'
import { resolveResidentByCode } from '@/lib/tenant-portal/api'
import {
  consumeSkipAutoRestore,
  getTenantPortalSession,
  saveTenantPortalSession,
} from '@/lib/tenant-portal/session'

export default function TenantPortalLoginPage() {
  const router = useRouter()
  const [companyCode, setCompanyCode] = useState('')
  const [residentCode, setResidentCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (consumeSkipAutoRestore()) {
      setChecking(false)
      return
    }
    if (getTenantPortalSession()) {
      router.replace('/tenant-portal/home')
      return
    }
    setChecking(false)
  }, [router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!companyCode.trim() || !residentCode.trim()) {
      setError('Enter both company code and tenant code.')
      return
    }
    setLoading(true)
    try {
      const login = await resolveResidentByCode(companyCode, residentCode)
      if (!login) {
        setError('Check your company code and tenant code, then try again.')
        setLoading(false)
        return
      }
      saveTenantPortalSession({
        resident_id: login.resident_id,
        company_id: login.company_id,
        resident_name: login.resident_name,
        company_code: login.company_code,
        resident_code: login.resident_code,
        email: login.email,
        phone: login.phone,
      })
      router.replace('/tenant-portal/home')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <AuthBackButton href="/auth/id-entry" />
          <div>
            <h1 className="text-white text-[24px] font-bold">Tenant portal</h1>
            <p className="text-slate-400 text-[13px] mt-0.5">Sign in with your company and tenant codes</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Company code</label>
            <input
              className={authInputClass}
              style={authInputStyle}
              {...authInputFocusHandlers()}
              value={companyCode}
              onChange={e => setCompanyCode(e.target.value.toUpperCase())}
              placeholder="e.g. 28"
              autoComplete="organization"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tenant code</label>
            <input
              className={authInputClass}
              style={authInputStyle}
              {...authInputFocusHandlers()}
              value={residentCode}
              onChange={e => setResidentCode(e.target.value.toUpperCase())}
              placeholder="From your property manager"
              autoComplete="username"
            />
          </div>
          {error && <AuthError message={error} />}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-50"
            style={authPrimaryButtonStyle}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-[12px] text-slate-500">
          Not a tenant?{' '}
          <Link href="/auth/id-entry" className="text-blue-400 hover:text-blue-300">
            Back to portals
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
