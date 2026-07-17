'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function HrSignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <div className="min-h-screen w-full flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #1a1f2e 0%, #0f172a 60%, #1e3a5f 100%)' }}>
        <div className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-60px] left-[-60px] w-[260px] h-[260px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }} />

        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
            <span className="material-icons text-white text-[22px]">grid_view</span>
          </div>
          <span className="text-white text-[18px] font-bold tracking-tight">KaiSync Workforce</span>
        </div>

        <div className="relative z-10 space-y-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
            <span className="material-icons text-white text-[28px]">manage_accounts</span>
          </div>
          <h2 className="text-white text-[32px] font-bold leading-tight">
            HR &amp; Employer<br/>
            <span style={{ background: 'linear-gradient(90deg, #a78bfa, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Dashboard
            </span>
          </h2>
          <p className="text-slate-400 text-[15px] leading-relaxed max-w-[300px]">
            Full access to workforce management, payroll, compliance and reporting.
          </p>
        </div>

        <p className="text-slate-600 text-[12px] relative z-10">
          &copy; {new Date().getFullYear()} KaiSync. All rights reserved.
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a]">
        <div className="lg:hidden flex items-center gap-2 mb-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
            <span className="material-icons text-white text-[18px]">grid_view</span>
          </div>
          <span className="text-white text-[16px] font-bold">KaiSync Workforce</span>
        </div>

        <div className="w-full max-w-[400px] space-y-6">
          <div className="flex items-center gap-3">
            <Link href="/auth/id-entry"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.12)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}>
              <span className="material-icons text-slate-400 text-[18px]">arrow_back</span>
            </Link>
            <div>
              <h1 className="text-[22px] font-bold text-white lg:text-text-primary">HR Sign In</h1>
              <p className="text-slate-400 text-[13px]">Sign in with your work email</p>
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
              <label className="block text-[12px] font-medium text-slate-400 mb-2">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
                style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#6366f1'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(99,102,241,0.08)' }}
                onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-slate-400 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full h-12 px-4 pr-12 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
                  style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#6366f1'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(99,102,241,0.08)' }}
                  onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  <span className="material-icons text-[20px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="space-y-2 pt-2">
            <p className="text-center text-[13px] text-slate-500">
              Employee?{' '}
              <Link href="/auth/id-entry" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
                Use portal code
              </Link>
            </p>
            <p className="text-center text-[13px] text-slate-500">
              New to KaiSync?{' '}
              <Link href="/auth/hr-register" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
                Register your company
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
