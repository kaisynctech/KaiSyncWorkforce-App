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
import { resolveContractorByCode } from '@/lib/contractor-portal/api'
import {
  consumeContractorSkipAutoRestore,
  getContractorPortalSession,
  saveContractorPortalSession,
} from '@/lib/contractor-portal/session'

export default function ContractorPortalLoginPage() {
  const router = useRouter()
  const [companyCode, setCompanyCode] = useState('')
  const [contractorCode, setContractorCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (consumeContractorSkipAutoRestore()) {
      setChecking(false)
      return
    }
    if (getContractorPortalSession()) {
      router.replace('/contractor-portal/home')
      return
    }
    setChecking(false)
  }, [router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!companyCode.trim() || !contractorCode.trim()) {
      setError('Enter both company code and contractor code.')
      return
    }
    setLoading(true)
    try {
      const login = await resolveContractorByCode(companyCode, contractorCode)
      if (!login) {
        setError('Check your company code and contractor code, then try again.')
        setLoading(false)
        return
      }
      saveContractorPortalSession({
        contractor_id: login.contractor_id,
        company_id: login.company_id,
        contractor_name: login.contractor_name,
        company_code: login.company_code,
        contractor_code: login.contractor_code,
      })
      router.replace('/contractor-portal/home')
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
            <h1 className="text-white text-[24px] font-bold">Contractor portal</h1>
            <p className="text-slate-400 text-[13px] mt-0.5">Sign in with your company and contractor codes</p>
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
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Contractor code</label>
            <input
              className={authInputClass}
              style={authInputStyle}
              {...authInputFocusHandlers()}
              value={contractorCode}
              onChange={e => setContractorCode(e.target.value.toUpperCase())}
              placeholder="e.g. CT280001"
              autoComplete="username"
            />
          </div>

          <AuthError message={error} />

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl text-white font-bold text-[15px] disabled:opacity-60 transition-opacity"
            style={authPrimaryButtonStyle}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-[12px] text-slate-500 text-center">
          Codes are issued by your contracting company.{' '}
          <Link href="/auth/id-entry" className="text-blue-400 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </AuthShell>
  )
}
