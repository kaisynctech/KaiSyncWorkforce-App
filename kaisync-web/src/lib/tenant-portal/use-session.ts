'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getTenantPortalSession,
  type TenantPortalSession,
} from '@/lib/tenant-portal/session'

export function useRequireTenantPortalSession() {
  const router = useRouter()
  const [session, setSession] = useState<TenantPortalSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const s = getTenantPortalSession()
    if (!s) {
      router.replace('/tenant-portal')
      setReady(true)
      return
    }
    setSession(s)
    setReady(true)
  }, [router])

  return { session, ready }
}
