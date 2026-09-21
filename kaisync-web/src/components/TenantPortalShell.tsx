'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { signOutTenantPortal, type TenantPortalSession } from '@/lib/tenant-portal/session'

export function TenantPortalShell({
  session,
  children,
}: {
  session: TenantPortalSession
  children: ReactNode
}) {
  const router = useRouter()

  function signOut() {
    signOutTenantPortal()
    router.replace('/tenant-portal')
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0f172a]">
      <header
        className="shrink-0 border-b px-4 py-3 flex items-center justify-between gap-3"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(15,23,42,0.95)' }}
      >
        <div className="min-w-0">
          <Link href="/tenant-portal/home" className="text-white text-[16px] font-bold truncate block hover:text-blue-300">
            {session.resident_name || 'Tenant Portal'}
          </Link>
          <p className="text-[11px] text-slate-500 truncate">
            Company {session.company_code} · Tenant {session.resident_code}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/auth/id-entry"
            className="text-[12px] font-semibold text-slate-400 hover:text-white px-2 py-1.5 rounded-lg transition-colors"
          >
            Main menu
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="text-[12px] font-semibold text-slate-300 border px-3 py-1.5 rounded-lg hover:border-red-400 hover:text-red-300 transition-colors"
            style={{ borderColor: 'rgba(255,255,255,0.12)' }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
