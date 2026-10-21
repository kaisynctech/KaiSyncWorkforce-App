'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getJobMessages } from '@/lib/contractor-portal/api'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import type { ContractorJob, JobMessage } from '@/lib/contractor-portal/types'

type Conversation = { job: ContractorJob; last: JobMessage | null; count: number }

function fmtDT(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** One conversation per assigned job; opens the job's message section. */
export function ContractorPortalMessagesTab({
  session,
  jobs,
}: {
  session: ContractorPortalSession
  jobs: ContractorJob[]
}) {
  const [items, setItems] = useState<Conversation[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const list = jobs.slice(0, 40)
    Promise.all(list.map(async job => {
      const msgs = await getJobMessages(session.company_code, session.contractor_code, job.id).catch(() => [] as JobMessage[])
      return { job, last: msgs.length ? msgs[msgs.length - 1] : null, count: msgs.length }
    })).then(res => {
      if (cancelled) return
      res.sort((a, b) => (b.last?.created_at ?? '').localeCompare(a.last?.created_at ?? ''))
      setItems(res)
    })
    return () => { cancelled = true }
  }, [jobs, session.company_code, session.contractor_code])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-text-primary text-[18px] font-bold">Messages</h2>
        <p className="text-[12px] text-text-secondary mt-0.5">Your conversations with the team, one per job.</p>
      </div>
      {items === null ? (
        <div className="py-16 text-center text-text-secondary text-[13px]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-text-secondary text-[13px]">No jobs yet. Messages appear here once you are assigned a job.</div>
      ) : (
        <div className="space-y-2">
          {items.map(({ job, last, count }) => (
            <Link
              key={job.id}
              href={`/contractor-portal/jobs/${job.id}#messages`}
              className="block border-divider bg-surface rounded-xl border px-4 py-3 hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-text-primary truncate">
                    {job.job_code ? `${job.job_code} · ${job.title}` : job.title}
                  </p>
                  <p className="text-[12px] text-text-secondary mt-0.5 truncate">
                    {last
                      ? `${last.is_contractor ? 'You' : (last.sender_display_name || 'Manager')}: ${last.body}`
                      : 'No messages yet — tap to start'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {last && <p className="text-[11px] text-text-secondary">{fmtDT(last.created_at)}</p>}
                  {count > 0 && (
                    <span className="bg-surface-elevated inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded">{count}</span>
                  )}
                  {last && !last.is_contractor && (
                    <span className="block mt-1 text-[10px] font-semibold text-primary">From the team</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
