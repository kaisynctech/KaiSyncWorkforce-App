'use client'

import { Suspense, useEffect, useRef, useState, type DragEvent } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  normalizeClientType,
  nextClientCode,
} from '@/lib/client-create-payload'
import { createClientRecord, replaceClientContacts, saveClientBankDetails } from '@/lib/clients'
import { logClientEvent } from '@/lib/client-events'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { Toggle } from '@/components/Toggle'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ClientPortalChangesBanner } from '@/components/ClientPortalChangesBanner'
import { ClientActivityTab } from '@/components/ClientActivityTab'
import { ClientDocumentRequests } from '@/components/ClientDocumentRequests'
import { fmtMoney } from '@/lib/finance-calc'
import { createInvoiceFromAcceptedQuote } from '@/lib/quote-invoice'
import type { Client, ClientDocument, ClientNote, Site, Project, ProjectDocument } from '@/types/database'
import type { FinanceInvoice } from '@/lib/finance-types'

const CLIENT_TABS = ['info', 'projects', 'jobs', 'quotes', 'invoices', 'documents', 'notes', 'activity', 'commercial'] as const
type ClientTab = typeof CLIENT_TABS[number]

const TAB_LABELS: Record<ClientTab, string> = {
  info: 'Information',
  projects: 'Projects',
  jobs: 'Jobs',
  quotes: 'Quotes',
  invoices: 'Invoices',
  documents: 'Documents',
  notes: 'Notes',
  activity: 'Activity',
  commercial: 'Commercial',
}

const DOC_TYPES = [
  { value: 'contract', label: 'Contract' },
  { value: 'msa', label: 'MSA' },
  { value: 'nda', label: 'NDA' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'other', label: 'Other' },
] as const

function docTypeLabel(value: string): string {
  return DOC_TYPES.find(t => t.value === value)?.label ?? value
}

type ExtraPersonDraft = {
  key: string
  id: string | null
  name: string
  email: string
  includeInEmails: boolean
}

type ClientJob = {
  id: string
  title: string
  status: string
  created_at: string
  job_code: string | null
  deal_id: string | null
  assignee_employee_id: string | null
  project_code?: string | null
  assignee_name?: string | null
}

type ClientDocRow = ProjectDocument & {
  project_title?: string | null
}

const JOB_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open:        { bg: '#DBEAFE', fg: '#1E40AF' },
  scheduled:   { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  completed:   { bg: '#DCFCE7', fg: '#166534' },
  cancelled:   { bg: '#E5E7EB', fg: '#6B7280' },
}

const PROJECT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:       { bg: '#E5E7EB', fg: '#6B7280' },
  sent:        { bg: '#DBEAFE', fg: '#1E40AF' },
  negotiation: { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  won:         { bg: '#DCFCE7', fg: '#166534' },
  lost:        { bg: '#FEE2E2', fg: '#991B1B' },
}
const PROJECT_STATUS_OPTIONS = ['draft', 'sent', 'negotiation', 'in_progress', 'won', 'lost']
const BOARD_STAGES = ['draft', 'sent', 'negotiation', 'in_progress', 'won', 'lost'] as const

const INVOICE_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:          { bg: '#E5E7EB', fg: '#6B7280' },
  sent:           { bg: '#DBEAFE', fg: '#1E40AF' },
  viewed:         { bg: '#E0E7FF', fg: '#3730A3' },
  partially_paid: { bg: '#FEF3C7', fg: '#92400E' },
  paid:           { bg: '#DCFCE7', fg: '#166534' },
  overdue:        { bg: '#FEE2E2', fg: '#991B1B' },
  cancelled:      { bg: '#E5E7EB', fg: '#6B7280' },
}

