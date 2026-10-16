'use client'

// Projects detail: create/edit client_deals with permission-aware helpers.

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { Toggle } from '@/components/Toggle'
import { ProjectPaymentsTab } from '@/components/ProjectPaymentsTab'
import { ProjectActivityTab } from '@/components/ProjectActivityTab'
import { ProjectMilestonesTab } from '@/components/ProjectMilestonesTab'
import { ProjectFinancialsTab } from '@/components/ProjectFinancialsTab'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  allocateProjectCode,
  createProject,
  updateProject,
} from '@/lib/projects'
import {
  ensureMoneyQuoteForProject,
  findMoneyQuoteForProject,
  sendProjectQuotationViaMoneyQuote,
  type MoneyQuoteLink,
} from '@/lib/project-money-quote'
import { logProjectEvent } from '@/lib/project-events'
import { portalStorageObjectName } from '@/lib/client-portal/api'
import type { Project, Client, Employee, Job, ProjectDocument, ProjectQuotationLine } from '@/types/database'

const PROJECT_TABS = ['details', 'jobs', 'docs', 'quotation', 'pipeline', 'milestones', 'financials', 'payments', 'activity']
const TAB_LABELS: Record<string, string> = {
  details: 'Details', jobs: 'Jobs', docs: 'Docs', quotation: 'Quotation', pipeline: 'Pipeline',
  milestones: 'Milestones', financials: 'Financials',
  payments: 'Payments', activity: 'Activity',
}
const TAB_BTN = (active: boolean) =>
  `h-[38px] px-3 rounded-[10px] text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 border ${
    active ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:text-text-primary'
  }`
const STATUS_OPTIONS = ['draft', 'sent', 'negotiation', 'in_progress', 'won', 'lost']
const DOC_TYPE_OPTIONS = [
  { value: 'contract', label: 'Contract' },
  { value: 'specification', label: 'Specification' },
  { value: 'permit', label: 'Permit' },
  { value: 'other', label: 'Other' },
]

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const fmtCurrency = (n: number) =>
  `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`

