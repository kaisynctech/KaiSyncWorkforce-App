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

function LinkCompanyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const firstName = searchParams.get('firstName') ?? ''
  const lastName = searchParams.get('lastName') ?? ''

  const [companyCode, setCompanyCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function link(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (!companyCode.trim()) {
      setError('Enter the company code given to you by your employer.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('Not authenticated. Please verify your email first.')
      }

      const { data, error: rpcError } = await supabase.rpc('employee_self_register', {
        p_user_id: user.id,
        p_email: email.trim().toLowerCase() || (user.email ?? ''),
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_company_code: companyCode.trim().toUpperCase(),
      })

      if (rpcError) throw rpcError

      const row = Array.isArray(data) ? data[0] : data
      if (!row) throw new Error('Registration failed.')

      const status = String(row.status ?? '')
      const companyName = row.company_name ? String(row.company_name) : 'the company'

      if (status === 'pending') {
        setNotice(
          `Your request to join ${companyName} has been sent to HR. You can upload documents for this company while you wait. Check notifications for approval updates.`,
        )
      } else {
        setNotice(
          `You're connected to ${companyName}. Select it from My Companies to continue.`,
        )
      }

      setTimeout(() => {
        router.push(AUTH_ROUTES.companyPicker)
      }, 1200)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not link company.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthBackButton onClick={() => router.push(AUTH_ROUTES.companyPicker)} />
        <div>
          <h1 className="text-[22px] font-bold text-white">Link to Company</h1>
          <p className="text-slate-400 text-[13px]">
            {email ? `Account: ${email}` : 'Enter your employer company code'}
          </p>
        </div>
      </div>

      <AuthError message={error} />
      {notice && (
        <div
          className="p-3 rounded-xl text-[13px] text-green-300"
          style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}
        >
          {notice}
        </div>
      )}

      <form onSubmit={link} className="space-y-4">
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
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40"
          style={authPrimaryButtonStyle}
        >
          {loading ? 'Linking...' : 'Link company'}
        </button>

        <button
          type="button"
          onClick={() => router.push(AUTH_ROUTES.companyPicker)}
          className="w-full text-[13px] text-slate-400"
          disabled={loading}
        >
          Skip for now
        </button>
      </form>
    </div>
  )
}

export default function LinkCompanyPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-slate-400 text-center py-10">Loading…</p>}>
        <LinkCompanyForm />
      </Suspense>
    </AuthShell>
  )
}
