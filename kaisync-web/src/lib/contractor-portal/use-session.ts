'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getContractorPortalSession,
  type ContractorPortalSession,
} from '@/lib/contractor-portal/session'

export function useRequireContractorPortalSession() {
  const router = useRouter()
  const [session, setSession] = useState<ContractorPortalSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const s = getContractorPortalSession()
    if (!s) {
      router.replace('/contractor-portal')
      setReady(true)
      return
    }
    setSession(s)
    setReady(true)
  }, [router])

  return { session, ready, setSession }
}
