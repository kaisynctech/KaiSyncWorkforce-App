'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ClientPortalShell } from '@/components/ClientPortalShell'
import { ClientPortalDocuments } from '@/components/ClientPortalDocuments'
import { useRequireClientPortalSession } from '@/lib/client-portal/use-session'
import { listInvoices, listJobs, listMessageInbox, listProjects } from '@/lib/client-portal/api'
import { getDealMessagesReadAt } from '@/lib/client-portal/session'
import { fmtDate, fmtDateTime, projectStatusLabel } from '@/lib/client-portal/format'
import { moneyZAR } from '@/lib/client-portal/quotation'
import { isInvoiceOutstanding, type ClientPortalJob, type ClientPortalProject, type MessageInboxItem, type PortalInvoice } from '@/lib/client-portal/types'

type Tab = 'projects' | 'jobs' | 'messages' | 'documents' | 'invoices'

const TAB_TITLES: Record<Tab, string> = {
  projects: 'Projects',
  jobs: 'Jobs',
  messages: 'Messages',
  documents: 'Documents',
  invoices: 'Invoices',
}

function parseTab(raw: string | null): Tab {
  if (raw === 'jobs' || raw === 'messages' || raw === 'documents' || raw === 'invoices' || raw === 'projects') return raw
  return 'projects'
}

export default function ClientPortalHomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background text-text-secondary text-[14px]">
        Loading…
      </div>
    }>
      <ClientPortalHomeInner />
    </Suspense>
  )
}

function ClientPortalHomeInner() {
  const { session, ready } = useRequireClientPortalSession()
  const searchParams = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ClientPortalProject[]>([])
  const [jobs, setJobs] = useState<ClientPortalJob[]>([])
  const [inbox, setInbox] = useState<MessageInboxItem[]>([])
  const [invoices, setInvoices] = useState<PortalInvoice[]>([])

  useEffect(() => {
    if (!session) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function load() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const [p, jobRows, m, inv] = await Promise.all([
        listProjects(session.company_code, session.client_code),
        listJobs(session.company_code, session.client_code),
        listMessageInbox(session.company_code, session.client_code),
        listInvoices(session.company_code, session.client_code),
      ])
      const withUnread = m.map(item => {
        if (!item.last_from_hr || !item.last_message_at) {
          return { ...item, has_unread: false }
        }
        const readAt = getDealMessagesReadAt(item.deal_id)
        const hasUnread = !readAt || new Date(item.last_message_at) > new Date(readAt)
        return { ...item, has_unread: hasUnread }
      })
      setProjects(p)
      setJobs(jobRows)
      setInbox(withUnread)
      setInvoices(inv)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load portal.')
    }
    setLoading(false)
  }

  const unreadCount = useMemo(() => inbox.filter(i => i.has_unread).length, [inbox])
  const outstanding = useMemo(
    () => invoices.filter(i => isInvoiceOutstanding(i.status)).reduce((s, i) => s + i.balance_due, 0),
    [invoices],
  )

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-text-secondary text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <ClientPortalShell session={session}>
      <div className="px-4 py-4 md:px-6 md:py-5 space-y-4">
        <div>
          <h1 className="text-text-primary text-[20px] font-bold">{TAB_TITLES[tab]}</h1>
          <p className="text-text-secondary text-[13px] mt-0.5">
            {session.client_name}
            {tab === 'messages' && unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
          </p>
        </div>

        {error && (
          <div className="bg-error/10 border border-error/25 rounded-xl px-4 py-3">
            <p className="text-[13px] text-error font-semibold">{error}</p>
            <button type="button" onClick={() => void load()} className="text-[12px] text-primary mt-1 hover:underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>
        ) : tab === 'projects' ? (
          <ProjectsTab projects={projects} />
        ) : tab === 'jobs' ? (
          <JobsTab jobs={jobs} />
        ) : tab === 'messages' ? (
          <MessagesTab inbox={inbox} />
        ) : tab === 'documents' ? (
          <ClientPortalDocuments session={session} />
        ) : (
          <InvoicesTab invoices={invoices} outstanding={outstanding} />
        )}
      </div>
    </ClientPortalShell>
  )
}

