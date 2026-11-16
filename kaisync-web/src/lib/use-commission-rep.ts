'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCodeSession } from '@/lib/auth/code-session'
import { isCommissionRep } from '@/lib/commission'

/** True when this person sells on commission: shows "My commission" in their menu. Checked once per person. */
export function useIsCommissionRep(companyId: string | null | undefined, employeeId: string | null | undefined): boolean {
  const [rep, setRep] = useState<{ key: string; yes: boolean } | null>(null)
  const key = companyId && employeeId ? `${companyId}:${employeeId}` : ''
  useEffect(() => {
    if (!companyId || !employeeId) return
    let live = true
    void isCommissionRep(createClient(), { companyId, employeeId, sessionToken: getCodeSession()?.session_token ?? null })
      .then(yes => { if (live) setRep({ key: `${companyId}:${employeeId}`, yes }) })
    return () => { live = false }
  }, [companyId, employeeId])
  return !!key && rep?.key === key && rep.yes
}
