'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ClientPortalShell } from '@/components/ClientPortalShell'
import { ClientPortalDocuments } from '@/components/ClientPortalDocuments'
import { ClientPortalInformation } from '@/components/ClientPortalInformation'
import { ClientPortalStatement } from '@/components/ClientPortalStatement'
import { ClientPortalBanking } from '@/components/ClientPortalBanking'
import { ClientPortalCompliance } from '@/components/ClientPortalCompliance'
import { PortalComplianceReminder } from '@/components/PortalComplianceReminder'
import { LinkedPaymentProof } from '@/components/LinkedPaymentProof'
import { usePortalCanAct, usePortalHref, usePortalMode, usePortalSession } from '@/lib/client-portal/portal-mode'
import { getInvoiceForPdf, getPartyComplianceDocuments, listDocumentRequests, listInvoices, listJobs, listMessageInbox, listProjects } from '@/lib/client-portal/api'
import { getDealMessagesReadAt, type ClientPortalSession } from '@/lib/client-portal/session'
import { fmtDate, fmtDateTime, projectStatusLabel } from '@/lib/client-portal/format'
import { moneyZAR } from '@/lib/client-portal/quotation'
import { isInvoiceOutstanding, type ClientDocumentRequest, type ClientPortalJob, type ClientPortalProject, type MessageInboxItem, type PortalInvoice } from '@/lib/client-portal/types'
import { localISODate } from '@/lib/utils'
import { ResponsiveDataView } from '@/components/ui/ResponsiveDataView'
import { MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab, TAB_ALL } from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter,
  MoneyHeaderFilter,
  matchText,
  matchMoney,
  statusTab,
} from '@/components/ui/MoneyListFilters'
import {
  PortalEmpty,
  PortalHero,
  PortalKpi,
  PortalPage,
  PortalPanel,
  PortalQuickNav,
  PortalSection,
} from '@/components/portal/PortalChrome'
import { PortalListPager, PortalListToolbar, usePortalListPaging } from '@/components/portal/PortalListChrome'

const JOB_STATUS_TABS = [
  TAB_ALL,
  statusTab('open', 'Open', ['open'], 'blue'),
  statusTab('scheduled', 'Scheduled', ['scheduled'], 'amber'),
  statusTab('in_progress', 'In progress', ['in_progress'], 'green'),
  statusTab('completed', 'Completed', ['completed', 'closed', 'invoiced'], 'slate'),
  statusTab('cancelled', 'Cancelled', ['cancelled', 'canceled'], 'red'),
]

const PROJECT_STATUS_TABS = [
  TAB_ALL,
  statusTab('open', 'Open', ['open', 'active', 'in_progress', 'quoted', 'sent', 'negotiation'], 'blue'),
  statusTab('completed', 'Completed', ['completed', 'closed', 'archived'], 'slate'),
  statusTab('lost', 'Lost / cancelled', ['lost', 'cancelled', 'canceled'], 'red'),
]

const INVOICE_STATUS_TABS = [
  TAB_ALL,
  statusTab('outstanding', 'Outstanding', ['sent', 'partially_paid', 'overdue', 'viewed'], 'amber'),
  statusTab('paid', 'Paid', ['paid'], 'green'),
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('void', 'Void', ['void', 'cancelled', 'canceled', 'written_off'], 'red'),
]

type Tab = 'home' | 'information' | 'projects' | 'jobs' | 'quotes' | 'payments' | 'banking' | 'messages' | 'documents' | 'invoices'

const TAB_TITLES: Record<Tab, string> = {
  home: 'Home',
  information: 'My information',
  projects: 'Projects',
  jobs: 'Jobs',
  messages: 'Messages',
  documents: 'Compliance & documents',
  invoices: 'Quotes & Invoices',
  quotes: 'Quotes & Invoices',
  payments: 'Payments & statement',
  banking: 'Banking (refunds)',
}

function parseTab(raw: string | null): Tab {
  if (raw && raw in TAB_TITLES) return raw as Tab
  return 'home'
}