const lineAmount = (l: ProjectQuotationLine) =>
  Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = params.id
  const isNew = projectId === 'new'
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState('details')
  const [project, setProject] = useState<Project | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [docs, setDocs] = useState<ProjectDocument[]>([])
  const [lines, setLines] = useState<ProjectQuotationLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [docBusy, setDocBusy] = useState(false)
  const [docType, setDocType] = useState('contract')
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [sendBusy, setSendBusy] = useState(false)
  const [moneyQuote, setMoneyQuote] = useState<MoneyQuoteLink | null>(null)
  const [moneyQuoteBusy, setMoneyQuoteBusy] = useState(false)
  const [moneyInvoices, setMoneyInvoices] = useState<Array<{
    id: string
    invoice_number: string | null
    status: string
    total_amount: number
    balance_due: number
  }>>([])
  const [moneyQuotes, setMoneyQuotes] = useState<Array<{
    id: string
    quote_number: string | null
    title: string
    status: string
    total_amount: number | null
  }>>([])

  const canCreate = can(perms, PERM.projectsCreate)
  const canEdit = can(perms, PERM.projectsEdit)

  // Form state
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [clientId, setClientId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [status, setStatus] = useState('draft')
  const [notes, setNotes] = useState('')
  const [agreementNotes, setAgreementNotes] = useState('')
  const [quotationNotes, setQuotationNotes] = useState('')
  const [quotationValidUntil, setQuotationValidUntil] = useState('')
  const [useQuotationValidUntil, setUseQuotationValidUntil] = useState(false)
  const [siteStartDate, setSiteStartDate] = useState('')
  const [useSiteStartDate, setUseSiteStartDate] = useState(false)
  const [expectedCompletion, setExpectedCompletion] = useState('')
  const [useExpectedCompletion, setUseExpectedCompletion] = useState(false)
  const [nextVisit, setNextVisit] = useState('')
  const [useNextVisit, setUseNextVisit] = useState(false)
  const [expectedClose, setExpectedClose] = useState('')
  const [useExpectedClose, setUseExpectedClose] = useState(false)

  // Quotation lines editing
  const [newLineDesc, setNewLineDesc] = useState('')
  const [newLineQty, setNewLineQty] = useState('1')
  const [newLineUnitPrice, setNewLineUnitPrice] = useState('')

  useEffect(() => { load() }, [projectId])

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && PROJECT_TABS.includes(t)) setTab(t)
  }, [searchParams])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    if (isNew) {
      const [cRes, mRes] = await Promise.all([
        supabase.from('clients').select('id, name, client_code').eq('company_id', member.companyId).order('name'),
        supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name'),
      ])
      setClients((cRes.data ?? []) as Client[])
      setManagers((mRes.data ?? []) as Employee[])
      const preClient = searchParams.get('clientId')
      if (preClient) setClientId(preClient)
      const codeRes = await allocateProjectCode(supabase, member.companyId)
      if (codeRes.ok) setCode(codeRes.data)
      setLoading(false)
      return
    }

    const [pRes, cRes, mRes, jRes, dRes, lRes] = await Promise.all([
      supabase.from('client_deals').select('*, clients(id, name), employees:manager_employee_id(id, name, surname)').eq('id', projectId).eq('company_id', member.companyId).single(),
      supabase.from('clients').select('id, name, client_code').eq('company_id', member.companyId).order('name'),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name'),
      supabase.from('jobs').select('id, job_code, title, status').eq('company_id', member.companyId).eq('deal_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_documents').select('*').eq('deal_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_quotation_lines').select('*').eq('deal_id', projectId).order('line_no'),
    ])

    if (!pRes.data) { router.push('/dashboard/projects'); return }

    const p = pRes.data as Project
    setMoneyQuote(await findMoneyQuoteForProject(supabase, {
      companyId: member.companyId,
      projectId,
    }))
    const [invRes, quoteListRes] = await Promise.all([
      supabase
        .from('finance_invoices')
        .select('id, invoice_number, status, total_amount, balance_due')
        .eq('company_id', member.companyId)
        .or(`deal_id.eq.${projectId},project_id.eq.${projectId}`)
        .order('created_at', { ascending: false }),
      supabase
        .from('commercial_quotes')
        .select('id, quote_number, title, status, total_amount')
        .eq('company_id', member.companyId)
        .eq('deal_id', projectId)
        .order('created_at', { ascending: false }),
    ])
    setMoneyInvoices((invRes.data ?? []) as typeof moneyInvoices)
    setMoneyQuotes((quoteListRes.data ?? []) as typeof moneyQuotes)
    setProject(p)
    setTitle(p.title ?? '')
    setCode(p.project_code ?? '')
    setClientId(p.client_id ?? '')
    setManagerId(p.manager_employee_id ?? '')
    setStatus(p.status ?? 'draft')
    setNotes(p.notes ?? '')
    setAgreementNotes(p.agreement_notes ?? '')
    setQuotationNotes(p.quotation_notes ?? '')
    if (p.quotation_valid_until) { setQuotationValidUntil(p.quotation_valid_until); setUseQuotationValidUntil(true) }
    if (p.site_start_date) { setSiteStartDate(p.site_start_date); setUseSiteStartDate(true) }
    if (p.expected_completion_date) { setExpectedCompletion(p.expected_completion_date); setUseExpectedCompletion(true) }
    if (p.next_visit_date) { setNextVisit(p.next_visit_date); setUseNextVisit(true) }
    if (p.expected_close_date) { setExpectedClose(p.expected_close_date); setUseExpectedClose(true) }

    setClients((cRes.data ?? []) as Client[])
    setManagers((mRes.data ?? []) as Employee[])
    setJobs((jRes.data ?? []) as Job[])
    setDocs((dRes.data ?? []) as ProjectDocument[])
    setLines((lRes.data ?? []) as ProjectQuotationLine[])
    setLoading(false)
  }

  async function generateCode() {
    if (!companyId) return
    const supabase = createClient()
    const codeRes = await allocateProjectCode(supabase, companyId)
    if (!codeRes.ok) { setError(codeRes.message); return }
    setCode(codeRes.data)
  }

  async function save() {
    if (!title.trim()) { setError('Project name is required.'); return }
    if (isNew && !canCreate) { setError('You do not have permission to create projects.'); return }
    if (!isNew && !canEdit) { setError('You do not have permission to edit projects.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      title:                   title.trim(),
      project_code:            code.trim() || null,
      client_id:               clientId || null,
      manager_employee_id:     managerId || null,
      status,
      notes:                   notes.trim() || null,
      agreement_notes:         agreementNotes.trim() || null,
      quotation_notes:         quotationNotes.trim() || null,
      quotation_valid_until:   useQuotationValidUntil ? (quotationValidUntil || null) : null,
      site_start_date:         useSiteStartDate ? (siteStartDate || null) : null,
      expected_completion_date: useExpectedCompletion ? (expectedCompletion || null) : null,
      next_visit_date:         useNextVisit ? (nextVisit || null) : null,
      expected_close_date:     useExpectedClose ? (expectedClose || null) : null,
    }

    if (isNew) {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Your account is not linked to an active employee record. Please contact your administrator.'); setSaving(false); return }
      const created = await createProject(supabase, {
        companyId: member.companyId,
        title: payload.title,
        projectCode: payload.project_code,
        clientId: payload.client_id,
        managerEmployeeId: payload.manager_employee_id,
        status: payload.status,
        notes: payload.notes,
        agreementNotes: payload.agreement_notes,
        quotationNotes: payload.quotation_notes,
        quotationValidUntil: payload.quotation_valid_until,
        siteStartDate: payload.site_start_date,
        expectedCompletionDate: payload.expected_completion_date,
        nextVisitDate: payload.next_visit_date,
        expectedCloseDate: payload.expected_close_date,
        assignCode: !payload.project_code,
      })
      if (!created.ok) { setError(created.message); setSaving(false); return }
      router.push(`/dashboard/projects/${created.data.id}`)
    } else {
      if (!companyId) { setError('Company not resolved.'); setSaving(false); return }
      const updated = await updateProject(supabase, {
        companyId,
        projectId,
        payload,
        previousStatus: project?.status ?? null,
      })
      if (!updated.ok) setError(updated.message)
      else setProject(prev => prev ? { ...prev, ...payload, status } as Project : prev)
    }
    setSaving(false)
  }

  async function handleSendQuotation() {
    if (!companyId || !employeeId || !canEdit || lines.length === 0) return
    setSendBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await sendProjectQuotationViaMoneyQuote(supabase, {
      companyId,
      projectId,
      employeeId,
      clientId: clientId || null,
      title: title.trim() || project?.title || 'Project quotation',
      scopeNotes: quotationNotes.trim() || null,
      validUntil: useQuotationValidUntil ? (quotationValidUntil || null) : null,
      previousStatus: project?.status ?? null,
    })
    setSendBusy(false)
    if (!result.ok) { setError(result.message); return }
    setStatus('sent')
    setProject(prev => prev ? {
      ...prev,
      status: 'sent',
      quotation_response: 'pending',
      quotation_response_note: null,
      quotation_response_at: null,
      quotation_response_storage_path: null,
    } : prev)
    const linked = await findMoneyQuoteForProject(supabase, { companyId, projectId })
    setMoneyQuote(linked)
  }

  async function handleOpenOrCreateMoneyQuote() {
    if (!companyId || !employeeId || !canEdit) return
    setMoneyQuoteBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await ensureMoneyQuoteForProject(supabase, {
      companyId,
      projectId,
      employeeId,
      clientId: clientId || null,
      title: title.trim() || project?.title || 'Project quotation',
      scopeNotes: quotationNotes.trim() || null,
      validUntil: useQuotationValidUntil ? (quotationValidUntil || null) : null,
      syncLinesFromProject: true,
    })
    setMoneyQuoteBusy(false)
    if (!result.ok) { setError(result.message); return }
    setMoneyQuote(result.data)
    router.push(`/dashboard/money/quotes/${result.data.id}`)
  }

  async function syncOfferAmount(nextLines: ProjectQuotationLine[]) {
    if (!companyId) return
    const offer = nextLines.reduce((s, l) => s + lineAmount(l), 0)
    const supabase = createClient()
    await supabase.from('client_deals').update({ offer_amount: offer }).eq('id', projectId).eq('company_id', companyId)
    setProject(prev => prev ? { ...prev, offer_amount: offer } : prev)
  }

  async function addLine() {
    if (!canEdit || !newLineDesc.trim() || !project) return
    const description = newLineDesc.trim()
    const qty = parseFloat(newLineQty) || 1
    const unitPrice = parseFloat(newLineUnitPrice) || 0
    const supabase = createClient()
    const { data, error: e } = await supabase.from('project_quotation_lines').insert({
      company_id: project.company_id,
      deal_id: projectId,
      line_no: lines.length + 1,
      description,
      quantity: qty,
      unit_price: unitPrice,
    }).select().single()
    if (e) { setError(e.message); return }
    if (data) {
      const next = [...lines, data as ProjectQuotationLine]
      setLines(next)
      setNewLineDesc('')
      setNewLineQty('1')
      setNewLineUnitPrice('')
      await syncOfferAmount(next)
      await logProjectEvent(supabase, {
        companyId: project.company_id,
        screen: 'HrProjectDetails',
        action: 'quotation_line_added',
        meta: { project_id: projectId, description },
      })
    }
  }

  async function deleteLine(id: string) {
    if (!canEdit || !project) return
    const supabase = createClient()
    const { error: delErr } = await supabase
      .from('project_quotation_lines')
      .delete()
      .eq('id', id)
      .eq('deal_id', projectId)
      .eq('company_id', project.company_id)
    if (delErr) { setError(delErr.message); return }
    const next = lines.filter(l => l.id !== id)
    setLines(next)
    await syncOfferAmount(next)
    await logProjectEvent(supabase, {
      companyId: project.company_id,
      screen: 'HrProjectDetails',
      action: 'quotation_line_removed',
      meta: { project_id: projectId },
    })
  }

  async function uploadDoc(file: File) {
    if (!canEdit || !project) return
    setDocBusy(true)
    setError(null)
    const supabase = createClient()
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
    const path = `project_documents/${project.company_id}/${projectId}/hr_${crypto.randomUUID()}${ext}`
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (upErr) {
      setError(upErr.message)
      setDocBusy(false)
      return
    }
    const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(path)
    const { data, error: insErr } = await supabase.from('project_documents').insert({
      company_id: project.company_id,
      deal_id: projectId,
      document_name: file.name,
      document_type: docType || 'other',
      file_url: pub.publicUrl,
    }).select().single()
    if (insErr) setError(insErr.message)
    else if (data) {
      setDocs(prev => [data as ProjectDocument, ...prev])
      await logProjectEvent(supabase, {
        companyId: project.company_id,
        screen: 'HrProjectDetails',
        action: 'document_uploaded',
        meta: { project_id: projectId, document_name: file.name },
      })
    }
    if (fileRef.current) fileRef.current.value = ''
    setDocBusy(false)
  }

  async function openStoredFile(path: string) {
    const name = portalStorageObjectName(path)
    if (!name) return
    const supabase = createClient()
    const { data, error: signErr } = await supabase.storage.from('workforce-media').createSignedUrl(name, 3600)
    if (signErr || !data?.signedUrl) {
      setError(signErr?.message ?? 'Could not open the file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function openDoc(doc: ProjectDocument) {
    const name = portalStorageObjectName(doc.file_url)
    if (!name) {
      window.open(doc.file_url, '_blank', 'noopener,noreferrer')
      return
    }
    const supabase = createClient()
    const { data, error: signErr } = await supabase.storage.from('workforce-media').createSignedUrl(name, 3600)
    if (signErr || !data?.signedUrl) {
      setError(signErr?.message ?? 'Could not open the file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function deleteDoc(doc: ProjectDocument) {
    if (!canEdit || !project) return
    if (!window.confirm('Delete this document?')) return
    const supabase = createClient()
    await supabase.from('project_documents').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
    await logProjectEvent(supabase, {
      companyId: project.company_id,
      screen: 'HrProjectDetails',
      action: 'document_deleted',
      meta: { project_id: projectId, document_name: doc.document_name },
    })
  }

  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0)
  const vat      = subtotal * 0.15
  const total    = subtotal + vat

  const JOB_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
    open:        { bg: '#DBEAFE', fg: '#1E40AF' },
    in_progress: { bg: '#FEF3C7', fg: '#92400E' },
    completed:   { bg: '#DCFCE7', fg: '#166534' },
    cancelled:   { bg: '#E5E7EB', fg: '#6B7280' },
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/projects" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary">{title || 'New Project'}</h1>
        </div>
        {(isNew ? canCreate : canEdit) && (
          <button onClick={save} disabled={saving}
            className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[96px]">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {error && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      {/* Tab bar */}
      {!isNew && (
        <div className="flex flex-wrap gap-2 px-4 py-2 overflow-x-auto shrink-0">
          {PROJECT_TABS.map(t => (
            <button key={t} type="button" onClick={() => setTab(t)} className={TAB_BTN(tab === t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">
        {isNew && (
          <p className="text-text-secondary text-center py-4 text-[12px]">
            Save the project first to attach documents, record payments, and add jobs.
          </p>
        )}

        {/* ── DETAILS TAB ── */}
        {(isNew || tab === 'details') && (
          <>
            {/* PROJECT form */}
            <SectionCard title="Project">
              <FormField label="Project name">
                <input placeholder="Required" value={title} onChange={e => setTitle(e.target.value)} className={entryClass} />
              </FormField>
              <FormField label="Project code">
                <div className="flex gap-2">
                  <input placeholder="P{CODE}0001" value={code} onChange={e => setCode(e.target.value)} className={entryClass} />
                  <button type="button" onClick={generateCode} className="h-12 px-3 rounded-sm border border-border text-[12px] text-text-secondary hover:text-text-primary shrink-0">
                    Generate
                  </button>
                </div>
              </FormField>
              <FormField label="Client">
                <select value={clientId} onChange={e => setClientId(e.target.value)} className={`${entryClass} appearance-none`}>
                  <option value="">No client — internal project</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField label="Status">
                <select value={status} onChange={e => setStatus(e.target.value)} className={`${entryClass} appearance-none`}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </FormField>
              <FormField label="Manager">
                <select value={managerId} onChange={e => setManagerId(e.target.value)} className={`${entryClass} appearance-none`}>
                  <option value="">Project manager…</option>
                  {managers.map(m => <option key={m.id} value={m.id}>{m.name} {m.surname}</option>)}
                </select>
              </FormField>
            </SectionCard>

            <SectionCard title="Dates">
              <p className="text-[12px] text-text-secondary -mt-1">Shown on the client portal so they know what to expect.</p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-primary">Site start</span>
                <Toggle checked={useSiteStartDate} onChange={v => { setUseSiteStartDate(v); if (!v) setSiteStartDate('') }} />
              </div>
              {useSiteStartDate && <input type="date" value={siteStartDate} onChange={e => setSiteStartDate(e.target.value)} className={entryClass} />}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-primary">Expected completion</span>
                <Toggle checked={useExpectedCompletion} onChange={v => { setUseExpectedCompletion(v); if (!v) setExpectedCompletion('') }} />
              </div>
              {useExpectedCompletion && <input type="date" value={expectedCompletion} onChange={e => setExpectedCompletion(e.target.value)} className={entryClass} />}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-primary">Next visit</span>
                <Toggle checked={useNextVisit} onChange={v => { setUseNextVisit(v); if (!v) setNextVisit('') }} />
              </div>
              {useNextVisit && <input type="date" value={nextVisit} onChange={e => setNextVisit(e.target.value)} className={entryClass} />}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-primary">Expected close</span>
                <Toggle checked={useExpectedClose} onChange={v => { setUseExpectedClose(v); if (!v) setExpectedClose('') }} />
              </div>
              {useExpectedClose && <input type="date" value={expectedClose} onChange={e => setExpectedClose(e.target.value)} className={entryClass} />}
            </SectionCard>
          </>
        )}

        {!isNew && tab === 'jobs' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="section-label">JOBS ON THIS PROJECT</p>
              {canEdit && (
                <Link
                  href={`/dashboard/jobs/new?dealId=${projectId}`}
                  className="btn-primary h-10 px-[14px] text-[12px] inline-flex items-center"
                >
                  + Add job
                </Link>
              )}
            </div>
            {jobs.length > 0 ? (
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th style={{ width: 100 }} className="data-th">Job code</th>
                      <th className="data-th">Title</th>
                      <th style={{ width: 88 }} className="data-th text-center">Status</th>
                      <th style={{ width: 72 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(j => {
                      const sc = JOB_STATUS_COLORS[j.status] ?? JOB_STATUS_COLORS.open
                      return (
                        <tr key={j.id} className="border-b border-divider last:border-0">
                          <td className="data-td">
                            <button type="button" onClick={() => router.push(`/dashboard/jobs/${j.id}`)}
                              className="text-primary text-[12px] font-medium">{j.job_code ?? '—'}</button>
                          </td>
                          <td className="data-td text-text-primary text-[13px] truncate">{j.title}</td>
                          <td className="data-td text-center">
                            <span className="inline-block rounded-lg px-2 py-[3px] text-[10px] font-medium"
                              style={{ backgroundColor: sc.bg, color: sc.fg }}>{j.status}</span>
                          </td>
                          <td className="data-td text-right">
                            <button type="button" onClick={() => router.push(`/dashboard/jobs/${j.id}`)}
                              className="btn-outlined h-7 px-2 text-[11px]">Open</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-text-secondary text-[13px]">No jobs linked to this project.</p>
            )}
          </div>
        )}

        {/* ── DOCS TAB ── */}
        {!isNew && tab === 'docs' && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="section-label">PROJECT DOCUMENTS</p>
                {canEdit && (
                  <div className="flex gap-2 items-center">
                    <select
                      value={docType}
                      onChange={e => setDocType(e.target.value)}
                      className="text-[11px] h-9 px-2 rounded-lg border border-border bg-surface text-text-secondary w-[140px]"
                    >
                      {DOC_TYPE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) void uploadDoc(file)
                      }}
                    />
                    <button
                      type="button"
                      disabled={docBusy}
                      onClick={() => fileRef.current?.click()}
                      className="btn-primary h-9 px-3 text-[12px] disabled:opacity-50"
                    >
                      {docBusy ? 'Uploading…' : '+ Upload'}
                    </button>
                  </div>
                )}
              </div>
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th">Document</th>
                      <th style={{ width: 100 }} className="data-th">Type</th>
                      <th style={{ width:  96 }} className="data-th text-center">Added</th>
                      <th style={{ width:  64 }} className="data-th"></th>
                      <th style={{ width:  48 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={5} className="text-text-secondary text-center py-6 text-[13px]">No documents yet.</td></tr>
                    ) : (
                      docs.map(d => (
                        <tr key={d.id} className="border-b border-divider last:border-0">
                          <td className="data-td text-primary text-[13px] truncate">{d.document_name}</td>
                          <td className="data-td text-text-secondary text-[12px]">{d.document_type ?? '—'}</td>
                          <td className="data-td text-text-secondary text-[11px] text-center">{fmtDate(d.created_at)}</td>
                          <td className="data-td text-center">
                            <button type="button" onClick={() => void openDoc(d)}
                              className="text-primary text-[11px] font-medium">Open</button>
                          </td>
                          <td className="data-td text-center">
                            {canEdit && (
                              <button onClick={() => void deleteDoc(d)} className="text-error text-[12px] font-medium">✕</button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Agreements */}
            <SectionCard title="Agreements">
              <FormField label="Client-visible">
                <textarea value={agreementNotes} onChange={e => setAgreementNotes(e.target.value)}
                  placeholder="For the client…"
                  className={`${entryClass} min-h-[72px] py-3 resize-none`} />
              </FormField>
              <FormField label="Internal (HR)">
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Internal notes…"
                  className={`${entryClass} min-h-[56px] py-3 resize-none`} />
              </FormField>
            </SectionCard>
          </>
        )}

        {/* ── QUOTATION TAB ── */}
        {!isNew && tab === 'quotation' && (
          <div className="space-y-4">
            <SectionCard title="Quotation for client">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-primary">Status</span>
                <span className="text-[13px] text-text-secondary">
                  {project?.status === 'sent' || moneyQuote?.status === 'sent'
                    ? 'Sent to client'
                    : 'Not sent'}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-[13px] text-text-primary">Client answer</span>
                <div className="text-right">
                  <p className="text-[13px] text-text-secondary">
                    {project?.quotation_response === 'accepted'
                      ? 'Accepted'
                      : project?.quotation_response === 'revision_requested'
                        ? 'Asked for a revision'
                        : 'Waiting'}
                  </p>
                  {project?.quotation_response_note && (
                    <p className="text-[12px] text-text-primary mt-1 max-w-sm">{project.quotation_response_note}</p>
                  )}
                  {project?.quotation_response_storage_path && (
                    <button
                      type="button"
                      onClick={() => void openStoredFile(project.quotation_response_storage_path!)}
                      className="text-[12px] text-primary hover:underline mt-1"
                    >
                      Open their file
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[13px] text-text-primary">Money quote</span>
                <div className="flex items-center gap-3 flex-wrap">
                  {moneyQuote ? (
                    <>
                      <span className="text-[12px] text-text-primary font-medium">
                        {moneyQuote.quote_number ?? 'Quote'} · {moneyQuote.status.replace('_', ' ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => router.push(`/dashboard/money/quotes/${moneyQuote.id}`)}
                        className="text-[12px] text-primary hover:underline"
                      >
                        Open
                      </button>
                    </>
                  ) : (
                    <span className="text-[12px] text-text-secondary">Not linked yet</span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={moneyQuoteBusy || lines.length === 0}
                      onClick={() => void handleOpenOrCreateMoneyQuote()}
                      className="text-[12px] font-medium text-primary hover:underline disabled:opacity-40"
                    >
                      {moneyQuoteBusy
                        ? 'Working…'
                        : moneyQuote
                          ? 'Sync & open Money quote'
                          : 'Create Money quote'}
                    </button>
                  )}
                </div>
              </div>
              <FormField label="Intro / terms">
                <textarea value={quotationNotes} onChange={e => setQuotationNotes(e.target.value)}
                  placeholder="For the client…"
                  className={`${entryClass} min-h-[56px] py-3 resize-none`} />
              </FormField>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-primary">Valid until</span>
                <Toggle checked={useQuotationValidUntil}
                  onChange={v => { setUseQuotationValidUntil(v); if (!v) setQuotationValidUntil('') }} />
              </div>
              {useQuotationValidUntil && (
                <input type="date" value={quotationValidUntil} onChange={e => setQuotationValidUntil(e.target.value)} className={entryClass} />
              )}
            </SectionCard>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="section-label">LINE ITEMS</p>
              </div>
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th">Description</th>
                      <th style={{ width: 72 }} className="data-th text-right">Qty</th>
                      <th style={{ width: 96 }} className="data-th text-right">Unit price</th>
                      <th style={{ width: 96 }} className="data-th text-right">Amount</th>
                      <th style={{ width: 40 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.id} className="border-b border-divider">
                        <td className="data-td text-text-primary text-[13px]">{l.description}</td>
                        <td className="data-td text-text-secondary text-[12px] text-right">{l.quantity}</td>
                        <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(l.unit_price)}</td>
                        <td className="data-td text-right text-[12px] font-medium text-text-primary">{fmtCurrency(lineAmount(l))}</td>
                        <td className="data-td text-center">
                          {canEdit && (
                            <button onClick={() => void deleteLine(l.id)} className="text-error text-[12px]">✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {/* Add row */}
                    <tr className="border-b border-divider bg-background">
                      <td className="data-td">
                        <input placeholder="Description…" value={newLineDesc} onChange={e => setNewLineDesc(e.target.value)}
                          className="dark-entry text-[13px]" />
                      </td>
                      <td className="data-td">
                        <input placeholder="1" value={newLineQty} onChange={e => setNewLineQty(e.target.value)}
                          inputMode="decimal" className="dark-entry text-[12px] text-right" />
                      </td>
                      <td className="data-td">
                        <input placeholder="0.00" value={newLineUnitPrice} onChange={e => setNewLineUnitPrice(e.target.value)}
                          inputMode="decimal" className="dark-entry text-[12px] text-right" />
                      </td>
                      <td className="data-td text-right text-[12px] text-text-secondary">
                        {fmtCurrency((parseFloat(newLineQty) || 0) * (parseFloat(newLineUnitPrice) || 0))}
                      </td>
                      <td className="data-td text-center">
                        {canEdit && (
                          <button onClick={() => void addLine()} className="text-primary text-[18px] font-light leading-none">+</button>
                        )}
                      </td>
                    </tr>
                    {/* Totals */}
                    <tr className="border-b border-divider">
                      <td colSpan={3} className="data-td text-text-secondary text-[12px]">Total (excl. VAT)</td>
                      <td className="data-td text-right text-[12px] text-text-secondary">{fmtCurrency(subtotal)}</td>
                      <td />
                    </tr>
                    <tr className="border-b border-divider">
                      <td colSpan={3} className="data-td text-text-secondary text-[12px]">VAT (15%)</td>
                      <td className="data-td text-right text-[12px] text-text-secondary">{fmtCurrency(vat)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={3} className="data-td text-text-primary text-[13px] font-semibold">Total (incl. VAT)</td>
                      <td className="data-td text-right text-[14px] font-semibold text-primary">{fmtCurrency(total)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {canEdit && (
              <button
                onClick={() => void handleSendQuotation()}
                disabled={lines.length === 0 || sendBusy || status === 'sent' || moneyQuote?.status === 'sent'}
                className="btn-primary h-11 w-full text-[14px] font-semibold disabled:opacity-40"
              >
                {sendBusy
                  ? 'Sending…'
                  : status === 'sent' || moneyQuote?.status === 'sent'
                    ? 'Quotation sent'
                    : 'Send quotation'}
              </button>
            )}
            <p className="text-[11px] text-text-secondary text-center">
              Send creates or updates the linked Money quote, marks it sent, and updates this project.
            </p>
          </div>
        )}

        {/* ── PIPELINE ── */}
        {!isNew && tab === 'pipeline' && (
          <div className="space-y-4">
            <p className="section-label">PIPELINE STAGE</p>
            <p className="text-text-secondary text-[12px]">Select a stage below, then click Save to update the project status.</p>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s, i) => {
                const isCurrent = status === s
                const isPast    = STATUS_OPTIONS.indexOf(status) > i && status !== 'lost'
                return (
                  <button
                    key={s}
                    onClick={() => canEdit && setStatus(s)}
                    disabled={!canEdit}
                    className="flex items-center gap-2 rounded-xl px-4 h-10 text-[13px] font-semibold transition-colors border shrink-0 disabled:opacity-50"
                    style={{
                      backgroundColor: isCurrent ? '#1D4ED8' : isPast ? '#0F2918' : '#1E293B',
                      borderColor:     isCurrent ? '#3B82F6' : isPast ? '#166534' : '#334155',
                      color:           isCurrent ? '#FFFFFF'  : isPast ? '#4ADE80' : '#94A3B8',
                    }}
                  >
                    {isPast  && <span className="material-icons text-[14px]" style={{ color: '#4ADE80' }}>check_circle</span>}
                    {isCurrent && <span className="w-2 h-2 rounded-full bg-white shrink-0" />}
                    {s.replace('_', ' ')}
                  </button>
                )
              })}
            </div>
            {canEdit && project?.status !== status && (
              <p className="text-[12px]" style={{ color: '#FCD34D' }}>
                Stage changed — click Save in the header to persist.
              </p>
            )}
          </div>
        )}

        {/* ── MILESTONES ── */}
        {!isNew && tab === 'milestones' && companyId && (
          <ProjectMilestonesTab
            projectId={projectId}
            companyId={companyId}
            canEdit={canEdit}
          />
        )}

        {/* ── FINANCIALS ── */}
        {!isNew && tab === 'financials' && companyId && (
          <div className="space-y-4">
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="section-label mb-0">MONEY</p>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/money/quotes/new?deal_id=${projectId}${clientId ? `&client_id=${clientId}` : ''}`}
                    className="h-8 px-3 text-[12px] rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-primary transition-colors flex items-center"
                  >
                    + Quote
                  </Link>
                  <Link
                    href={`/dashboard/money/invoices/new?deal_id=${projectId}&project_id=${projectId}${clientId ? `&client_id=${clientId}` : ''}`}
                    className="h-8 px-3 text-[12px] rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-primary transition-colors flex items-center"
                  >
                    + Invoice
                  </Link>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[12px] font-medium text-text-primary">Quotes</p>
                  <Link href={`/dashboard/money/quotes?deal_id=${projectId}`} className="text-[11px] text-primary hover:underline">
                    View all →
                  </Link>
                </div>
                {moneyQuotes.length === 0 ? (
                  <p className="text-[12px] text-text-secondary">No Money quotes linked to this project.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" style={{ minWidth: 420 }}>
                      <thead>
                        <tr className="border-b border-divider">
                          <th className="data-th text-left">#</th>
                          <th className="data-th text-left">Title</th>
                          <th className="data-th text-left">Status</th>
                          <th className="data-th text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moneyQuotes.map(q => (
                          <tr
                            key={q.id}
                            className="border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated"
                            onClick={() => router.push(`/dashboard/money/quotes/${q.id}`)}
                          >
                            <td className="data-td text-[13px] text-primary">{q.quote_number ?? 'Draft'}</td>
                            <td className="data-td text-[13px]">{q.title || '—'}</td>
                            <td className="data-td text-[12px] capitalize">{q.status.replace(/_/g, ' ')}</td>
                            <td className="data-td text-[13px] text-right">{fmtCurrency(Number(q.total_amount ?? 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[12px] font-medium text-text-primary">Invoices</p>
                  <Link href={`/dashboard/money/invoices?deal_id=${projectId}`} className="text-[11px] text-primary hover:underline">
                    View all →
                  </Link>
                </div>
                {moneyInvoices.length === 0 ? (
                  <p className="text-[12px] text-text-secondary">No client invoices linked to this project.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full" style={{ minWidth: 420 }}>
                      <thead>
                        <tr className="border-b border-divider">
                          <th className="data-th text-left">#</th>
                          <th className="data-th text-left">Status</th>
                          <th className="data-th text-right">Total</th>
                          <th className="data-th text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moneyInvoices.map(inv => (
                          <tr
                            key={inv.id}
                            className="border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated"
                            onClick={() => router.push(`/dashboard/money/invoices/${inv.id}`)}
                          >
                            <td className="data-td text-[13px] text-primary">{inv.invoice_number ?? 'Draft'}</td>
                            <td className="data-td text-[12px] capitalize">{inv.status.replace(/_/g, ' ')}</td>
                            <td className="data-td text-[13px] text-right">{fmtCurrency(Number(inv.total_amount))}</td>
                            <td className="data-td text-[13px] text-right">{fmtCurrency(Number(inv.balance_due))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <ProjectFinancialsTab
              projectId={projectId}
              companyId={companyId}
            />
          </div>
        )}

        {/* ── PAYMENTS ── */}
        {!isNew && tab === 'payments' && (
          <ProjectPaymentsTab
            projectId={projectId}
            offerAmount={project?.offer_amount ?? null}
            canEdit={canEdit}
            onPaidUpdated={(paid) => {
              setProject(prev => prev ? { ...prev, amount_paid: paid } : prev)
            }}
          />
        )}

        {/* ── ACTIVITY ── */}
        {!isNew && tab === 'activity' && companyId && (
          <ProjectActivityTab companyId={companyId} projectId={projectId} />
        )}
      </div>
    </div>
  )
}
