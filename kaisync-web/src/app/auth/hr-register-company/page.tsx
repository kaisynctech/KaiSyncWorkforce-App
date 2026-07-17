'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'form' | 'success'

export default function HrRegisterCompanyPage() {
  const router = useRouter()
  const [step, setStep]               = useState<Step>('form')
  const [companyName, setCompanyName] = useState('')
  const [firstName, setFirstName]     = useState('')
  const [lastName, setLastName]       = useState('')
  const [role, setRole]               = useState<'owner' | 'hr_admin'>('owner')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Success state
  const [returnedCompanyName, setReturnedCompanyName] = useState('')
  const [companyCode, setCompanyCode]                 = useState('')
  const [copied, setCopied]                           = useState(false)

  // Pre-populate name from step 1 user_metadata
  useEffect(() => {
    async function prefill() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const fullName = (user.user_metadata?.full_name as string | undefined) ?? ''
      const parts = fullName.trim().split(' ')
      setFirstName(parts[0] ?? '')
      setLastName(parts.slice(1).join(' '))
    }
    prefill()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyName.trim()) {
      setError('Company name is required.')
      return
    }
    if (!firstName.trim()) {
      setError('Your first name is required.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated. Please verify your email first.')

      const { data, error: rpcError } = await supabase.rpc('self_register_company', {
        p_company_name:     companyName.trim(),
        p_owner_first_name: firstName.trim(),
        p_owner_last_name:  lastName.trim(),
        p_role:             role,
      })
      if (rpcError) throw rpcError
      if (!data || !data[0]) throw new Error('Company creation failed — no data returned.')

      setReturnedCompanyName(companyName.trim())
      setCompanyCode(data[0].company_code)
      setStep('success')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(companyCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: browser may not support clipboard API
    }
  }

  // ── Success screen ──
  if (step === 'success') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider text-center">
          <div className="w-16 h-16 rounded-full bg-success-dark flex items-center justify-center mx-auto mb-5">
            <span className="material-icons text-success text-3xl">check_circle</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary mb-1">Welcome to KaiSync!</h1>
          <p className="text-[14px] text-text-secondary mb-6">{returnedCompanyName} is ready.</p>

          <div className="bg-background rounded-xl p-4 mb-6">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">
              Your Company Code
            </p>
            <p className="text-[32px] font-bold text-text-primary tracking-widest mb-3">
              {companyCode}
            </p>
            <p className="text-[12px] text-text-secondary mb-3">
              Share this code with your employees so they can sign in.
            </p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-primary/10 text-primary text-[13px] font-medium hover:bg-primary/20 transition-colors"
            >
              <span className="material-icons text-[16px]">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Copied!' : 'Copy code'}
            </button>
          </div>

          <button
            onClick={() => { router.push('/dashboard/overview'); router.refresh() }}
            className="w-full h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Form screen ──
  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="material-icons text-white text-3xl">domain_add</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">Set up your company</h1>
          <p className="text-[13px] text-text-secondary mt-1">Step 2 of 2 — Company details</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-dark rounded-md flex items-center gap-2">
            <span className="material-icons text-error text-[18px]">error_outline</span>
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Company name */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Company name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* First name */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Your first name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Jane"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Last name */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Your last name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Smith"
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Role toggle */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-2">
              Your role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([['owner', 'Owner'], ['hr_admin', 'HR Admin']] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setRole(val)}
                  className="h-10 rounded-md border text-[13px] font-medium transition-colors"
                  style={role === val
                    ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' }
                    : { backgroundColor: 'transparent', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !companyName.trim() || !firstName.trim()}
            className="h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
          >
            {loading ? 'Creating company…' : 'Create Company'}
          </button>
        </form>
      </div>
    </div>
  )
}
