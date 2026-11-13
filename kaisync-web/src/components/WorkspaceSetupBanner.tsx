'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { isHrOrAbove } from '@/lib/employee-taxonomy'

/**
 * Board L: companies that were made before "What does your business do?" get one gentle prompt (owner, admin, HR).
 * Gone once the business types are saved; "Not now" hides it on this device for 14 days.
 */
const KEY = 'ks_workspace_setup_snooze'

export function WorkspaceSetupBanner() {
  const [show, setShow] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) return
      try {
        const until = Number(localStorage.getItem(`${KEY}:${member.companyId}`) ?? 0)
        if (until > Date.now()) return
      } catch { /* storage unavailable: just show it */ }
      const [{ data: role }, { data: c }] = await Promise.all([
        supabase.rpc('get_my_role', { p_company_id: member.companyId }),
        supabase.from('companies').select('workspace_setup_at').eq('id', member.companyId).maybeSingle(),
      ])
      if (!live || !isHrOrAbove(role as string | null)) return
      if ((c as { workspace_setup_at?: string | null } | null)?.workspace_setup_at) return
      setCompanyId(member.companyId)
      setShow(true)
    })().catch(() => {})
    return () => { live = false }
  }, [])

  if (!show) return null
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <span className="material-icons text-primary text-[22px] mt-0.5">tune</span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-text-primary">Set up your workspace</p>
          <p className="text-[12.5px] text-text-secondary">Tell us what your business does and your quotations will fit your work. Takes a minute.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Link href="/dashboard/settings?tab=money&setup=1" prefetch={false} className="btn-primary h-10 px-4 text-[13px] inline-flex items-center flex-1 sm:flex-none justify-center">Set up</Link>
        <button type="button" className="btn-outlined h-10 px-4 text-[13px]" onClick={() => {
          try { if (companyId) localStorage.setItem(`${KEY}:${companyId}`, String(Date.now() + 14 * 86400_000)) } catch { /* ignore */ }
          setShow(false)
        }}>Not now</button>
      </div>
    </div>
  )
}
