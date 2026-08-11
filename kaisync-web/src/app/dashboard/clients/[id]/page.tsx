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
import { createClientRecord } from '@/lib/clients'
import { logClientEvent } from '@/lib/client-events'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { Toggle } from '@/components/Toggle'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ClientActivityTab } from '@/components/ClientActivityTab'
import { fmtMoney } from '@/lib/finance-calc'
import type { Client, ClientDocument, ClientNote, Site, Project, ProjectDocument } from '@/types/database'
import type { FinanceInvoice } from '@/lib/finance-types'

const CLIENT_TABS = ['info', 'projects', 'jobs', 'invoices', 'documents', 'notes', 'activity', 'commercial'] as const
type ClientTab = typeof CLIENT_TABS[number]

const TAB_LABELS: Record<ClientTab, string> = {
  info: 'Information',
  projects: 'Projects',
  jobs: 'Jobs',
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
  const [commercialData, setCommercialData] = useState<{
    quotes: Array<{ id: string; quote_number: string | null; title: string; status: string; total_amount: number; created_at: string }>
    invoices: Array<{ id: string; invoice_number: string | null; status: string; total_amount: number; balance_due: number; issue_date: string }>
    ledger: Array<{ id: string; entry_type: string; reference_number: string | null; description: string | null; debit: number; credit: number; entry_date: string }>
  } | null>(null)
  const [commercialLoading, setCommercialLoading] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [clientType, setClientType] = useState<string>('individual')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
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
    const [{ data: quotes }, { data: invoices }, { data: ledger }] = await Promise.all([
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
    ])
    return { quotes: quotes ?? [], invoices: invoices ?? [], ledger: ledger ?? [] }
  }

  useEffect(() => {
    if (tab !== 'commercial' || !client || !client.company_id) return
    setCommercialLoading(true)
    loadCommercial(client.id, client.company_id).then(data => {
      setCommercialData(data)
      setCommercialLoading(false)
    })
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
      setLoading(false)
      return
    }

    const [cRes, sRes, pRes, iRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('sites').select('*').eq('client_id', clientId),
      supabase.from('client_deals').select('*, employees:manager_employee_id(name, surname)').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase
        .from('finance_invoices')
        .select('id, invoice_number, status, issue_date, due_date, total_amount, balance_due, client_id, company_id')
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
    setPortalEnabled(c.portal_enabled ?? false)

    const projectRows = (pRes.data ?? []) as Project[]
    setSites((sRes.data ?? []) as Site[])
    setProjects(projectRows)
    setInvoices((iRes.data ?? []) as FinanceInvoice[])

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
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const type = normalizeClientType(clientType)
    const prevPortal = client?.portal_enabled ?? false

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
      })
      if (!created.ok) { setError(created.message); setSaving(false); return }
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
        portal_enabled: portalEnabled,
      }

      const { error: e } = await supabase.from('clients').update(payload).eq('id', clientId)
      if (e) {
        setError(e.message)
      } else {
        setClient(prev => prev
          ? { ...prev, ...payload, type, portal_enabled: portalEnabled } as Client
          : prev)
        if (client?.company_id) {
          await logClientEvent(supabase, {
            companyId: client.company_id,
            screen: 'HrClientDetails',
            action: 'client_profile_updated',
            meta: { client_id: clientId, name: name.trim() },
          })
          if (prevPortal !== portalEnabled) {
            await logClientEvent(supabase, {
              companyId: client.company_id,
              screen: 'HrClientDetails',
              action: portalEnabled ? 'client_portal_enabled' : 'client_portal_disabled',
              meta: { client_id: clientId },
            })
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
    await supabase.from('client_deals').update({ status: newStatus }).eq('id', p.id)
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

  function selectTab(t: ClientTab) {
    setTab(t)
    if (!isNew) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', t)
      router.replace(`/dashboard/clients/${clientId}?${params.toString()}`, { scroll: false })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/clients" className="text-text-secondary hover:text-text-primary transition-colors">
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
              className="h-[38px] px-3 rounded-[10px] text-[12px] font-medium transition-colors whitespace-nowrap shrink-0"
              style={{ backgroundColor: tab === t ? '#3B82F6' : '#FFFFFF', color: tab === t ? '#FFFFFF' : '#6B7280' }}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${tab === 'activity' ? 'max-w-3xl' : 'max-w-2xl'}`}>

        {(isNew || tab === 'info') && (
          <>
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
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
              </div>
              <input placeholder="Address" value={address} onChange={e => setAddress(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)}
                disabled={!canEdit}
                rows={3} className="dark-entry min-h-[72px] py-3 resize-none" />
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
                <div className="card overflow-hidden" style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {sites.length === 0 ? (
                    <p className="text-text-secondary text-[13px] p-4">No sites.</p>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {sites.map(s => (
                          <tr key={s.id} className="border-b border-divider last:border-0">
                            <td className="data-td text-text-primary text-[13px]">{s.name}</td>
                            <td className="data-td text-text-secondary text-[12px] truncate">{s.address ?? '—'}</td>
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
                  className="rounded-lg h-8 px-[10px] text-[11px] transition-colors"
                  style={{ backgroundColor: projectView === v ? '#3B82F6' : '#FFFFFF', color: projectView === v ? '#FFFFFF' : '#6B7280' }}>
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

        {showRelatedTabs && tab === 'invoices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">INVOICES</p>
              {canEdit && (
                <button onClick={() => router.push(`/dashboard/finance/invoices/new?clientId=${clientId}`)}
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
                          onClick={() => router.push(`/dashboard/finance/invoices/${inv.id}`)}
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
                            {d.file_url ? (
                              <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                                className="text-primary text-[11px] font-medium h-[30px] inline-flex items-center">
                                Open →
                              </a>
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
                              <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                                className="text-primary text-[11px] font-medium h-[30px] inline-flex items-center">
                                Open →
                              </a>
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

        {showRelatedTabs && tab === 'commercial' && (
          <div className="space-y-6 p-4">
            {/* Commercial Profile card */}
            <div className="bg-surface rounded-xl border border-divider p-4 space-y-3">
              <h3 className="text-[14px] font-semibold text-text-primary">Commercial Profile</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">Payment Terms (days)</span>
                  <input type="number" value={(client as any).payment_terms_days ?? 30}
                    onChange={e => setClient(prev => prev ? { ...prev, payment_terms_days: Number(e.target.value) } as any : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">Credit Limit (R)</span>
                  <input type="number" value={(client as any).credit_limit ?? 0}
                    onChange={e => setClient(prev => prev ? { ...prev, credit_limit: Number(e.target.value) } as any : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">VAT Number</span>
                  <input type="text" value={(client as any).vat_number ?? ''}
                    onChange={e => setClient(prev => prev ? { ...prev, vat_number: e.target.value } as any : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-text-secondary">Billing Address</span>
                  <input type="text" value={(client as any).billing_address ?? ''}
                    onChange={e => setClient(prev => prev ? { ...prev, billing_address: e.target.value } as any : prev)}
                    className="w-full h-9 px-3 border border-border rounded-md text-[13px] bg-background" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={(client as any).tax_exempt ?? false}
                  onChange={e => setClient(prev => prev ? { ...prev, tax_exempt: e.target.checked } as any : prev)} />
                Tax Exempt
              </label>
              <button
                onClick={async () => {
                  if (!client) return
                  const supabase = createClient()
                  await supabase.from('clients').update({
                    payment_terms_days: (client as any).payment_terms_days,
                    credit_limit: (client as any).credit_limit,
                    vat_number: (client as any).vat_number,
                    billing_address: (client as any).billing_address,
                    tax_exempt: (client as any).tax_exempt,
                  }).eq('id', client.id)
                }}
                className="btn-primary h-9 px-4 text-[13px]"
              >
                Save Commercial Profile
              </button>
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
                    <a href={`/dashboard/money/invoices`} className="text-[12px] text-primary">View all →</a>
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
                      Outstanding: {fmtMoney(
                        commercialData.ledger.reduce((s, e) => s + e.debit - e.credit, 0)
                      )}
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
