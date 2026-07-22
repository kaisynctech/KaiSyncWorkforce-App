'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getClientPortalSession,
  type ClientPortalSession,
} from '@/lib/client-portal/session'

/** Redirect to login when no client portal session. */
export function useRequireClientPortalSession() {
  const router = useRouter()
  const [session, setSession] = useState<ClientPortalSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const s = getClientPortalSession()
    if (!s) {
      router.replace('/client-portal')
      setReady(true)
      return
    }
    setSession(s)
    setReady(true)
  }, [router])

  return { session, ready }
}