const fmtCurrency = (n: number | null) =>
  n != null ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}` : '—'

function empName(e: { name?: string; surname?: string } | null | undefined): string {
  if (!e) return '—'
  return `${e.name ?? ''} ${e.surname ?? ''}`.trim() || '—'
}

function mediaPath(fileUrl: string | null | undefined, storagePath?: string | null): string | null {
  const stored = storagePath?.trim()
  if (stored) return stored
  const raw = fileUrl?.trim()
  if (!raw) return null
  const marker = '/workforce-media/'
  const at = raw.indexOf(marker)
  if (at >= 0) return decodeURIComponent(raw.slice(at + marker.length).split('?')[0])
  if (!/^https?:\/\//i.test(raw)) return raw
  return null
}

export default function ClientDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    }>
      <ClientDetailInner />
    </Suspense>
  )
}

function ClientDetailInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientId = params.id
  const isNew = clientId === 'new'
  const focusId = searchParams.get('focus')

  const [tab, setTab] = useState<ClientTab>('info')
  const [client, setClient] = useState<Client | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [clientJobs, setClientJobs] = useState<ClientJob[]>([])
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([])
  const [clientQuotes, setClientQuotes] = useState<Array<{
    id: string
    quote_number: string | null
    title: string
    status: string
    total_amount: number
    created_at: string
    deal_id: string | null
  }>>([])
  const [quoteBusyId, setQuoteBusyId] = useState<string | null>(null)
  const [clientDocs, setClientDocs] = useState<ClientDocument[]>([])
  const [projectDocs, setProjectDocs] = useState<ClientDocRow[]>([])
  const [timelineNotes, setTimelineNotes] = useState<ClientNote[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [docBusy, setDocBusy] = useState(false)
  const [uploadDocType, setUploadDocType] = useState('other')
  const fileRef = useRef<HTMLInputElement>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [companyCode, setCompanyCode] = useState('')
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [xeroLink,      setXeroLink]      = useState<{ xero_contact_id: string; last_synced_at: string } | null>(null)
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)
  const [xeroSessionToken, setXeroSessionToken] = useState<string | null>(null)
  const [projectView, setProjectView] = useState<'table' | 'board'>('table')
  const [codeCopied, setCodeCopied] = useState(false)
  const [addingSite, setAddingSite] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null)
  const [editSiteName, setEditSiteName] = useState('')
  const [editSiteAddress, setEditSiteAddress] = useState('')
  const [commercialData, setCommercialData] = useState<{
    quotes: Array<{ id: string; quote_number: string | null; title: string; status: string; total_amount: number; created_at: string }>
    invoices: Array<{ id: string; invoice_number: string | null; status: string; total_amount: number; balance_due: number; issue_date: string }>
    ledger: Array<{ id: string; entry_type: string; reference_number: string | null; description: string | null; debit: number; credit: number; entry_date: string }>
    outstanding: number
  } | null>(null)
  const [commercialLoading, setCommercialLoading] = useState(false)
  const [commercialSaving, setCommercialSaving] = useState(false)
  const [commercialMsg, setCommercialMsg] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [clientType, setClientType] = useState<string>('individual')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [legalName, setLegalName] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [website, setWebsite] = useState('')
  const [mobile, setMobile] = useState('')
  const [directLine, setDirectLine] = useState('')
  const [fax, setFax] = useState('')
  const [bankHolder, setBankHolder] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankBranch, setBankBranch] = useState('')
  const [bankBaseline, setBankBaseline] = useState({ holder: '', name: '', account: '', branch: '' })
  const [extraPeople, setExtraPeople] = useState<ExtraPersonDraft[]>([])
  const [portalEnabled, setPortalEnabled] = useState(false)

  const canEdit = can(perms, PERM.clientsEdit)
  const showRelatedTabs = !isNew && !!client
  const hasClientCode = !!client?.client_code

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && (CLIENT_TABS as readonly string[]).includes(t)) setTab(t as ClientTab)
  }, [searchParams])

  useEffect(() => {
    if (tab !== 'invoices' || !focusId) return
    const el = document.getElementById(`client-invoice-${focusId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [tab, focusId, invoices, loading])

  useEffect(() => {
    if (tab !== 'projects' || !focusId) return
    const el = document.getElementById(`client-project-${focusId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [tab, focusId, projects, loading])

  useEffect(() => { void load() }, [clientId])

  async function loadCommercial(clientId: string, companyId: string) {
    const supabase = createClient()
    const [quoteRes, invoiceRes, ledgerRes, balanceRes] = await Promise.all([
      supabase.from('commercial_quotes')
        .select('id, quote_number, title, status, total_amount, created_at')
        .eq('client_id', clientId).eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('finance_invoices')
        .select('id, invoice_number, status, total_amount, balance_due, issue_date')
        .eq('client_id', clientId).eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('customer_ledger_entries')
        .select('id, entry_type, reference_number, description, debit, credit, entry_date')
        .eq('client_id', clientId).eq('company_id', companyId)
        .order('entry_date', { ascending: false }).limit(20),
      supabase.from('customer_ledger_entries')
        .select('debit, credit')
        .eq('client_id', clientId).eq('company_id', companyId),
    ])
    const failed = quoteRes.error ?? invoiceRes.error ?? ledgerRes.error ?? balanceRes.error
    if (failed) throw new Error(failed.message)
    const outstanding = (balanceRes.data ?? []).reduce(
      (sum, row) => sum + Number(row.debit ?? 0) - Number(row.credit ?? 0),
      0,
    )
    return {
      quotes: quoteRes.data ?? [],
      invoices: invoiceRes.data ?? [],
      ledger: ledgerRes.data ?? [],
      outstanding,
    }
  }

  useEffect(() => {
    if (tab !== 'commercial' || !client || !client.company_id) return
    let cancelled = false
    setCommercialLoading(true)
    loadCommercial(client.id, client.company_id).then(data => {
      if (cancelled) return
      setCommercialData(data)
      setCommercialMsg(null)
    }).catch((e: unknown) => {
      if (cancelled) return
      setCommercialData(null)
      setCommercialMsg(e instanceof Error ? e.message : 'Could not load commercial records.')
    }).finally(() => {
      if (!cancelled) setCommercialLoading(false)
    })
    return () => { cancelled = true }
  }, [tab, client?.id, client?.company_id])

  async function loadJobs(
    supabase: ReturnType<typeof createClient>,
    projectRows: Project[],
  ): Promise<ClientJob[]> {
    const rich = await supabase
      .from('jobs')
      .select(`
        id, title, status, created_at, job_code, deal_id, assignee_employee_id,
        client_deals:deal_id(project_code),
        assignee:assignee_employee_id(name, surname)
      `)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (!rich.error && rich.data) {
      return (rich.data as unknown as Array<Record<string, unknown>>).map(j => {
        const deal = j.client_deals as { project_code?: string | null } | null
        const assignee = j.assignee as { name?: string; surname?: string } | null
        return {
          id: String(j.id),
          title: String(j.title ?? ''),
          status: String(j.status ?? ''),
          created_at: String(j.created_at ?? ''),
          job_code: (j.job_code as string | null) ?? null,
          deal_id: (j.deal_id as string | null) ?? null,
          assignee_employee_id: (j.assignee_employee_id as string | null) ?? null,
          project_code: deal?.project_code ?? null,
          assignee_name: empName(assignee),
        }
      })
    }

    const { data: plain } = await supabase
      .from('jobs')
      .select('id, title, status, created_at, job_code, deal_id, assignee_employee_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    const rows = (plain ?? []) as Array<{
      id: string
      title: string
      status: string
      created_at: string
      job_code: string | null
      deal_id: string | null
      assignee_employee_id: string | null
    }>

    const codeByDeal = new Map(projectRows.map(p => [p.id, p.project_code]))
    const assigneeIds = [...new Set(rows.map(r => r.assignee_employee_id).filter((id): id is string => Boolean(id)))]
    const nameById = new Map<string, string>()
    if (assigneeIds.length > 0) {
      const { data: emps } = await supabase
        .from('employees')
        .select('id, name, surname')
        .in('id', assigneeIds)
      for (const e of emps ?? []) {
        nameById.set((e as { id: string }).id, empName(e as { name?: string; surname?: string }))
      }
    }

    return rows.map(j => ({
      ...j,
      project_code: j.deal_id ? (codeByDeal.get(j.deal_id) ?? null) : null,
      assignee_name: j.assignee_employee_id ? (nameById.get(j.assignee_employee_id) ?? '—') : '—',
    }))
  }

  async function loadDocuments(
    supabase: ReturnType<typeof createClient>,
    dealIds: string[],
  ): Promise<ClientDocRow[]> {
    if (dealIds.length === 0) return []

    const joined = await supabase
      .from('project_documents')
      .select('id, company_id, deal_id, document_name, document_type, file_url, created_at, client_deals!inner(id, title, client_id)')
      .eq('client_deals.client_id', clientId)
      .order('created_at', { ascending: false })

    if (!joined.error && joined.data) {
      return (joined.data as unknown as Array<Record<string, unknown>>).map(d => {
        const deal = d.client_deals as { title?: string } | null
        return {
          id: String(d.id),
          company_id: String(d.company_id),
          deal_id: String(d.deal_id),
          document_name: String(d.document_name ?? ''),
          document_type: (d.document_type as string | null) ?? null,
          file_url: String(d.file_url ?? ''),
          created_at: String(d.created_at ?? ''),
          project_title: deal?.title ?? null,
        }
      })
    }

    const { data } = await supabase
      .from('project_documents')
      .select('id, company_id, deal_id, document_name, document_type, file_url, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false })

    const titleByDeal = new Map(
      (await supabase.from('client_deals').select('id, title').in('id', dealIds)).data?.map(
        (p: { id: string; title: string }) => [p.id, p.title],
      ) ?? [],
    )

    return ((data ?? []) as ProjectDocument[]).map(d => ({
      ...d,
      project_title: titleByDeal.get(d.deal_id) ?? null,
    }))
  }

  async function loadClientDocuments(
    supabase: ReturnType<typeof createClient>,
  ): Promise<ClientDocument[]> {
    const { data, error: e } = await supabase
      .from('client_documents')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    if (e) {
      setError(e.message)
      return []
    }
    return (data ?? []) as ClientDocument[]
  }

  async function loadTimelineNotes(
    supabase: ReturnType<typeof createClient>,
  ): Promise<ClientNote[]> {
    const joined = await supabase
      .from('client_notes')
      .select('id, company_id, client_id, body, created_by, created_at, employees:created_by(name, surname)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (!joined.error && joined.data) {
      return (joined.data as unknown as Array<Record<string, unknown>>).map(n => {
        const emp = n.employees as { name?: string; surname?: string } | null
        return {
          id: String(n.id),
          company_id: String(n.company_id),
          client_id: String(n.client_id),
          body: String(n.body ?? ''),
          created_by: (n.created_by as string | null) ?? null,
          created_at: String(n.created_at ?? ''),
          author_name: emp ? empName(emp) : null,
        }
      })
    }

    const { data, error: e } = await supabase
      .from('client_notes')
      .select('id, company_id, client_id, body, created_by, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    if (e) {
      setError(e.message)
      return []
    }

    const rows = (data ?? []) as ClientNote[]
    const authorIds = [...new Set(rows.map(r => r.created_by).filter((id): id is string => Boolean(id)))]
    const nameById = new Map<string, string>()
    if (authorIds.length > 0) {
      const { data: emps } = await supabase
        .from('employees')
        .select('id, name, surname')
        .in('id', authorIds)
      for (const emp of emps ?? []) {
        nameById.set((emp as { id: string }).id, empName(emp as { name?: string; surname?: string }))
      }
    }
    return rows.map(n => ({
      ...n,
      author_name: n.created_by ? (nameById.get(n.created_by) ?? null) : null,
    }))
  }

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (member) {
      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))
      const { data: company } = await supabase
        .from('companies')
        .select('code')
        .eq('id', member.companyId)
        .maybeSingle()
      setCompanyCode((company as { code?: string | null } | null)?.code ?? '')
    }

    if (isNew) {
      setClientType('individual')
      setAccountNumber('')
      setLegalName('')
      setCompanyNumber('')
      setWebsite('')
      setMobile('')
      setDirectLine('')
      setFax('')
      setBankHolder('')
      setBankName('')
      setBankAccount('')
      setBankBranch('')
      setBankBaseline({ holder: '', name: '', account: '', branch: '' })
      setExtraPeople([])
      setLoading(false)
      return
    }

    const [cRes, sRes, pRes, iRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('sites').select('*').eq('client_id', clientId),
      supabase.from('client_deals').select('*, employees:manager_employee_id(name, surname)').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase
        .from('finance_invoices')
        .select('id, invoice_number, status, issue_date, due_date, total_amount, balance_due, client_id, company_id, quote_id')
        .eq('client_id', clientId)
        .order('issue_date', { ascending: false }),
    ])

    if (!cRes.data) { router.push('/dashboard/clients'); return }

    const c = cRes.data as Client
    setClient(c)
    setName(c.name ?? '')
    setClientType(normalizeClientType(c.type))
    setContactPerson(c.contact_person ?? '')
    setPhone(c.phone ?? '')
    setEmail(c.email ?? '')
    setAddress(c.address ?? '')
    setNotes(c.notes ?? '')
    setAccountNumber(c.account_number ?? '')
    setLegalName(c.legal_name ?? '')
    setCompanyNumber(c.company_number ?? '')
    setWebsite(c.website ?? '')
    setMobile(c.mobile ?? '')
    setDirectLine(c.direct_line ?? '')
    setFax(c.fax ?? '')
    setPortalEnabled(c.portal_enabled ?? false)

    const { data: bank, error: bankError } = await supabase
      .from('client_bank_details')
      .select('account_holder, bank_name, account_number, branch_code')
      .eq('company_id', c.company_id)
      .eq('client_id', clientId)
      .maybeSingle()
    if (bankError) setError(bankError.message)
    const loadedBank = {
      holder: (bank?.account_holder as string | null) ?? '',
      name: (bank?.bank_name as string | null) ?? '',
      account: (bank?.account_number as string | null) ?? '',
      branch: (bank?.branch_code as string | null) ?? '',
    }
    setBankHolder(loadedBank.holder)
    setBankName(loadedBank.name)
    setBankAccount(loadedBank.account)
    setBankBranch(loadedBank.branch)
    setBankBaseline(loadedBank)

    const { data: people, error: peopleError } = await supabase
      .from('client_contacts')
      .select('id, name, email, include_in_emails, sort_order')
      .eq('company_id', c.company_id)
      .eq('client_id', clientId)
      .order('sort_order')
    if (peopleError) setError(peopleError.message)
    setExtraPeople((people ?? []).map(person => ({
      key: person.id as string,
      id: person.id as string,
      name: (person.name as string) ?? '',
      email: (person.email as string | null) ?? '',
      includeInEmails: Boolean(person.include_in_emails),
    })))

    const projectRows = (pRes.data ?? []) as Project[]
    setSites((sRes.data ?? []) as Site[])
    setProjects(projectRows)
    setInvoices((iRes.data ?? []) as FinanceInvoice[])
    const { data: quoteRows, error: quoteError } = await supabase
      .from('commercial_quotes')
      .select('id, quote_number, title, status, total_amount, created_at, deal_id')
      .eq('client_id', clientId)
      .eq('company_id', c.company_id)
      .order('created_at', { ascending: false })
    if (quoteError) setError(quoteError.message)
    setClientQuotes((quoteRows ?? []) as typeof clientQuotes)

    const [jobs, docs, cDocs, tNotes] = await Promise.all([
      loadJobs(supabase, projectRows),
      loadDocuments(supabase, projectRows.map(p => p.id)),
      loadClientDocuments(supabase),
      loadTimelineNotes(supabase),
    ])
    setClientJobs(jobs)
    setProjectDocs(docs)
    setClientDocs(cDocs)
    setTimelineNotes(tNotes)

    const cId = c.company_id
    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: lnk } = await (supabase.rpc as any)('get_xero_link_for_record', {
        p_company_id: cId, p_record_type: 'client', p_record_id: clientId,
      })
      setXeroLink(lnk ?? null)
    }
    const { data: { session } } = await supabase.auth.getSession()
    setXeroSessionToken(session?.access_token ?? null)
    const pendingError = sessionStorage.getItem('kaisync-client-save-error')
    if (pendingError) {
      sessionStorage.removeItem('kaisync-client-save-error')
      if (!peopleError) setError(pendingError)
    }
    setLoading(false)
  }

  async function pushToXero() {
    if (!canEdit || !client?.company_id || !xeroSessionToken || xeroPushing) return
    setXeroPushing(true)
    setXeroMsg(null)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${xeroSessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: client.company_id, record_id: clientId, record_type: 'client' }),
      })
      const data = await resp.json().catch(() => ({} as { ok?: boolean; error?: string; xero_contact_id?: string }))
      if (data.ok) {
        setXeroLink({
          xero_contact_id: data.xero_contact_id ?? xeroLink?.xero_contact_id ?? '',
          last_synced_at: new Date().toISOString(),
        })
        setXeroMsg('Synced to Xero.')
      } else {
        setXeroMsg(data.error ?? `Xero push failed (${resp.status})`)
      }
    } catch {
      setXeroMsg('Xero push failed — network or server error')
    } finally {
      setXeroPushing(false)
    }
  }

  async function save() {
    if (!canEdit) { setError('You do not have permission to edit clients.'); return }
    if (!name.trim()) { setError('Client name is required.'); return }
    if (extraPeople.some(person => !person.name.trim() && (person.email.trim() || person.includeInEmails))) {
      setError('Each extra person needs a name.')
      return
    }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const type = normalizeClientType(clientType)
    const prevPortal = client?.portal_enabled ?? false
    const identity = {
      accountNumber,
      legalName,
      companyNumber,
      website,
      mobile,
      directLine,
      fax,
    }
    const nextBank = {
      holder: bankHolder.trim(),
      name: bankName.trim(),
      account: bankAccount.trim(),
      branch: bankBranch.trim(),
    }
    const bankDirty = nextBank.holder !== bankBaseline.holder.trim()
      || nextBank.name !== bankBaseline.name.trim()
      || nextBank.account !== bankBaseline.account.trim()
      || nextBank.branch !== bankBaseline.branch.trim()

    if (isNew) {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Account not linked to an active employee.'); setSaving(false); return }
      const created = await createClientRecord(supabase, {
        companyId: member.companyId,
        name: name.trim(),
        type,
        contactPerson,
        phone,
        email,
        address,
        notes,
        portalEnabled,
        assignCode: portalEnabled,
        ...identity,
      })
      if (!created.ok) { setError(created.message); setSaving(false); return }
      const people = await replaceClientContacts(supabase, {
        companyId: member.companyId,
        clientId: created.data.id,
        contacts: extraPeople,
      })
      if (!people.ok) sessionStorage.setItem('kaisync-client-save-error', people.message)
      if (bankDirty) {
        const bank = await saveClientBankDetails(supabase, {
          companyId: member.companyId,
          clientId: created.data.id,
          bank: {
            accountHolder: nextBank.holder,
            bankName: nextBank.name,
            accountNumber: nextBank.account,
            branchCode: nextBank.branch,
          },
        })
        if (!bank.ok) sessionStorage.setItem('kaisync-client-save-error', bank.message)
      }
      router.push(`/dashboard/clients/${created.data.id}`)
    } else {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        account_number: accountNumber.trim() || null,
        legal_name: legalName.trim() || null,
        company_number: companyNumber.trim() || null,
        website: website.trim() || null,
        mobile: mobile.trim() || null,
        direct_line: directLine.trim() || null,
        fax: fax.trim() || null,
        portal_enabled: portalEnabled,
      }

      const { error: e } = await supabase.from('clients').update(payload).eq('id', clientId)
      if (e) {
        setError(e.message)
      } else if (client?.company_id) {
        const people = await replaceClientContacts(supabase, {
          companyId: client.company_id,
          clientId,
          contacts: extraPeople,
        })
        if (!people.ok) {
          setError(people.message)
        } else {
          setClient(prev => prev
            ? { ...prev, ...payload, type, portal_enabled: portalEnabled } as Client
            : prev)
          await logClientEvent(supabase, {
            companyId: client.company_id,
            screen: 'HrClientDetails',
            action: 'client_profile_updated',
            meta: { client_id: clientId, name: name.trim(), extra_people: people.data.count },
          })
          if (prevPortal !== portalEnabled) {
            await logClientEvent(supabase, {
              companyId: client.company_id,
              screen: 'HrClientDetails',
              action: portalEnabled ? 'client_portal_enabled' : 'client_portal_disabled',
              meta: { client_id: clientId },
            })
          }
          const { data: savedPeople } = await supabase
            .from('client_contacts')
            .select('id, name, email, include_in_emails, sort_order')
            .eq('company_id', client.company_id)
            .eq('client_id', clientId)
            .order('sort_order')
          setExtraPeople((savedPeople ?? []).map(person => ({
            key: person.id as string,
            id: person.id as string,
            name: (person.name as string) ?? '',
            email: (person.email as string | null) ?? '',
            includeInEmails: Boolean(person.include_in_emails),
          })))
          if (bankDirty) {
            const bank = await saveClientBankDetails(supabase, {
              companyId: client.company_id,
              clientId,
              bank: {
                accountHolder: nextBank.holder,
                bankName: nextBank.name,
                accountNumber: nextBank.account,
                branchCode: nextBank.branch,
              },
            })
            if (!bank.ok) setError(bank.message)
            else setBankBaseline(nextBank)
          }
        }
      }
    }
    setSaving(false)
  }

  async function ensurePermanentClientCode(): Promise<string | null> {
    if (!canEdit) return null
    if (!client?.company_id) return null
    if (client.client_code) return client.client_code

    const supabase = createClient()
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', client.company_id).maybeSingle(),
      supabase.from('clients').select('client_code').eq('company_id', client.company_id),
    ])
    const code = nextClientCode(
      (company as { code?: string | null } | null)?.code ?? '',
      (existing ?? []).map(r => (r as { client_code: string | null }).client_code),
    )
    const { error: e } = await supabase
      .from('clients')
      .update({ client_code: code })
      .eq('id', clientId)
      .is('client_code', null)
    if (e) {
      setError(e.message)
      return null
    }
    return code
  }

  async function handlePortalToggle(next: boolean) {
    if (!canEdit) return
    const prev = portalEnabled
    setPortalEnabled(next)
    if (isNew || !client?.company_id) return

    setIsBusy(true)
    setError(null)
    const supabase = createClient()

    if (next && !hasClientCode) {
      const code = await ensurePermanentClientCode()
      if (!code) { setPortalEnabled(prev); setIsBusy(false); return }
      await supabase.from('clients').update({ portal_enabled: true }).eq('id', clientId)
      await logClientEvent(supabase, {
        companyId: client.company_id,
        screen: 'HrClientDetails',
        action: 'client_portal_enabled',
        meta: { client_id: clientId },
      })
      await load()
    } else {
      const { error: e } = await supabase.from('clients').update({ portal_enabled: next }).eq('id', clientId)
      if (e) {
        setError(e.message)
        setPortalEnabled(prev)
      } else {
        setClient(c => c ? { ...c, portal_enabled: next } : c)
        await logClientEvent(supabase, {
          companyId: client.company_id,
          screen: 'HrClientDetails',
          action: next ? 'client_portal_enabled' : 'client_portal_disabled',
          meta: { client_id: clientId },
        })
      }
    }
    setIsBusy(false)
  }

  async function addSite() {
    if (!canEdit || !client) return
    if (!siteName.trim()) { setError('Site name is required.'); return }
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('sites').insert({
      company_id: client.company_id,
      client_id: clientId,
      name: siteName.trim(),
      address: siteAddress.trim() || null,
    })
    if (e) {
      setError(e.message)
    } else {
      await logClientEvent(supabase, {
        companyId: client.company_id,
        screen: 'HrClientDetails',
        action: 'client_site_added',
        meta: { client_id: clientId, site_name: siteName.trim() },
      })
      setSiteName('')
      setSiteAddress('')
      setAddingSite(false)
      const { data } = await supabase.from('sites').select('*').eq('client_id', clientId)
      setSites((data ?? []) as Site[])
    }
    setIsBusy(false)
  }

  async function uploadClientDocument(file: File) {
    if (!canEdit || !client) return
    setDocBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('Account not linked to an active employee.')
      setDocBusy(false)
      return
    }
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
    const path = `client_documents/${client.company_id}/${clientId}/hr_${crypto.randomUUID()}${ext}`
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (upErr) {
      setError(upErr.message)
      setDocBusy(false)
      return
    }
    const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(path)
    const { error: insErr } = await supabase.from('client_documents').insert({
      company_id: client.company_id,
      client_id: clientId,
      document_name: file.name,
      document_type: uploadDocType || 'other',
      file_url: pub.publicUrl,
      storage_path: path,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_by: member.employeeId,
    })
    if (insErr) {
      setError(insErr.message)
    } else {
      await logClientEvent(supabase, {
        companyId: client.company_id,
        screen: 'HrClientDetails',
        action: 'client_document_uploaded',
        meta: {
          client_id: clientId,
          document_name: file.name,
          document_type: uploadDocType || 'other',
        },
      })
      setClientDocs(await loadClientDocuments(supabase))
    }
    if (fileRef.current) fileRef.current.value = ''
    setDocBusy(false)
  }

  async function deleteClientDocument(doc: ClientDocument) {
    if (!canEdit || !client) return
    if (!window.confirm(`Delete "${doc.document_name}"?`)) return
    setError(null)
    const supabase = createClient()
    if (doc.storage_path) {
      await supabase.storage.from('workforce-media').remove([doc.storage_path])
    }
    const { error: e } = await supabase.from('client_documents').delete().eq('id', doc.id)
    if (e) {
      setError(e.message)
      return
    }
    await logClientEvent(supabase, {
      companyId: client.company_id,
      screen: 'HrClientDetails',
      action: 'client_document_deleted',
      meta: {
        client_id: clientId,
        document_name: doc.document_name,
        document_type: doc.document_type,
      },
    })
    setClientDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  async function addNote() {
    if (!canEdit || !client) return
    const body = noteDraft.trim()
    if (!body) { setError('Note text is required.'); return }
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setError('Account not linked to an active employee.')
      setIsBusy(false)
      return
    }
    const { error: e } = await supabase.from('client_notes').insert({
      company_id: client.company_id,
      client_id: clientId,
      body,
      created_by: member.employeeId,
    })
    if (e) {
      setError(e.message)
    } else {
      await logClientEvent(supabase, {
        companyId: client.company_id,
        screen: 'HrClientDetails',
        action: 'client_note_added',
        meta: { client_id: clientId, description: body.slice(0, 120) },
      })
      setNoteDraft('')
      setTimelineNotes(await loadTimelineNotes(supabase))
    }
    setIsBusy(false)
  }

  async function deleteNote(note: ClientNote) {
    if (!canEdit || !client) return
    if (!window.confirm('Delete this note?')) return
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('client_notes').delete().eq('id', note.id)
    if (e) {
      setError(e.message)
      return
    }
    setTimelineNotes(prev => prev.filter(n => n.id !== note.id))
  }

  async function updateProjectStatus(p: Project, newStatus: string) {
    if (!canEdit) return
    const from = p.status ?? 'draft'
    if (from === newStatus) return
    const supabase = createClient()
    const { error: statusErr } = await supabase.from('client_deals').update({ status: newStatus }).eq('id', p.id)
    if (statusErr) { setError(statusErr.message); return }
    await supabase.from('client_deal_updates').insert({
      deal_id: p.id,
      company_id: p.company_id,
      body: `Moved to ${newStatus.replace(/_/g, ' ')}`,
      status_from: from,
      status_to: newStatus,
    })
    setProjects(prev => prev.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
  }

  function onBoardDrop(e: DragEvent, stage: string) {
    e.preventDefault()
    if (!canEdit) return
    const id = e.dataTransfer.getData('text/project-id')
    if (!id) return
    const project = projects.find(p => p.id === id)
    if (project) void updateProjectStatus(project, stage)
  }

  async function copyCredentials() {
    const code = client?.client_code
    if (!code) return
    const text = `Company Code: ${companyCode}\nClient Code: ${code}`
    try {
      await navigator.clipboard.writeText(text)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      setError('Could not copy portal credentials to clipboard.')
    }
  }

  async function turnQuoteIntoInvoice(quoteId: string) {
    if (!client || !canEdit) return
    setQuoteBusyId(quoteId)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    const result = await createInvoiceFromAcceptedQuote(supabase, {
      companyId: client.company_id,
      clientId: client.id,
      quoteId,
      employeeId: member?.employeeId ?? null,
    })
    setQuoteBusyId(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.push(`/dashboard/money/invoices/${result.invoiceId}`)
  }

  function selectTab(t: ClientTab) {
    setTab(t)
    if (!isNew) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', t)
      router.replace(`/dashboard/clients/${clientId}?${params.toString()}`, { scroll: false })
    }
  }

  async function openMedia(fileUrl: string | null | undefined, storagePath?: string | null) {
    const path = mediaPath(fileUrl, storagePath)
    if (!path) { setError('This file has no storage path.'); return }
    setError(null)
    const supabase = createClient()
    const { data, error: e } = await supabase.storage.from('workforce-media').createSignedUrl(path, 300)
    if (e || !data?.signedUrl) {
      setError(e?.message ?? 'Could not open the file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function saveSite(site: Site) {
    if (!canEdit || !client) return
    if (!editSiteName.trim()) { setError('Site name is required.'); return }
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const address = editSiteAddress.trim() || null
    const { error: e } = await supabase.from('sites').update({
      name: editSiteName.trim(),
      address,
    }).eq('id', site.id).eq('company_id', client.company_id)
    if (e) {
      setError(e.message)
    } else {
      setSites(prev => prev.map(s => s.id === site.id ? { ...s, name: editSiteName.trim(), address } : s))
      setEditingSiteId(null)
    }
    setIsBusy(false)
  }

  async function saveCommercialProfile() {
    if (!canEdit || !client) return
    setCommercialSaving(true)
    setCommercialMsg(null)
    const supabase = createClient()
    const payload = {
      payment_terms_days: client.payment_terms_days ?? 30,
      credit_limit: client.credit_limit ?? 0,
      vat_number: client.vat_number?.trim() || null,
      billing_address: client.billing_address?.trim() || null,
      tax_exempt: Boolean(client.tax_exempt),
    }
    const { error: e } = await supabase.from('clients').update(payload).eq('id', client.id)
    if (e) {
      setCommercialMsg(e.message)
    } else {
      setClient(prev => prev ? { ...prev, ...payload } : prev)
      await logClientEvent(supabase, {
        companyId: client.company_id,
        screen: 'HrClientDetails',
        action: 'client_profile_updated',
        meta: { client_id: client.id, description: 'Commercial profile' },
      })
      setCommercialMsg('Commercial profile saved.')
    }
    setCommercialSaving(false)
  }

  async function deleteSite(site: Site) {
    if (!canEdit || !client) return
    if (!window.confirm(`Remove site "${site.name}"?`)) return
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('sites').delete().eq('id', site.id).eq('company_id', client.company_id)
    if (e) {
      setError(e.message)
    } else {
      setSites(prev => prev.filter(s => s.id !== site.id))
      if (editingSiteId === site.id) setEditingSiteId(null)
    }
    setIsBusy(false)
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-divider bg-surface">
          <Link href="/dashboard/clients" aria-label="Back to clients" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <span className="text-text-secondary text-[13px]">Loading…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/clients" aria-label="Back to clients" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-[20px] font-semibold text-text-primary">{name || 'New Client'}</h1>
            {!isNew && xeroConnected && (
              <div className="flex items-center gap-2 mt-1">
                {xeroLink ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-[12px] text-green-400">
                      <span className="text-[14px]">✓</span> Synced to Xero
                    </span>
                    <span className="text-text-disabled text-[11px]">
                      {new Date(xeroLink.last_synced_at).toLocaleDateString()}
                    </span>
                    <button onClick={pushToXero} disabled={xeroPushing || !canEdit}
                      className="text-[11px] text-[#13B5EA] hover:opacity-70 disabled:opacity-40">
                      Update in Xero
                    </button>
                  </>
                ) : (
                  <button onClick={pushToXero} disabled={xeroPushing || !canEdit}
                    className="inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors">
                    {xeroPushing ? 'Pushing…' : '+ Push to Xero'}
                  </button>
                )}
              </div>
            )}
            {xeroMsg && (
              <p className={`text-[11px] mt-1 ${
                xeroMsg.includes('Synced') ? 'text-green-400' : 'text-error'
              }`}>
                {xeroMsg}
                <button type="button" onClick={() => setXeroMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
              </p>
            )}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || !canEdit}
          title={!canEdit ? 'You do not have permission to edit clients' : undefined}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[96px]"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      {showRelatedTabs && (
        <div className="flex flex-wrap gap-2 mx-4 my-2 shrink-0 overflow-x-auto">
          {CLIENT_TABS.map(t => (
            <button key={t} onClick={() => selectTab(t)}
              className={`h-[38px] px-3 rounded-[10px] text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 border ${tab === t ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:text-text-primary'}`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 pr-5 space-y-4 [scrollbar-gutter:stable]">

        {(isNew || tab === 'info') && (
          <>
            {!isNew && client?.company_id && (
              <ClientPortalChangesBanner
                companyId={client.company_id}
                clientId={clientId}
                onOpenActivity={() => selectTab('activity')}
              />
            )}
            <div className="card p-4 space-y-3">
              <p className="section-label">CLIENT DETAILS</p>
              <input placeholder="Client / company name *" value={name} onChange={e => setName(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <select value={clientType} onChange={e => setClientType(e.target.value)}
                disabled={!canEdit}
                className="dark-entry appearance-none">
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>)}
              </select>
              {hasClientCode && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-text-primary font-semibold text-[14px]">Code: {client?.client_code}</span>
                  <span className="text-text-secondary text-[11px]">auto-generated</span>
                </div>
              )}
              <input placeholder="Primary contact" value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <div className="grid grid-cols-2 gap-3">
                <input type="tel" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
                <input type="tel" placeholder="Mobile" value={mobile} onChange={e => setMobile(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
                <input type="tel" placeholder="Direct line" value={directLine} onChange={e => setDirectLine(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
                <input type="tel" placeholder="Fax" value={fax} onChange={e => setFax(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
              </div>
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <input placeholder="Address" value={address} onChange={e => setAddress(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)}
                disabled={!canEdit}
                rows={3} className="dark-entry min-h-[72px] py-3 resize-none" />
            </div>

            <div className="card p-4 space-y-3">
              <p className="section-label">ACCOUNT</p>
              <input placeholder="Customer account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <input placeholder="Legal name" value={legalName} onChange={e => setLegalName(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Company number" value={companyNumber} onChange={e => setCompanyNumber(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
                <input placeholder="Website" value={website} onChange={e => setWebsite(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
              </div>
            </div>

            <div className="card p-4 space-y-3">
              <p className="section-label">BANK DETAILS</p>
              {canEdit ? (
                <>
                  <p className="text-[12px] text-text-secondary">
                    Used when a refund has to be paid to this client. The client list does not show these details.
                  </p>
                  <input placeholder="Account holder" value={bankHolder} onChange={e => setBankHolder(e.target.value)}
                    className="dark-entry" autoComplete="off" />
                  <input placeholder="Bank name" value={bankName} onChange={e => setBankName(e.target.value)}
                    className="dark-entry" autoComplete="off" />
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="Account number" value={bankAccount} onChange={e => setBankAccount(e.target.value)}
                      className="dark-entry" autoComplete="off" />
                    <input placeholder="Branch code" value={bankBranch} onChange={e => setBankBranch(e.target.value)}
                      className="dark-entry" autoComplete="off" />
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-text-secondary">
                  Bank details for refunds are visible to people who can edit clients.
                </p>
              )}
            </div>

            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="section-label">EXTRA PEOPLE</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setExtraPeople(prev => [...prev, {
                      key: crypto.randomUUID(),
                      id: null,
                      name: '',
                      email: '',
                      includeInEmails: false,
                    }])}
                    className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity"
                  >
                    + Person
                  </button>
                )}
              </div>
              <p className="text-[12px] text-text-secondary">
                People besides the primary contact. Save the client to keep them.
              </p>
              {extraPeople.length === 0 ? (
                <p className="text-text-secondary text-[13px]">No extra people.</p>
              ) : (
                <div className="space-y-3">
                  {extraPeople.map(person => (
                    <div key={person.key} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                      <input
                        placeholder="Name"
                        value={person.name}
                        disabled={!canEdit}
                        onChange={e => setExtraPeople(prev => prev.map(row => row.key === person.key ? { ...row, name: e.target.value } : row))}
                        className="dark-entry"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={person.email}
                        disabled={!canEdit}
                        onChange={e => setExtraPeople(prev => prev.map(row => row.key === person.key ? { ...row, email: e.target.value } : row))}
                        className="dark-entry"
                      />
                      <label className="flex items-center gap-2 text-[12px] text-text-secondary whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={person.includeInEmails}
                          disabled={!canEdit}
                          onChange={e => setExtraPeople(prev => prev.map(row => row.key === person.key ? { ...row, includeInEmails: e.target.checked } : row))}
                        />
                        Include in emails
                      </label>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setExtraPeople(prev => prev.filter(row => row.key !== person.key))}
                          className="text-error text-[12px] font-medium hover:opacity-70"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4 space-y-3">
              <p className="section-label">CLIENT PORTAL</p>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-[14px] font-medium text-text-primary">Portal user</p>
                  <p className="text-[12px] text-text-secondary">
                    Enables client portal login with company code + permanent client code.
                  </p>
                </div>
                <Toggle
                  checked={portalEnabled}
                  onChange={handlePortalToggle}
                  disabled={!canEdit || isBusy}
                />
              </div>
              {hasClientCode && (
                <>
                  <input readOnly value={companyCode} placeholder="Company code"
                    className="dark-entry text-text-secondary cursor-default" />
                  <input readOnly value={client?.client_code ?? ''}
                    className="dark-entry text-text-secondary cursor-default" />
                  <button
                    type="button"
                    onClick={() => void copyCredentials()}
                    disabled={!client?.client_code}
                    className="w-full h-[42px] rounded-sm bg-surface-elevated border border-border text-text-primary text-[12px] hover:bg-background transition-colors disabled:opacity-40"
                  >
                    {codeCopied ? 'Copied' : 'Copy portal login credentials'}
                  </button>
                  <p className="text-text-secondary text-[11px]">
                    Permanent login code (assigned once). Codes do not expire.
                    Disable Portal user to revoke access without changing the code.
                  </p>
                </>
              )}
              {!hasClientCode && portalEnabled && !isNew && (
                <p className="text-[12px] text-text-secondary">Assigning portal code…</p>
              )}
              {!hasClientCode && !portalEnabled && (
                <p className="text-[11px] text-text-secondary">
                  Enable Portal user to assign a permanent code (same format as create: C…).
                  Codes do not expire — disable Portal user to revoke access.
                </p>
              )}
            </div>

            {showRelatedTabs && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="section-label">SITES</p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setAddingSite(v => !v)}
                      className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity"
                    >
                      {addingSite ? 'Cancel' : '+ Site'}
                    </button>
                  )}
                </div>
                {addingSite && canEdit && (
                  <div className="card p-3 space-y-2">
                    <input
                      placeholder="Site name *"
                      value={siteName}
                      onChange={e => setSiteName(e.target.value)}
                      className="dark-entry"
                    />
                    <input
                      placeholder="Address (optional)"
                      value={siteAddress}
                      onChange={e => setSiteAddress(e.target.value)}
                      className="dark-entry"
                    />
                    <button
                      type="button"
                      disabled={isBusy || !siteName.trim()}
                      onClick={() => void addSite()}
                      className="h-9 px-3 rounded-lg bg-primary text-white text-[12px] font-medium disabled:opacity-50"
                    >
                      {isBusy ? 'Saving…' : 'Add site'}
                    </button>
                  </div>
                )}
                <div className="card overflow-hidden" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {sites.length === 0 ? (
                    <p className="text-text-secondary text-[13px] p-4">No sites.</p>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {sites.map(s => (
                          <tr key={s.id} className="border-b border-divider last:border-0">
                            {editingSiteId === s.id ? (
                              <td className="data-td" colSpan={2}>
                                <div className="space-y-2 py-1">
                                  <input value={editSiteName} onChange={e => setEditSiteName(e.target.value)} className="dark-entry" />
                                  <input value={editSiteAddress} onChange={e => setEditSiteAddress(e.target.value)} placeholder="Address" className="dark-entry" />
                                  <div className="flex gap-2">
                                    <button type="button" disabled={isBusy || !editSiteName.trim()} onClick={() => void saveSite(s)} className="h-8 px-3 rounded-lg bg-primary text-white text-[12px] disabled:opacity-50">Save</button>
                                    <button type="button" onClick={() => setEditingSiteId(null)} className="h-8 px-3 text-[12px] text-text-secondary">Cancel</button>
                                  </div>
                                </div>
                              </td>
                            ) : (
                              <>
                                <td className="data-td text-text-primary text-[13px]">{s.name}</td>
                                <td className="data-td text-text-secondary text-[12px]">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate">{s.address ?? '—'}</span>
                                    {canEdit && (
                                      <span className="shrink-0 flex gap-3">
                                        <button type="button" className="text-primary text-[11px] font-medium" onClick={() => { setEditingSiteId(s.id); setEditSiteName(s.name); setEditSiteAddress(s.address ?? '') }}>Edit</button>
                                        <button type="button" className="text-error text-[11px] font-medium" onClick={() => void deleteSite(s)}>Remove</button>
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {showRelatedTabs && tab === 'projects' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">PROJECTS (CRM)</p>
              {canEdit && (
                <button onClick={() => router.push(`/dashboard/projects/new?clientId=${clientId}`)}
                  className="btn-primary h-9 px-[14px] text-[13px]">+ Project</button>
              )}
            </div>
            <div className="flex gap-2">
              {(['table', 'board'] as const).map(v => (
                <button key={v} onClick={() => setProjectView(v)}
                  className={`rounded-lg h-8 px-[10px] text-[11px] transition-colors border ${projectView === v ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border'}`}>
                  {v === 'table' ? 'Table' : 'Board'}
                </button>
              ))}
            </div>

            {projectView === 'board' ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {BOARD_STAGES.map(stage => {
                  const sc = PROJECT_STATUS_COLORS[stage] ?? PROJECT_STATUS_COLORS.draft
                  const column = projects.filter(p => (p.status ?? 'draft') === stage)
                  return (
                    <div
                      key={stage}
                      className="shrink-0 w-[220px] bg-surface-elevated rounded-lg border border-divider p-2 min-h-[280px]"
                      onDragOver={e => { if (canEdit) e.preventDefault() }}
                      onDrop={e => onBoardDrop(e, stage)}
                    >
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: sc.fg }}>
                          {stage.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] text-text-secondary">{column.length}</span>
                      </div>
                      <div className="space-y-2">
                        {column.map(p => (
                          <div
                            key={p.id}
                            id={`client-project-${p.id}`}
                            draggable={canEdit}
                            onDragStart={e => e.dataTransfer.setData('text/project-id', p.id)}
                            className={`card p-2.5 cursor-grab active:cursor-grabbing space-y-1.5 ${focusId === p.id ? 'ring-2 ring-primary' : ''}`}
                          >
                            <button
                              onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                              className="text-left text-[13px] font-medium text-text-primary hover:text-primary w-full"
                            >
                              {p.title}
                            </button>
                            <p className="text-[11px] text-text-secondary font-mono">{p.project_code ?? '—'}</p>
                            <p className="text-[11px] text-text-secondary">{fmtCurrency(p.offer_amount)}</p>
                            <select
                              value={p.status ?? 'draft'}
                              onChange={e => updateProjectStatus(p, e.target.value)}
                              disabled={!canEdit}
                              className="w-full text-[11px] h-7 px-1.5 rounded border border-border bg-surface"
                            >
                              {PROJECT_STATUS_OPTIONS.map(s => (
                                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                        {column.length === 0 && (
                          <p className="text-[11px] text-text-disabled px-1 py-4 text-center">Drop here</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
                <table style={{ minWidth: 520 }} className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th style={{ width: 90 }} className="data-th">Code</th>
                      <th className="data-th">Project</th>
                      <th style={{ width: 120 }} className="data-th">Status</th>
                      <th style={{ width: 80 }} className="data-th text-right">Offer</th>
                      <th style={{ width: 72 }} className="data-th text-center">Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.length === 0 ? (
                      <tr><td colSpan={5} className="text-text-secondary text-center py-6 text-[13px]">No projects for this client.</td></tr>
                    ) : (
                      projects.map(p => {
                        const sc = PROJECT_STATUS_COLORS[p.status ?? 'draft'] ?? PROJECT_STATUS_COLORS.draft
                        return (
                          <tr key={p.id} id={`client-project-${p.id}`}
                            className={`bg-surface border-b border-divider last:border-0 ${focusId === p.id ? 'ring-2 ring-inset ring-primary' : ''}`}>
                            <td className="data-td">
                              <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                                className="text-text-primary text-[12px] font-medium hover:text-primary transition-colors">
                                {p.project_code ?? '—'}
                              </button>
                            </td>
                            <td className="data-td">
                              <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                                className="text-left text-text-primary text-[13px] truncate w-full hover:text-primary transition-colors">
                                {p.title}
                              </button>
                            </td>
                            <td className="data-td">
                              <select value={p.status ?? 'draft'} onChange={e => updateProjectStatus(p, e.target.value)}
                                disabled={!canEdit}
                                className="text-[11px] h-8 px-2 rounded-lg border border-border bg-surface focus:outline-none w-full"
                                style={{ color: sc.fg }}>
                                {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                              </select>
                            </td>
                            <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.offer_amount)}</td>
                            <td className="data-td text-center">
                              <button
                                onClick={() => router.push(`/dashboard/projects/${p.id}?tab=payments`)}
                                className="bg-primary text-white rounded-lg h-7 px-2 text-[10px] font-medium"
                              >
                                + Pay
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {showRelatedTabs && tab === 'jobs' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">JOBS</p>
              {canEdit && (
                <button onClick={() => router.push(`/dashboard/jobs/new?clientId=${clientId}`)}
                  className="btn-primary h-9 px-[14px] text-[13px]">+ Job</button>
              )}
            </div>
            <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
              <table style={{ minWidth: 640 }} className="w-full">
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th style={{ width: 90 }} className="data-th">Code</th>
                    <th className="data-th">Title</th>
                    <th style={{ width: 110 }} className="data-th text-center">Status</th>
                    <th style={{ width: 100 }} className="data-th">Project</th>
                    <th style={{ width: 120 }} className="data-th">Assignee</th>
                    <th style={{ width: 64 }} className="data-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {clientJobs.length === 0 ? (
                    <tr><td colSpan={6} className="text-text-secondary text-center py-6 text-[13px]">No jobs for this client.</td></tr>
                  ) : (
                    clientJobs.map(j => {
                      const sc = JOB_STATUS_COLORS[j.status] ?? { bg: '#E5E7EB', fg: '#6B7280' }
                      return (
                        <tr key={j.id} className="bg-surface border-b border-divider last:border-0">
                          <td className="data-td text-text-secondary font-mono text-[12px]">{j.job_code ?? '—'}</td>
                          <td className="data-td text-text-primary text-[13px] truncate">{j.title}</td>
                          <td className="data-td text-center">
                            <StatusBadge label={j.status.replace('_', ' ')} bg={sc.bg} fg={sc.fg} />
                          </td>
                          <td className="data-td text-text-secondary text-[12px] font-mono">{j.project_code ?? '—'}</td>
                          <td className="data-td text-text-secondary text-[12px] truncate">{j.assignee_name ?? '—'}</td>
                          <td className="data-td">
                            <button onClick={() => router.push(`/dashboard/jobs/${j.id}`)}
                              className="text-primary text-[11px] font-medium h-[30px]">Open →</button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showRelatedTabs && tab === 'quotes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">QUOTES</p>
              {canEdit && (
                <button onClick={() => router.push('/dashboard/money/quotes/new')}
                  className="btn-primary h-9 px-[14px] text-[13px]">+ Quote</button>
              )}
            </div>
            <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
              <table style={{ minWidth: 760 }} className="w-full">
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th">Number</th>
                    <th className="data-th">Title</th>
                    <th style={{ width: 110 }} className="data-th">Status</th>
                    <th style={{ width: 130 }} className="data-th">Client answer</th>
                    <th style={{ width: 100 }} className="data-th text-right">Amount</th>
                    <th style={{ width: 150 }} className="data-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {clientQuotes.length === 0 ? (
                    <tr><td colSpan={6} className="text-text-secondary text-center py-6 text-[13px]">No quotes for this client.</td></tr>
                  ) : clientQuotes.map(quote => {
                    const deal = projects.find(project => project.id === quote.deal_id)
                    const answer = deal?.quotation_response === 'accepted'
                      ? 'Accepted'
                      : deal?.quotation_response === 'revision_requested'
                        ? 'Revision asked'
                        : 'Waiting'
                    const existingInvoice = invoices.find(invoice => invoice.quote_id === quote.id)
                    return (
                      <tr key={quote.id} className="bg-surface border-b border-divider last:border-0">
                        <td
                          className="data-td text-primary text-[13px] font-medium cursor-pointer"
                          onClick={() => router.push(`/dashboard/money/quotes/${quote.id}`)}
                        >
                          {quote.quote_number || 'Quote'}
                        </td>
                        <td className="data-td text-text-primary text-[13px]">{quote.title}</td>
                        <td className="data-td text-text-secondary text-[12px] capitalize">{quote.status.replace(/_/g, ' ')}</td>
                        <td className="data-td text-text-secondary text-[12px]">{quote.deal_id ? answer : '—'}</td>
                        <td className="data-td text-text-secondary text-[12px] text-right">{fmtMoney(quote.total_amount)}</td>
                        <td className="data-td text-right">
                          {existingInvoice ? (
                            <button
                              type="button"
                              onClick={() => router.push(`/dashboard/money/invoices/${existingInvoice.id}`)}
                              className="text-primary text-[12px] font-medium"
                            >
                              Open invoice
                            </button>
                          ) : canEdit && answer === 'Accepted' ? (
                            <button
                              type="button"
                              disabled={quoteBusyId === quote.id}
                              onClick={() => void turnQuoteIntoInvoice(quote.id)}
                              className="text-primary text-[12px] font-medium disabled:opacity-50"
                            >
                              {quoteBusyId === quote.id ? 'Creating…' : 'Turn into invoice'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showRelatedTabs && tab === 'invoices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">INVOICES</p>
              {canEdit && (
                <button onClick={() => router.push(`/dashboard/money/invoices/new?clientId=${clientId}`)}
                  className="btn-primary h-9 px-[14px] text-[13px]">+ Invoice</button>
              )}
            </div>
            <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
              <table style={{ minWidth: 640 }} className="w-full">
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th">Number</th>
                    <th style={{ width: 100 }} className="data-th text-center">Status</th>
                    <th style={{ width: 100 }} className="data-th">Issue</th>
                    <th style={{ width: 100 }} className="data-th">Due</th>
                    <th style={{ width: 90 }} className="data-th text-right">Total</th>
                    <th style={{ width: 90 }} className="data-th text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={6} className="text-text-secondary text-center py-6 text-[13px]">No invoices for this client.</td></tr>
                  ) : (
                    invoices.map(inv => {
                      const sc = INVOICE_STATUS_COLORS[inv.status] ?? INVOICE_STATUS_COLORS.draft
                      return (
                        <tr
                          key={inv.id}
                          id={`client-invoice-${inv.id}`}
                          onClick={() => router.push(`/dashboard/money/invoices/${inv.id}`)}
                          className={`bg-surface hover:bg-background cursor-pointer border-b border-divider last:border-0 ${focusId === inv.id ? 'ring-2 ring-inset ring-primary' : ''}`}
                        >
                          <td className="data-td text-text-primary text-[13px] font-medium">{inv.invoice_number || '(draft)'}</td>
                          <td className="data-td text-center">
                            <StatusBadge label={inv.status.replace(/_/g, ' ')} bg={sc.bg} fg={sc.fg} />
                          </td>
                          <td className="data-td text-text-secondary text-[12px]">{inv.issue_date ?? '—'}</td>
                          <td className="data-td text-text-secondary text-[12px]">{inv.due_date ?? '—'}</td>
                          <td className="data-td text-text-secondary text-[12px] text-right">{fmtMoney(inv.total_amount)}</td>
                          <td className="data-td text-text-secondary text-[12px] text-right">{fmtMoney(inv.balance_due)}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showRelatedTabs && tab === 'documents' && (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="section-label">CLIENT DOCUMENTS</p>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <select
                      value={uploadDocType}
                      onChange={e => setUploadDocType(e.target.value)}
                      className="text-[11px] h-[34px] px-2 rounded-lg border border-border bg-surface text-text-secondary"
                    >
                      {DOC_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) void uploadClientDocument(file)
                      }}
                    />
                    <button
                      type="button"
                      disabled={docBusy}
                      onClick={() => fileRef.current?.click()}
                      className="btn-primary h-[34px] px-[14px] text-[12px] disabled:opacity-50"
                    >
                      {docBusy ? 'Uploading…' : '+ Upload'}
                    </button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
                <table style={{ minWidth: 520 }} className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th">Name</th>
                      <th style={{ width: 120 }} className="data-th">Type</th>
                      <th style={{ width: 110 }} className="data-th">Date</th>
                      <th style={{ width: 64 }} className="data-th"></th>
                      {canEdit && <th style={{ width: 64 }} className="data-th"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {clientDocs.length === 0 ? (
                      <tr>
                        <td colSpan={canEdit ? 5 : 4} className="text-text-secondary text-center py-6 text-[13px]">
                          No client documents yet.
                        </td>
                      </tr>
                    ) : (
                      clientDocs.map(d => (
                        <tr key={d.id} className="bg-surface border-b border-divider last:border-0">
                          <td className="data-td text-text-primary text-[13px] truncate">{d.document_name}</td>
                          <td className="data-td text-text-secondary text-[12px]">{docTypeLabel(d.document_type)}</td>
                          <td className="data-td text-text-secondary text-[12px]">
                            {d.created_at ? new Date(d.created_at).toLocaleDateString('en-ZA') : '—'}
                          </td>
                          <td className="data-td">
                            {d.file_url || d.storage_path ? (
                              <button type="button" onClick={() => void openMedia(d.file_url, d.storage_path)}
                                className="text-primary text-[11px] font-medium h-[30px] inline-flex items-center">
                                Open →
                              </button>
                            ) : (
                              <span className="text-text-disabled text-[11px]">—</span>
                            )}
                          </td>
                          {canEdit && (
                            <td className="data-td">
                              <button
                                type="button"
                                onClick={() => void deleteClientDocument(d)}
                                className="text-error text-[11px] font-medium h-[30px] inline-flex items-center hover:opacity-70"
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {client && (
              <ClientDocumentRequests clientId={clientId} companyId={client.company_id} canEdit={canEdit} />
            )}

            <div className="space-y-3">
              <p className="section-label">FROM PROJECTS</p>
              <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
                <table style={{ minWidth: 520 }} className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th">Name</th>
                      <th style={{ width: 100 }} className="data-th">Type</th>
                      <th style={{ width: 140 }} className="data-th">Project</th>
                      <th style={{ width: 64 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectDocs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-text-secondary text-center py-6 text-[13px]">
                          No project documents for this client.
                        </td>
                      </tr>
                    ) : (
                      projectDocs.map(d => (
                        <tr key={d.id} className="bg-surface border-b border-divider last:border-0">
                          <td className="data-td text-text-primary text-[13px] truncate">{d.document_name}</td>
                          <td className="data-td text-text-secondary text-[12px]">{d.document_type ?? '—'}</td>
                          <td className="data-td text-text-secondary text-[12px] truncate">{d.project_title ?? '—'}</td>
                          <td className="data-td">
                            {d.file_url ? (
                              <button type="button" onClick={() => void openMedia(d.file_url)}
                                className="text-primary text-[11px] font-medium h-[30px] inline-flex items-center">
                                Open →
                              </button>
                            ) : (
                              <span className="text-text-disabled text-[11px]">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {showRelatedTabs && tab === 'notes' && (
          <div className="space-y-4">
            <p className="section-label">TIMELINE NOTES</p>
            {canEdit && (
              <div className="card p-4 space-y-3">
                <textarea
                  placeholder="Add a note…"
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  rows={3}
                  className="dark-entry min-h-[72px] py-3 resize-none"
                />
                <button
                  type="button"
                  disabled={isBusy || !noteDraft.trim()}
                  onClick={() => void addNote()}
                  className="btn-primary h-[38px] px-4 text-[13px] disabled:opacity-50"
                >
                  {isBusy ? 'Adding…' : 'Add note'}
                </button>
              </div>
            )}
            {timelineNotes.length === 0 ? (
              <p className="text-text-secondary text-[13px] py-6 text-center">No timeline notes yet.</p>
            ) : (
              <div className="space-y-2">
                {timelineNotes.map(n => (
                  <div key={n.id} className="card p-3 space-y-1">
                    <p className="text-[13px] text-text-primary whitespace-pre-wrap">{n.body}</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-text-secondary">
                        {n.author_name || '—'} · {new Date(n.created_at).toLocaleString('en-ZA')}
                      </p>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void deleteNote(n)}
                          className="text-error text-[11px] font-medium hover:opacity-70"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showRelatedTabs && tab === 'activity' && client && (
          <ClientActivityTab companyId={client.company_id} clientId={clientId} />
        )}

        {showRelatedTabs && tab === 'commercial' && client && (
          <div className="space-y-6 p-4">
            {/* Commercial Profile card */}
            <div className="bg-surface rounded-xl border border-divider p-4 space-y-3">
              <h3 className="text-[14px] font-semibold text-text-primary">Commercial Profile</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">Payment Terms (days)</span>
                  <input type="number" value={client.payment_terms_days ?? 30}
                    onChange={e => setClient(prev => prev ? { ...prev, payment_terms_days: Number(e.target.value) } : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">Credit Limit (R)</span>
                  <input type="number" value={client.credit_limit ?? 0}
                    onChange={e => setClient(prev => prev ? { ...prev, credit_limit: Number(e.target.value) } : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">VAT Number</span>
                  <input type="text" value={client.vat_number ?? ''}
                    onChange={e => setClient(prev => prev ? { ...prev, vat_number: e.target.value } : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">Billing Address</span>
                  <input type="text" value={client.billing_address ?? ''}
                    onChange={e => setClient(prev => prev ? { ...prev, billing_address: e.target.value } : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={client.tax_exempt ?? false}
                  onChange={e => setClient(prev => prev ? { ...prev, tax_exempt: e.target.checked } : prev)} />
                Tax Exempt
              </label>
              <button
                type="button"
                disabled={!canEdit || commercialSaving}
                onClick={() => void saveCommercialProfile()}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {commercialSaving ? 'Saving…' : 'Save Commercial Profile'}
              </button>
              {commercialMsg && (
                <p className={`text-[12px] ${commercialMsg === 'Commercial profile saved.' ? 'text-green-400' : 'text-error'}`}>{commercialMsg}</p>
              )}
            </div>

            {commercialLoading && <p className="text-[13px] text-text-secondary">Loading…</p>}

            {commercialData && (
              <>
                {/* Quote History */}
                <div className="bg-surface rounded-xl border border-divider overflow-hidden">
                  <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-text-primary">Quote History</h3>
                    <a href={`/dashboard/money/quotes?client=${client?.id}`} className="text-[12px] text-primary">View all →</a>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-elevated border-b border-divider">
                        <th className="data-th">Quote #</th>
                        <th className="data-th">Title</th>
                        <th className="data-th">Status</th>
                        <th className="data-th text-right">Amount</th>
                        <th className="data-th">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commercialData.quotes.length === 0 ? (
                        <tr><td colSpan={5} className="data-td text-center text-text-secondary">No quotes</td></tr>
                      ) : commercialData.quotes.map(q => (
                        <tr key={q.id} className="border-b border-divider hover:bg-background cursor-pointer"
                          onClick={() => router.push(`/dashboard/money/quotes/${q.id}`)}>
                          <td className="data-td font-medium">{q.quote_number ?? '—'}</td>
                          <td className="data-td">{q.title}</td>
                          <td className="data-td capitalize">{q.status.replace(/_/g, ' ')}</td>
                          <td className="data-td text-right">{fmtMoney(q.total_amount)}</td>
                          <td className="data-td text-text-secondary">{q.created_at.split('T')[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Invoice History */}
                <div className="bg-surface rounded-xl border border-divider overflow-hidden">
                  <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-text-primary">Invoice History</h3>
                    <a href={`/dashboard/money/invoices?client=${client?.id}`} className="text-[12px] text-primary">View all →</a>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-elevated border-b border-divider">
                        <th className="data-th">Invoice #</th>
                        <th className="data-th">Status</th>
                        <th className="data-th text-right">Total</th>
                        <th className="data-th text-right">Balance</th>
                        <th className="data-th">Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commercialData.invoices.length === 0 ? (
                        <tr><td colSpan={5} className="data-td text-center text-text-secondary">No invoices</td></tr>
                      ) : commercialData.invoices.map(inv => (
                        <tr key={inv.id} className="border-b border-divider hover:bg-background cursor-pointer"
                          onClick={() => router.push(`/dashboard/money/invoices/${inv.id}`)}>
                          <td className="data-td font-medium">{inv.invoice_number ?? '—'}</td>
                          <td className="data-td capitalize">{inv.status.replace(/_/g, ' ')}</td>
                          <td className="data-td text-right">{fmtMoney(inv.total_amount)}</td>
                          <td className="data-td text-right">{fmtMoney(inv.balance_due)}</td>
                          <td className="data-td text-text-secondary">{inv.issue_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Customer Ledger */}
                <div className="bg-surface rounded-xl border border-divider overflow-hidden">
                  <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-text-primary">Customer Ledger</h3>
                    <span className="text-[13px] font-medium text-text-primary">
                      Outstanding: {fmtMoney(commercialData.outstanding)}
                    </span>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-elevated border-b border-divider">
                        <th className="data-th">Date</th>
                        <th className="data-th">Type</th>
                        <th className="data-th">Reference</th>
                        <th className="data-th">Description</th>
                        <th className="data-th text-right">Debit</th>
                        <th className="data-th text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commercialData.ledger.length === 0 ? (
                        <tr><td colSpan={6} className="data-td text-center text-text-secondary">No ledger entries</td></tr>
                      ) : commercialData.ledger.map(e => (
                        <tr key={e.id} className="border-b border-divider">
                          <td className="data-td text-text-secondary">{e.entry_date}</td>
                          <td className="data-td capitalize">{e.entry_type.replace(/_/g, ' ')}</td>
                          <td className="data-td font-mono">{e.reference_number ?? '—'}</td>
                          <td className="data-td text-text-secondary">{e.description ?? '—'}</td>
                          <td className="data-td text-right">{e.debit > 0 ? fmtMoney(e.debit) : '—'}</td>
                          <td className="data-td text-right text-green-600">{e.credit > 0 ? fmtMoney(e.credit) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