export function ClientPortalHomeView() {
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
  const { session, ready } = usePortalSession()
  const searchParams = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ClientPortalProject[]>([])
  const [jobs, setJobs] = useState<ClientPortalJob[]>([])
  const [inbox, setInbox] = useState<MessageInboxItem[]>([])
  const [invoices, setInvoices] = useState<PortalInvoice[]>([])
  const [docRequests, setDocRequests] = useState<ClientDocumentRequest[]>([])

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
      const [p, jobRows, m, inv, reqs] = await Promise.all([
        listProjects(session.company_code, session.client_code),
        listJobs(session.company_code, session.client_code),
        listMessageInbox(session.company_code, session.client_code),
        listInvoices(session.company_code, session.client_code),
        listDocumentRequests(session.company_code, session.client_code).catch(() => [] as ClientDocumentRequest[]),
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
      setDocRequests(reqs)
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
      <PortalPage>
        {tab !== 'home' && (
          <div>
            <h1 className="text-text-primary text-[18px] font-bold tracking-tight">{TAB_TITLES[tab]}</h1>
            <p className="text-text-secondary text-[13px] mt-0.5">
              {session.client_name}
              {tab === 'messages' && unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
            </p>
          </div>
        )}

        {error && (
          <div className="bg-error/10 border border-error/25 rounded-xl px-4 py-3">
            <p className="text-[13px] text-error font-semibold">{error}</p>
            <button type="button" onClick={() => void load()} className="text-[12px] text-primary mt-1 hover:underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>
        ) : tab === 'home' ? (
          <HomeTab
            name={session.client_name}
            projects={projects}
            jobs={jobs}
            invoices={invoices}
            outstanding={outstanding}
            unreadCount={unreadCount}
            docRequests={docRequests}
            session={session}
          />
        ) : tab === 'information' ? (
          <ClientPortalInformation session={session} />
        ) : tab === 'projects' ? (
          <ProjectsTab projects={projects} />
        ) : tab === 'jobs' ? (
          <JobsTab jobs={jobs} />
        ) : tab === 'messages' ? (
          <MessagesTab inbox={inbox} />
        ) : tab === 'documents' ? (
          <div className="space-y-4">
            <ClientPortalCompliance session={session} />
            <ClientPortalDocuments session={session} />
          </div>
        ) : tab === 'banking' ? (
          <ClientPortalBanking session={session} />
        ) : tab === 'payments' ? (
          <ClientPortalStatement session={session} />
        ) : (
          <QuotesInvoicesTab
            session={session}
            projects={projects}
            invoices={invoices}
            outstanding={outstanding}
            initial={tab === 'invoices' || searchParams.get('section') === 'invoices' ? 'invoices' : 'quotes'}
          />
        )}
      </PortalPage>
    </ClientPortalShell>
  )
}

function ProjectsTab({ projects }: { projects: ClientPortalProject[] }) {
  const ph = usePortalHref()
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState({ code: '', title: '', offerMin: '', offerMax: '' })

  const normalized = useMemo(
    () => projects.map(p => ({ ...p, status: (p.status ?? '').toLowerCase() })),
    [projects],
  )
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return normalized.filter(p => {
      if (!matchText(p.project_code, cols.code)) return false
      if (!matchText(p.title, cols.title)) return false
      if (!matchMoney(p.offer_amount, cols.offerMin, cols.offerMax)) return false
      if (!q) return true
      return (p.project_code ?? '').toLowerCase().includes(q)
        || p.title.toLowerCase().includes(q)
        || projectStatusLabel(p.status).toLowerCase().includes(q)
    })
  }, [normalized, cols, search])
  const counts = useMemo(() => countByStatusTab(base, PROJECT_STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, PROJECT_STATUS_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  if (projects.length === 0) {
    return (
      <PortalEmpty icon="folder_open" title="No projects yet" body="Projects shared with you will appear here." />
    )
  }
  return (
    <div className="space-y-3">
      <PortalListToolbar
        search={search}
        onSearch={v => { setSearch(v); paging.resetPage() }}
        placeholder="Search code, project, or status…"
        resetDisabled={!(cols.code || cols.title || cols.offerMin || cols.offerMax || search)}
        onReset={() => { setCols({ code: '', title: '', offerMin: '', offerMax: '' }); setSearch(''); paging.resetPage() }}
        tabs={PROJECT_STATUS_TABS}
        statusTabId={statusTabId}
        counts={counts}
        onStatusChange={id => { setStatusTabId(id); paging.resetPage() }}
      />
      <PortalPanel>
        <ResponsiveDataView
          table={
            <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Code" value={cols.code} onChange={v => { setCols(c => ({ ...c, code: v })); paging.resetPage() }} placeholder="Code…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Project" value={cols.title} onChange={v => { setCols(c => ({ ...c, title: v })); paging.resetPage() }} placeholder="Project…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Status</th>
                  <th className={`${MONEY_TH} text-right`}>Progress</th>
                  <th className={`${MONEY_TH} text-right`}>
                    <MoneyHeaderFilter
                      label="Offer"
                      min={cols.offerMin}
                      max={cols.offerMax}
                      onChange={p => { setCols(c => ({ ...c, offerMin: p.min, offerMax: p.max })); paging.resetPage() }}
                    />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {paging.pageRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-[13px] text-text-secondary">No projects match your filters.</td></tr>
                ) : paging.pageRows.map(p => (
                  <tr key={p.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                    <td className={`${MONEY_TD} text-text-secondary`}>{p.project_code || '—'}</td>
                    <td className={MONEY_TD}>
                      <Link href={ph(`/projects/${p.id}`)} className="text-text-primary font-semibold hover:text-primary">
                        {p.title}
                      </Link>
                    </td>
                    <td className={`${MONEY_TD} text-text-primary`}>{projectStatusLabel(p.status)}</td>
                    <td className={`${MONEY_TD} text-right text-text-primary`}>{p.progress_percent}%</td>
                    <td className={`${MONEY_TD} text-right text-text-primary`}>{moneyZAR(p.offer_amount)}</td>
                    <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(p.last_update_at ?? p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <PortalListPager
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </PortalPanel>
    </div>
  )
}

function JobsTab({ jobs }: { jobs: ClientPortalJob[] }) {
  const ph = usePortalHref()
  const mode = usePortalMode()
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState({ code: '', title: '', project: '' })

  const normalized = useMemo(
    () => jobs.map(j => ({ ...j, status: (j.status ?? '').toLowerCase() })),
    [jobs],
  )
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return normalized.filter(job => {
      if (!matchText(job.job_code, cols.code)) return false
      if (!matchText(job.title, cols.title)) return false
      if (!matchText(job.project_title, cols.project) && !matchText(job.project_code, cols.project)) return false
      if (!q) return true
      return (job.job_code ?? '').toLowerCase().includes(q)
        || (job.title ?? '').toLowerCase().includes(q)
        || (job.project_title ?? '').toLowerCase().includes(q)
        || projectStatusLabel(job.status).toLowerCase().includes(q)
    })
  }, [normalized, cols, search])
  const counts = useMemo(() => countByStatusTab(base, JOB_STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, JOB_STATUS_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  // A linked company can create a job for the provider (stage 3); the portal cannot.
  const newJob = mode.kind === 'linked' && mode.canAct ? (
    <Link href={ph('/jobs/new')} className="btn-primary">+ New job</Link>
  ) : null

  if (jobs.length === 0) {
    return (
      <>
        {newJob && <div className="flex justify-end mb-3">{newJob}</div>}
        <PortalEmpty icon="work_outline" title="No jobs yet" body="Jobs for you will appear here, including ones that are not on a project." />
      </>
    )
  }
  return (
    <div className="space-y-3">
      <PortalListToolbar
        search={search}
        onSearch={v => { setSearch(v); paging.resetPage() }}
        placeholder="Search code, job, or project…"
        resetDisabled={!(cols.code || cols.title || cols.project || search)}
        onReset={() => { setCols({ code: '', title: '', project: '' }); setSearch(''); paging.resetPage() }}
        tabs={JOB_STATUS_TABS}
        statusTabId={statusTabId}
        counts={counts}
        onStatusChange={id => { setStatusTabId(id); paging.resetPage() }}
        trailing={newJob}
      />
      <PortalPanel>
        <ResponsiveDataView
          table={
            <table className="w-full text-[13px]" style={{ minWidth: 680 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Code" value={cols.code} onChange={v => { setCols(c => ({ ...c, code: v })); paging.resetPage() }} placeholder="Code…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Job" value={cols.title} onChange={v => { setCols(c => ({ ...c, title: v })); paging.resetPage() }} placeholder="Job…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Status</th>
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Project" value={cols.project} onChange={v => { setCols(c => ({ ...c, project: v })); paging.resetPage() }} placeholder="Project…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Start</th>
                  <th className={`${MONEY_TH} text-left`}>End</th>
                </tr>
              </thead>
              <tbody>
                {paging.pageRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-[13px] text-text-secondary">No jobs match your filters.</td></tr>
                ) : paging.pageRows.map(job => (
                  <tr key={job.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                    <td className={`${MONEY_TD} text-text-secondary`}>{job.job_code || '—'}</td>
                    <td className={MONEY_TD}>
                      <Link href={ph(`/jobs/${job.id}`)} className="text-text-primary font-semibold hover:text-primary">
                        {job.title || '—'}
                      </Link>
                    </td>
                    <td className={`${MONEY_TD} text-text-primary`}>{projectStatusLabel(job.status)}</td>
                    <td className={MONEY_TD}>
                      {job.deal_id && job.project_title ? (
                        <Link href={ph(`/projects/${job.deal_id}`)} className="text-primary font-semibold hover:underline">
                          {job.project_title}
                          {job.project_code ? <span className="text-text-secondary font-normal"> · {job.project_code}</span> : null}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(job.scheduled_start)}</td>
                    <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(job.scheduled_end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <PortalListPager
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </PortalPanel>
    </div>
  )
}

function MessagesTab({ inbox }: { inbox: MessageInboxItem[] }) {
  const ph = usePortalHref()
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
          href={ph(`/projects/${item.deal_id}?messages=1`)}
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

function InvoicesTab({ invoices, outstanding, session }: { invoices: PortalInvoice[]; outstanding: number; session: ClientPortalSession }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [proofFor, setProofFor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState({ number: '', totalMin: '', totalMax: '', balanceMin: '', balanceMax: '' })
  const linkedMode = usePortalMode().kind === 'linked'
  const canAct = usePortalCanAct()

  const normalized = useMemo(
    () => invoices.map(i => ({ ...i, status: (i.status ?? '').toLowerCase() })),
    [invoices],
  )
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return normalized.filter(inv => {
      if (!matchText(inv.invoice_number, cols.number)) return false
      if (!matchMoney(inv.total_amount, cols.totalMin, cols.totalMax)) return false
      if (!matchMoney(inv.balance_due, cols.balanceMin, cols.balanceMax)) return false
      if (!q) return true
      return (inv.invoice_number ?? '').toLowerCase().includes(q)
        || inv.status.replace(/_/g, ' ').includes(q)
    })
  }, [normalized, cols, search])
  const counts = useMemo(() => countByStatusTab(base, INVOICE_STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, INVOICE_STATUS_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  async function pdf(id: string) {
    setBusyId(id)
    setPdfError(null)
    try {
      const input = await getInvoiceForPdf(session.company_code, session.client_code, id)
      if (!input) throw new Error('Invoice not found.')
      const { downloadInvoicePdf } = await import('@/lib/invoice-pdf')
      downloadInvoicePdf(input)
    } catch (e: unknown) {
      setPdfError(e instanceof Error ? e.message : 'Could not create the PDF.')
    }
    setBusyId(null)
  }

  if (invoices.length === 0) {
    return <PortalEmpty icon="receipt_long" title="No invoices" body="Invoices issued to you will appear here." />
  }

  const colSpan = linkedMode ? 8 : 7
  return (
    <div className="space-y-3">
      <div className="bg-primary/10 border border-primary/25 rounded-xl px-4 py-3 flex items-center justify-between">
        <p className="text-[12px] font-semibold text-primary uppercase tracking-wide">Outstanding</p>
        <p className="text-[18px] font-bold text-text-primary">{moneyZAR(outstanding)}</p>
      </div>
      {pdfError && <p className="text-[12px] text-error">{pdfError}</p>}
      <PortalListToolbar
        search={search}
        onSearch={v => { setSearch(v); paging.resetPage() }}
        placeholder="Search invoice # or status…"
        resetDisabled={!(cols.number || cols.totalMin || cols.totalMax || cols.balanceMin || cols.balanceMax || search)}
        onReset={() => { setCols({ number: '', totalMin: '', totalMax: '', balanceMin: '', balanceMax: '' }); setSearch(''); paging.resetPage() }}
        tabs={INVOICE_STATUS_TABS}
        statusTabId={statusTabId}
        counts={counts}
        onStatusChange={id => { setStatusTabId(id); paging.resetPage() }}
      />
      <PortalPanel>
        <ResponsiveDataView
          table={
            <table className="w-full text-[13px]" style={{ minWidth: 720 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Number" value={cols.number} onChange={v => { setCols(c => ({ ...c, number: v })); paging.resetPage() }} placeholder="Invoice #…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Status</th>
                  <th className={`${MONEY_TH} text-right`}>
                    <MoneyHeaderFilter
                      label="Total"
                      min={cols.totalMin}
                      max={cols.totalMax}
                      onChange={p => { setCols(c => ({ ...c, totalMin: p.min, totalMax: p.max })); paging.resetPage() }}
                    />
                  </th>
                  <th className={`${MONEY_TH} text-right`}>
                    <MoneyHeaderFilter
                      label="Balance"
                      min={cols.balanceMin}
                      max={cols.balanceMax}
                      onChange={p => { setCols(c => ({ ...c, balanceMin: p.min, balanceMax: p.max })); paging.resetPage() }}
                    />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Issued</th>
                  <th className={`${MONEY_TH} text-left`}>Due</th>
                  <th className={`${MONEY_TH} text-left`}>PDF</th>
                  {linkedMode && <th className={`${MONEY_TH} text-left`}>Proof</th>}
                </tr>
              </thead>
              <tbody>
                {paging.pageRows.length === 0 ? (
                  <tr><td colSpan={colSpan} className="py-10 text-center text-[13px] text-text-secondary">No invoices match your filters.</td></tr>
                ) : paging.pageRows.flatMap(inv => [
                  <tr key={inv.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                    <td className={`${MONEY_TD} text-text-primary font-medium`}>{inv.invoice_number || '—'}</td>
                    <td className={`${MONEY_TD} text-text-primary capitalize`}>{inv.status.replace(/_/g, ' ')}</td>
                    <td className={`${MONEY_TD} text-right text-text-primary`}>{moneyZAR(inv.total_amount)}</td>
                    <td className={`${MONEY_TD} text-right font-semibold ${isInvoiceOutstanding(inv.status) ? 'text-warning' : 'text-text-secondary'}`}>
                      {moneyZAR(inv.balance_due)}
                    </td>
                    <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(inv.issue_date)}</td>
                    <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(inv.due_date)}</td>
                    <td className={MONEY_TD}>
                      <button type="button" disabled={busyId === inv.id} onClick={() => void pdf(inv.id)} className="btn-ghost !px-1">
                        {busyId === inv.id ? '…' : 'Download'}
                      </button>
                    </td>
                    {linkedMode && (
                      <td className={MONEY_TD}>
                        <button
                          type="button"
                          onClick={() => setProofFor(proofFor === inv.id ? null : inv.id)}
                          aria-expanded={proofFor === inv.id}
                          className="btn-ghost !px-1"
                        >
                          {proofFor === inv.id ? 'Close' : canAct && isInvoiceOutstanding(inv.status) ? 'Send proof' : 'View'}
                        </button>
                      </td>
                    )}
                  </tr>,
                  linkedMode && proofFor === inv.id ? (
                    <tr key={`${inv.id}-proof`} className="bg-surface-elevated/40">
                      <td colSpan={colSpan} className={`${MONEY_TD} !whitespace-normal`}>
                        <LinkedPaymentProof
                          invoiceId={inv.id}
                          invoiceNumber={inv.invoice_number}
                          balance={inv.balance_due}
                          canSend={canAct && isInvoiceOutstanding(inv.status)}
                        />
                      </td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
            </table>
          }
        />
        <PortalListPager
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </PortalPanel>
    </div>
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

const CLOSED_PROJECT = ['completed', 'closed', 'cancelled', 'lost', 'archived']
const CLOSED_JOB = ['completed', 'closed', 'cancelled', 'invoiced']

function HomeTab({
  name, projects, jobs, invoices, outstanding, unreadCount, docRequests, session,
}: {
  name: string
  projects: ClientPortalProject[]
  jobs: ClientPortalJob[]
  invoices: PortalInvoice[]
  outstanding: number
  unreadCount: number
  docRequests: ClientDocumentRequest[]
  session: ClientPortalSession
}) {
  const ph = usePortalHref()
  const today = localISODate()
  const openProjectsList = projects.filter(p => !CLOSED_PROJECT.includes((p.status ?? '').toLowerCase()))
  const openJobsList = jobs.filter(j => !CLOSED_JOB.includes((j.status ?? '').toLowerCase()))
  const overdue = invoices.filter(i => isInvoiceOutstanding(i.status) && i.due_date && i.due_date < today)
  const pendingRequests = docRequests.filter(r => ['requested', 'rejected'].includes((r.status ?? '').toLowerCase()))
  const recentProjects = openProjectsList.slice(0, 5)
  const recentJobs = openJobsList.slice(0, 5)
  const recentInvoices = invoices.filter(i => isInvoiceOutstanding(i.status)).slice(0, 5)

  return (
    <div className="space-y-4">
      <PortalHero
        eyebrow="Client workspace"
        title={`Welcome, ${name}`}
        subtitle="Projects, jobs, quotes and payments — your live view with the delivery team."
        meta={
          overdue.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-error/10 px-2 py-1 text-[11px] font-semibold text-error">
              <span className="material-icons text-[14px]">priority_high</span>
              {overdue.length === 1 ? '1 invoice overdue' : `${overdue.length} invoices overdue`}
            </span>
          ) : unreadCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
              <span className="material-icons text-[14px]">mark_email_unread</span>
              {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-elevated px-2 py-1 text-[11px] font-medium text-text-secondary">
              <span className="material-icons text-[14px]">verified</span>
              All quiet — nothing urgent
            </span>
          )
        }
        actions={
          <>
            <Link href={ph('/home?tab=projects')} className="btn-primary">Projects</Link>
            <Link href={ph('/home?tab=invoices')} className="btn-outlined">Invoices</Link>
          </>
        }
      />

      <PortalComplianceReminder
        load={() => getPartyComplianceDocuments(session.company_code, session.client_code)}
        href={ph('/home?tab=documents')}
      />

      {(overdue.length > 0 || pendingRequests.length > 0) && (
        <div className="space-y-2">
          {overdue.length > 0 && (
            <Link href={ph('/home?tab=invoices')} className="block bg-error/10 border border-error/25 rounded-xl px-4 py-3">
              <p className="text-[13px] font-semibold text-error">
                {overdue.length === 1 ? '1 invoice is overdue' : `${overdue.length} invoices are overdue`}
              </p>
              <p className="text-[12px] text-text-secondary mt-0.5">
                {moneyZAR(overdue.reduce((s, i) => s + i.balance_due, 0))} past the due date. Tap to view.
              </p>
            </Link>
          )}
          {pendingRequests.length > 0 && (
            <Link href={ph('/home?tab=documents')} className="block bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
              <p className="text-[13px] font-semibold text-warning">
                {pendingRequests.length === 1 ? '1 document is needed from you' : `${pendingRequests.length} documents are needed from you`}
              </p>
              <p className="text-[12px] text-text-secondary mt-0.5">Tap to upload.</p>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <PortalKpi label="Open projects" value={String(openProjectsList.length)} icon="folder_open" href={ph('/home?tab=projects')} />
        <PortalKpi label="Open jobs" value={String(openJobsList.length)} icon="work" href={ph('/home?tab=jobs')} />
        <PortalKpi label="Amount owing" value={moneyZAR(outstanding)} icon="payments" tone="money" href={ph('/home?tab=invoices')} />
        <PortalKpi label="Unread" value={String(unreadCount)} icon="chat" tone={unreadCount > 0 ? 'alert' : 'default'} href={ph('/home?tab=messages')} />
      </div>

      <PortalSection
        title="Open jobs"
        action={<Link href={ph('/home?tab=jobs')} className="btn-ghost">View all</Link>}
      >
        {recentJobs.length === 0 ? (
          <PortalEmpty compact icon="work_outline" title="No open jobs" body="Jobs for you will appear here as work starts." />
        ) : (
          <PortalPanel>
            <ResponsiveDataView
              table={
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>Code</th>
                      <th className={`${MONEY_TH} text-left`}>Job</th>
                      <th className={`${MONEY_TH} text-left`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map(job => (
                      <tr key={job.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} text-text-secondary`}>{job.job_code || '—'}</td>
                        <td className={MONEY_TD}>
                          <Link href={ph(`/jobs/${job.id}`)} className="text-text-primary font-semibold hover:text-primary">
                            {job.title || '—'}
                          </Link>
                        </td>
                        <td className={`${MONEY_TD} text-text-primary`}>{projectStatusLabel(job.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </PortalPanel>
        )}
      </PortalSection>

      <PortalSection
        title="Open projects"
        action={<Link href={ph('/home?tab=projects')} className="btn-ghost">View all</Link>}
      >
        {recentProjects.length === 0 ? (
          <PortalEmpty compact icon="folder_open" title="No open projects" body="Shared projects and progress updates will land here." />
        ) : (
          <PortalPanel>
            <ResponsiveDataView
              table={
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>Code</th>
                      <th className={`${MONEY_TH} text-left`}>Project</th>
                      <th className={`${MONEY_TH} text-right`}>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProjects.map(p => (
                      <tr key={p.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} text-text-secondary`}>{p.project_code || '—'}</td>
                        <td className={MONEY_TD}>
                          <Link href={ph(`/projects/${p.id}`)} className="text-text-primary font-semibold hover:text-primary">
                            {p.title}
                          </Link>
                        </td>
                        <td className={`${MONEY_TD} text-right text-text-primary`}>{p.progress_percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </PortalPanel>
        )}
      </PortalSection>

      <PortalSection
        title="Amount owing"
        action={<Link href={ph('/home?tab=invoices')} className="btn-ghost">Invoices</Link>}
      >
        {recentInvoices.length === 0 ? (
          <PortalEmpty compact icon="receipt_long" title="Nothing outstanding" body="New invoices will show balances and due dates here." />
        ) : (
          <PortalPanel>
            <ResponsiveDataView
              table={
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>Number</th>
                      <th className={`${MONEY_TH} text-left`}>Due</th>
                      <th className={`${MONEY_TH} text-right`}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map(inv => (
                      <tr key={inv.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} text-text-primary font-medium`}>{inv.invoice_number || '—'}</td>
                        <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(inv.due_date)}</td>
                        <td className={`${MONEY_TD} text-right font-semibold text-warning`}>{moneyZAR(inv.balance_due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </PortalPanel>
        )}
      </PortalSection>

      <PortalQuickNav>
        <Link href={ph('/home?tab=information')} className="btn-outlined">Information</Link>
        <Link href={ph('/home?tab=quotes')} className="btn-outlined">Quotes & Invoices</Link>
        <Link href={ph('/home?tab=payments')} className="btn-outlined">Payments</Link>
        <Link href={ph('/home?tab=documents')} className="btn-outlined">Documents</Link>
        <Link href={ph('/home?tab=messages')} className="btn-outlined">Messages</Link>
      </PortalQuickNav>
    </div>
  )
}

const QUOTE_WAITING = ['quoted', 'sent', 'negotiation']

function QuotesList({ projects }: { projects: ClientPortalProject[] }) {
  const ph = usePortalHref()
  const quoted = useMemo(
    () => projects.filter(p => (p.offer_amount ?? 0) > 0 || QUOTE_WAITING.includes((p.status ?? '').toLowerCase())),
    [projects],
  )
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState({ code: '', title: '', offerMin: '', offerMax: '' })

  const normalized = useMemo(
    () => quoted.map(p => ({ ...p, status: (p.status ?? '').toLowerCase() })),
    [quoted],
  )
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return normalized.filter(p => {
      if (!matchText(p.project_code, cols.code)) return false
      if (!matchText(p.title, cols.title)) return false
      if (!matchMoney(p.offer_amount, cols.offerMin, cols.offerMax)) return false
      if (!q) return true
      return (p.project_code ?? '').toLowerCase().includes(q)
        || p.title.toLowerCase().includes(q)
        || projectStatusLabel(p.status).toLowerCase().includes(q)
    })
  }, [normalized, cols, search])
  const counts = useMemo(() => countByStatusTab(base, PROJECT_STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, PROJECT_STATUS_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  if (quoted.length === 0) {
    return <PortalEmpty icon="request_quote" title="No quotes" body="Quotes we send you will appear here." />
  }

  return (
    <div className="space-y-3">
      <PortalListToolbar
        search={search}
        onSearch={v => { setSearch(v); paging.resetPage() }}
        placeholder="Search code, project, or status…"
        resetDisabled={!(cols.code || cols.title || cols.offerMin || cols.offerMax || search)}
        onReset={() => { setCols({ code: '', title: '', offerMin: '', offerMax: '' }); setSearch(''); paging.resetPage() }}
        tabs={PROJECT_STATUS_TABS}
        statusTabId={statusTabId}
        counts={counts}
        onStatusChange={id => { setStatusTabId(id); paging.resetPage() }}
      />
      <PortalPanel>
        <ResponsiveDataView
          table={
            <table className="w-full text-[13px]" style={{ minWidth: 560 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Code" value={cols.code} onChange={v => { setCols(c => ({ ...c, code: v })); paging.resetPage() }} placeholder="Code…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>
                    <TextHeaderFilter label="Project" value={cols.title} onChange={v => { setCols(c => ({ ...c, title: v })); paging.resetPage() }} placeholder="Project…" />
                  </th>
                  <th className={`${MONEY_TH} text-left`}>Status</th>
                  <th className={`${MONEY_TH} text-right`}>
                    <MoneyHeaderFilter
                      label="Offer"
                      min={cols.offerMin}
                      max={cols.offerMax}
                      onChange={p => { setCols(c => ({ ...c, offerMin: p.min, offerMax: p.max })); paging.resetPage() }}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {paging.pageRows.length === 0 ? (
                  <tr><td colSpan={4} className="py-10 text-center text-[13px] text-text-secondary">No quotes match your filters.</td></tr>
                ) : paging.pageRows.map(p => {
                  const waiting = QUOTE_WAITING.includes(p.status)
                  return (
                    <tr key={p.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                      <td className={`${MONEY_TD} text-text-secondary`}>{p.project_code || '—'}</td>
                      <td className={MONEY_TD}>
                        <Link href={ph(`/projects/${p.id}`)} className="text-text-primary font-semibold hover:text-primary">
                          {p.title}
                        </Link>
                      </td>
                      <td className={`${MONEY_TD} text-text-primary`}>
                        {projectStatusLabel(p.status)}
                        {waiting ? <span className="ml-1.5 text-[10px] font-semibold text-warning">Awaiting</span> : null}
                      </td>
                      <td className={`${MONEY_TD} text-right text-text-primary font-semibold`}>{moneyZAR(p.offer_amount ?? 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          }
        />
        <PortalListPager
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </PortalPanel>
    </div>
  )
}

function QuotesInvoicesTab({
  session, projects, invoices, outstanding, initial,
}: {
  session: ClientPortalSession
  projects: ClientPortalProject[]
  invoices: PortalInvoice[]
  outstanding: number
  initial: 'quotes' | 'invoices'
}) {
  const [section, setSection] = useState<'quotes' | 'invoices'>(initial)
  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1.5">
        {(['quotes', 'invoices'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={section === s ? 'btn-primary' : 'btn-outlined'}
          >
            {s === 'quotes' ? 'Quotes' : 'Invoices'}
          </button>
        ))}
      </div>
      {section === 'invoices' ? (
        <InvoicesTab invoices={invoices} outstanding={outstanding} session={session} />
      ) : (
        <QuotesList projects={projects} />
      )}
    </div>
  )
}
