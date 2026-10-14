'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { openJobTeamThread } from '@/lib/jobs'

export default function JobChatPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const jobId = params.id
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) {
        if (!cancelled) setError('Your account is not linked to an employee record.')
        return
      }
      const result = await openJobTeamThread(supabase, { companyId: member.companyId, jobId })
      if (cancelled) return
      if (!result.ok) {
        setError(result.message)
        return
      }
      router.replace(`/dashboard/messages?threadId=${result.data}&jobId=${jobId}`)
    })()
    return () => { cancelled = true }
  }, [jobId, router])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-divider">
        <Link href={`/dashboard/jobs/${jobId}`} aria-label="Back to job" className="inline-flex text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-[13px] text-text-secondary">{error || 'Opening job chat…'}</p>
      </div>
    </div>
  )
}
