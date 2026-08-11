'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { QuoteBuilder } from '../_builder'

export default function NewQuotePage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [error,     setError]     = useState(false)

  useEffect(() => {
    async function resolve() {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (member) {
        setCompanyId(member.companyId)
      } else {
        setError(true)
      }
    }
    resolve()
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-secondary text-sm">Unable to resolve company. Please sign in again.</p>
      </div>
    )
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-secondary text-sm">Loading…</p>
      </div>
    )
  }

  return <QuoteBuilder quoteId={null} companyId={companyId} />
}