function ProjectsTab({ projects }: { projects: ClientPortalProject[] }) {
  if (projects.length === 0) {
    return (
      <Empty icon="folder_open" title="No projects yet" sub="Projects shared with you will appear here." />
    )
  }
  return (
    <div className="border-divider bg-surface overflow-x-auto rounded-xl border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-surface-elevated">
            <Th>Code</Th>
            <Th>Project</Th>
            <Th>Status</Th>
            <Th>Progress</Th>
            <Th>Offer</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id} className="border-divider border-t hover:bg-surface-elevated">
              <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{p.project_code || '—'}</td>
              <td className="px-3 py-3">
                <Link href={`/client-portal/projects/${p.id}`} className="text-text-primary font-semibold hover:text-primary">
                  {p.title}
                </Link>
              </td>
              <td className="px-3 py-3 text-text-primary whitespace-nowrap">{projectStatusLabel(p.status)}</td>
              <td className="px-3 py-3 text-text-primary whitespace-nowrap">{p.progress_percent}%</td>
              <td className="px-3 py-3 text-text-primary whitespace-nowrap">{moneyZAR(p.offer_amount)}</td>
              <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{fmtDate(p.last_update_at ?? p.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JobsTab({ jobs }: { jobs: ClientPortalJob[] }) {
  if (jobs.length === 0) {
    return (
      <Empty icon="work_outline" title="No jobs yet" sub="Jobs for you will appear here, including ones that are not on a project." />
    )
  }
  return (
    <div className="border-divider bg-surface overflow-x-auto rounded-xl border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-surface-elevated">
            <Th>Code</Th>
            <Th>Job</Th>
            <Th>Status</Th>
            <Th>Project</Th>
            <Th>Start</Th>
            <Th>End</Th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.id} className="border-divider border-t">
              <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{job.job_code || '—'}</td>
              <td className="px-3 py-3">
                <Link href={`/client-portal/jobs/${job.id}`} className="text-text-primary font-semibold hover:text-primary">
                  {job.title || '—'}
                </Link>
              </td>
              <td className="px-3 py-3 text-text-primary whitespace-nowrap">{projectStatusLabel(job.status)}</td>
              <td className="px-3 py-3 whitespace-nowrap">
                {job.deal_id && job.project_title ? (
                  <Link href={`/client-portal/projects/${job.deal_id}`} className="text-primary hover:text-primary font-semibold">
                    {job.project_title}
                    {job.project_code ? <span className="text-text-secondary font-normal"> · {job.project_code}</span> : null}
                  </Link>
                ) : (
                  <span className="text-text-secondary">—</span>
                )}
              </td>
              <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{fmtDate(job.scheduled_start)}</td>
              <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{fmtDate(job.scheduled_end)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MessagesTab({ inbox }: { inbox: MessageInboxItem[] }) {
  if (inbox.length === 0) {
    return (
      <Empty icon="chat_bubble_outline" title="No conversations" sub="Message threads for your projects will show here." />
    )
  }
  return (
    <div className="border-divider bg-surface divide-y rounded-xl border overflow-hidden">
      {inbox.map(item => (
        <Link
          key={item.deal_id}
          href={`/client-portal/projects/${item.deal_id}?messages=1`}
          className="border-divider flex items-start gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors"
         
        >
          <span className={`material-icons text-[22px] mt-0.5 ${item.has_unread ? 'text-primary' : 'text-text-secondary'}`}>
            {item.has_unread ? 'mark_email_unread' : 'chat'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`text-[14px] truncate ${item.has_unread ? 'text-text-primary font-bold' : 'text-text-primary font-semibold'}`}>
                {item.project_title}
              </p>
              {item.has_unread && (
                <span className="text-[10px] font-bold uppercase text-primary bg-primary/15 px-1.5 py-0.5 rounded">New</span>
              )}
            </div>
            {item.project_code && <p className="text-[11px] text-text-secondary">{item.project_code}</p>}
            <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">{item.last_message_preview || 'No messages yet'}</p>
            <p className="text-[11px] text-text-secondary mt-1">{fmtDateTime(item.last_message_at)}</p>
          </div>
          <span className="material-icons text-text-secondary text-[18px]">chevron_right</span>
        </Link>
      ))}
    </div>
  )
}

function InvoicesTab({ invoices, outstanding }: { invoices: PortalInvoice[]; outstanding: number }) {
  return (
    <div className="space-y-3">
      <div className="bg-primary/10 border border-primary/25 rounded-xl px-4 py-3 flex items-center justify-between">
        <p className="text-[12px] font-semibold text-primary uppercase tracking-wide">Outstanding</p>
        <p className="text-[18px] font-bold text-text-primary">{moneyZAR(outstanding)}</p>
      </div>
      {invoices.length === 0 ? (
        <Empty icon="receipt_long" title="No invoices" sub="Invoices issued to you will appear here." />
      ) : (
        <div className="border-divider bg-surface overflow-x-auto rounded-xl border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-elevated">
                <Th>Number</Th>
                <Th>Status</Th>
                <Th>Total</Th>
                <Th>Balance</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-divider border-t">
                  <td className="px-3 py-3 text-text-primary font-medium whitespace-nowrap">{inv.invoice_number || '—'}</td>
                  <td className="px-3 py-3 text-text-primary capitalize whitespace-nowrap">{inv.status.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-3 text-text-primary whitespace-nowrap">{moneyZAR(inv.total_amount)}</td>
                  <td className={`px-3 py-3 whitespace-nowrap font-semibold ${isInvoiceOutstanding(inv.status) ? 'text-warning' : 'text-text-secondary'}`}>
                    {moneyZAR(inv.balance_due)}
                  </td>
                  <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{fmtDate(inv.issue_date)}</td>
                  <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
      {children}
    </th>
  )
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
      <span className="material-icons text-[48px] text-text-secondary">{icon}</span>
      <p className="text-[15px] font-semibold text-text-primary">{title}</p>
      <p className="text-[13px] text-text-secondary max-w-sm">{sub}</p>
    </div>
  )
}
