'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Step = 'role' | 'employee'

export default function IdEntryPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('role')
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
    <div className="min-h-screen w-full flex">
      {/* ── Left panel: brand ── */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #1a1f2e 0%, #0f172a 60%, #1e3a5f 100%)' }}>
        {/* Decorative circles */}
        <div className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-60px] left-[-60px] w-[260px] h-[260px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }} />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
            <span className="material-icons text-white text-[22px]">grid_view</span>
          </div>
          <span className="text-white text-[18px] font-bold tracking-tight">KaiSync Workforce</span>
        </div>

        {/* Tagline */}
        <div className="relative z-10 space-y-6">
          <h2 className="text-white text-[36px] font-bold leading-tight">
            Manage your<br/>
            <span style={{ background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              workforce
            </span>
            <br/>from anywhere.
          </h2>
          <p className="text-slate-400 text-[15px] leading-relaxed max-w-[320px]">
            Attendance, payroll, leave, jobs and compliance — all in one place for your entire team.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 pt-2">
            {['Attendance', 'Payroll', 'Leave', 'Jobs', 'Compliance'].map(f => (
              <span key={f} className="px-3 py-1 rounded-full text-[12px] font-medium text-slate-300"
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-slate-600 text-[12px] relative z-10">
          &copy; {new Date().getFullYear()} KaiSync. All rights reserved.
        </p>
      </div>

      {/* ── Right panel: auth ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a] lg:bg-background">

        {/* Mobile logo */}
        <div className="flex lg:hidden items-center gap-2 mb-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
            <span className="material-icons text-white text-[18px]">grid_view</span>
          </div>
          <span className="text-white text-[16px] font-bold">KaiSync Workforce</span>
        </div>

        <div className="w-full max-w-[400px]">

          {/* ── Step: role picker ── */}
          {step === 'role' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-[26px] font-bold text-white lg:text-text-primary">Welcome back</h1>
                <p className="text-slate-400 lg:text-text-secondary text-[14px] mt-1">Select your portal to continue</p>
              </div>

              {/* Primary portals */}
              <div className="space-y-3">
                <button
                  onClick={() => setStep('employee')}
                  className="w-full group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200 text-left"
                  style={{ backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3b82f6'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(59,130,246,0.15)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(59,130,246,0.25)'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
                >
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                    <span className="material-icons text-white text-[20px]">badge</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white lg:text-text-primary text-[15px] font-semibold">Employee</p>
                    <p className="text-slate-400 lg:text-text-secondary text-[12px] mt-0.5">Sign in with company &amp; portal code</p>
                  </div>
                  <span className="material-icons text-slate-500 group-hover:text-blue-400 transition-colors text-[20px]">arrow_forward_ios</span>
                </button>

                <Link href="/auth/hr-sign-in"
                  className="w-full group relative flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200"
                  style={{ backgroundColor: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#6366f1'; (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(99,102,241,0.15)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(99,102,241,0.25)'; (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(99,102,241,0.08)' }}>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
                    <span className="material-icons text-white text-[20px]">manage_accounts</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white lg:text-text-primary text-[15px] font-semibold">HR / Employer</p>
                    <p className="text-slate-400 lg:text-text-secondary text-[12px] mt-0.5">Sign in with email and password</p>
                  </div>
                  <span className="material-icons text-slate-500 group-hover:text-indigo-400 transition-colors text-[20px]">arrow_forward_ios</span>
                </Link>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
                <span className="text-slate-500 text-[12px]">Other portals</span>
                <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              </div>

              {/* Secondary portals */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: 'work_outline', label: 'Job Portal', sub: 'Guest', href: '/jobs' },
                  { icon: 'handshake', label: 'Client', sub: 'Portal', href: '/client-portal' },
                  { icon: 'engineering', label: 'Contractor', sub: 'Portal', href: '/contractor-portal' },
                ].map(p => (
                  <Link key={p.label} href={p.href}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 text-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.18)'; (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.08)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.04)' }}>
                    <span className="material-icons text-slate-400 text-[22px]">{p.icon}</span>
                    <div>
                      <p className="text-slate-300 text-[11px] font-medium">{p.label}</p>
                      <p className="text-slate-500 text-[10px]">{p.sub}</p>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Register */}
              <p className="text-center text-[13px] text-slate-500">
                New company?{' '}
                <Link href="/auth/hr-register" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
                  Register here
                </Link>
              </p>
            </div>
          )}

          {/* ── Step: employee code entry ── */}
          {step === 'employee' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setStep('role'); setError(null) }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.12)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}>
                  <span className="material-icons text-slate-400 text-[18px]">arrow_back</span>
                </button>
                <div>
                  <h1 className="text-[22px] font-bold text-white lg:text-text-primary">Employee sign in</h1>
                  <p className="text-slate-400 text-[13px]">Enter your company and portal codes</p>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl flex items-center gap-2"
                  style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <span className="material-icons text-red-400 text-[18px]">error_outline</span>
                  <p className="text-[13px] text-red-400">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-medium text-slate-400 mb-2">Company Code</label>
                  <input
                    type="text"
                    value={companyCode}
                    onChange={e => setCompanyCode(e.target.value)}
                    placeholder="e.g. KAI-001"
                    className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
                    onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-slate-400 mb-2">Portal Code</label>
                  <input
                    type="password"
                    value={portalCode}
                    onChange={e => setPortalCode(e.target.value)}
                    placeholder="Enter your portal code"
                    className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
                    onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                    autoComplete="current-password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !companyCode.trim() || !portalCode.trim()}
                  className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                  {loading ? 'Signing in...' : 'Continue'}
                </button>
              </form>

              <p className="text-center text-[13px] text-slate-500">
                HR / Manager?{' '}
                <Link href="/auth/hr-sign-in" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
                  Sign in with email
                </Link>
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
