'use client'

import type { FocusEvent, ReactNode } from 'react'

/** Shared dark auth chrome matching MAUI BackgroundDark auth screens. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex">
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #1a1f2e 0%, #0f172a 60%, #1e3a5f 100%)' }}
      >
        <div
          className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-[-60px] left-[-60px] w-[260px] h-[260px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }}
        />

        <div className="flex items-center gap-3 relative z-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            <span className="material-icons text-white text-[22px]">grid_view</span>
          </div>
          <span className="text-white text-[18px] font-bold tracking-tight">KaiSync Workforce</span>
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-white text-[36px] font-bold leading-tight">
            Manage your<br />
            <span
              style={{
                background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              workforce
            </span>
            <br />from anywhere.
          </h2>
          <p className="text-slate-400 text-[15px] leading-relaxed max-w-[320px]">
            Attendance, payroll, leave, jobs and compliance — all in one place for your entire team.
          </p>
        </div>

        <p className="text-slate-600 text-[12px] relative z-10">
          &copy; {new Date().getFullYear()} KaiSync. All rights reserved.
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a]">
        <div className="flex lg:hidden items-center gap-2 mb-10">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            <span className="material-icons text-white text-[18px]">grid_view</span>
          </div>
          <span className="text-white text-[16px] font-bold">KaiSync Workforce</span>
        </div>

        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  )
}

export function AuthBackButton({ onClick, href }: { onClick?: () => void; href?: string }) {
  const className =
    'w-8 h-8 rounded-lg flex items-center justify-center transition-colors'
  const style = { backgroundColor: 'rgba(255,255,255,0.06)' }

  if (href) {
    return (
      <a href={href} className={className} style={style}>
        <span className="material-icons text-slate-400 text-[18px]">arrow_back</span>
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} className={className} style={style}>
      <span className="material-icons text-slate-400 text-[18px]">arrow_back</span>
    </button>
  )
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      className="p-3 rounded-xl flex items-center gap-2"
      style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
    >
      <span className="material-icons text-red-400 text-[18px]">error_outline</span>
      <p className="text-[13px] text-red-400">{message}</p>
    </div>
  )
}

export const authInputClass =
  'w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all'

export const authInputStyle = {
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
} as const

export function authInputFocusHandlers() {
  return {
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      e.target.style.borderColor = '#3b82f6'
      e.target.style.backgroundColor = 'rgba(59,130,246,0.08)'
    },
    onBlur: (e: FocusEvent<HTMLInputElement>) => {
      e.target.style.borderColor = 'rgba(255,255,255,0.1)'
      e.target.style.backgroundColor = 'rgba(255,255,255,0.06)'
    },
  }
}

export const authPrimaryButtonStyle = {
  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
} as const
