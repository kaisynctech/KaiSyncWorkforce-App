'use client'

// Projects detail: create/edit client_deals with permission-aware helpers.

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { Toggle } from '@/components/Toggle'
import { ProjectPaymentsTab } from '@/components/ProjectPaymentsTab'
import { ProjectActivityTab } from '@/components/ProjectActivityTab'
import { ProjectMilestonesTab } from '@/components/ProjectMilestonesTab'
import { ProjectFinancialsTab } from '@/components/ProjectFinancialsTab'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  allocateProjectCode,
  createProject,
  sendProjectQuotation,
  updateProject,
} from '@/lib/projects'
import { logProjectEvent } from '@/lib/project-events'
import type { Project, Client, Employee, Job, ProjectDocument, ProjectQuotationLine } from '@/types/database'

const PROJECT_TABS = ['details', 'docs', 'quotation', 'pipeline', 'milestones', 'financials', 'payments', 'activity']
const TAB_LABELS: Record<string, string> = {
  details: 'Details', docs: 'Docs', quotation: 'Quotation', pipeline: 'Pipeline',
  milestones: 'Milestones', financials: 'Financials',
  payments: 'Payments', activity: 'Activity',
}
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
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [sendBusy, setSendBusy] = useState(false)

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
      supabase.from('jobs').select('id, title, status').eq('deal_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_documents').select('*').eq('deal_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_quotation_lines').select('*').eq('deal_id', projectId).order('line_no'),
    ])

    if (!pRes.data) { router.push('/dashboard/projects'); return }

    const p = pRes.data as Project
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
    if (!companyId || !canEdit || lines.length === 0) return
    setSendBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await sendProjectQuotation(supabase, {
      companyId,
      projectId,
      previousStatus: project?.status ?? null,
    })
    setSendBusy(false)
    if (!result.ok) { setError(result.message); return }
    setStatus('sent')
    setProject(prev => prev ? { ...prev, status: 'sent' } : prev)
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
    await supabase.from('project_quotation_lines').delete().eq('id', id)
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
        <div className="flex gap-1.5 px-4 py-2 border-b border-divider overflow-x-auto shrink-0">
          {PROJECT_TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="rounded-lg h-9 px-3 text-[11px] font-medium shrink-0 transition-colors"
              style={{ backgroundColor: tab === t ? '#3B82F6' : '#FFFFFF', color: tab === t ? '#FFFFFF' : '#6B7280' }}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        {isNew && (
          <p className="text-text-secondary text-center py-4 text-[12px]">
            Save the project first to attach documents, record payments, and add jobs.
          </p>
        )}

        {/* ── DETAILS TAB ── */}
        {(isNew || tab === 'details') && (
          <>
            {/* PROJECT form */}
            <div className="card overflow-hidden">
              <p className="data-th border-b border-divider px-3 py-2 text-[11px] font-semibold tracking-wider uppercase">PROJECT</p>
              {/* Project name */}
              <div className="grid grid-cols-[132px_1px_1fr] border-b border-divider">
                <span className="data-th border-r border-divider py-2">Project name</span>
                <span />
                <input placeholder="Required" value={title} onChange={e => setTitle(e.target.value)}
                  className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none" />
              </div>
              {/* Code */}
              <div className="grid grid-cols-[132px_1px_1fr_auto] border-b border-divider">
                <span className="data-th border-r border-divider py-2">Project code</span>
                <span />
                <input placeholder="P{CODE}0001" value={code} onChange={e => setCode(e.target.value)}
                  className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none" />
                <button onClick={generateCode}
                  className="px-3 text-[11px] text-text-secondary border-l border-divider hover:text-text-primary transition-colors">
                  Generate
                </button>
              </div>
              {/* Client */}
              <div className="grid grid-cols-[132px_1px_1fr] border-b border-divider">
                <span className="data-th border-r border-divider py-2">Client</span>
                <span />
                <select value={clientId} onChange={e => setClientId(e.target.value)}
                  className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none appearance-none">
                  <option value="">No client — internal project</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {/* Status */}
              <div className="grid grid-cols-[132px_1px_1fr] border-b border-divider">
                <span className="data-th border-r border-divider py-2">Status</span>
                <span />
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none appearance-none">
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              {/* Manager */}
              <div className="grid grid-cols-[132px_1px_1fr]">
                <span className="data-th border-r border-divider py-2">Manager</span>
                <span />
                <select value={managerId} onChange={e => setManagerId(e.target.value)}
                  className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none appearance-none">
                  <option value="">Project manager…</option>
                  {managers.map(m => <option key={m.id} value={m.id}>{m.name} {m.surname}</option>)}
                </select>
              </div>
            </div>

            {/* Linked jobs */}
            {!isNew && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="section-label">LINKED JOBS</p>
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
                          <th style={{ width:  88 }} className="data-th text-center">Status</th>
                          <th style={{ width:  72 }} className="data-th"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.map(j => {
                          const sc = JOB_STATUS_COLORS[j.status] ?? JOB_STATUS_COLORS.open
                          return (
                            <tr key={j.id} className="border-b border-divider last:border-0">
                              <td className="data-td">
                                <button onClick={() => router.push(`/dashboard/jobs/${j.id}`)}
                                  className="text-primary text-[12px] font-medium">#{j.id.slice(0, 6)}</button>
                              </td>
                              <td className="data-td text-text-primary text-[13px] truncate">{j.title}</td>
                              <td className="data-td text-center">
                                <span className="inline-block rounded-lg px-2 py-[3px] text-[10px] font-medium"
                                  style={{ backgroundColor: sc.bg, color: sc.fg }}>{j.status}</span>
                              </td>
                              <td className="data-td text-right">
                                <button onClick={() => router.push(`/dashboard/jobs/${j.id}`)}
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

            {/* Dates & Milestones */}
            <div className="space-y-2">
              <p className="section-label">DATES & MILESTONES</p>
              <p className="text-text-secondary text-[11px]">Shown on the client portal so they know what to expect.</p>
              <div className="card overflow-hidden divide-y divide-divider">
                {/* Site start */}
                <div className="grid grid-cols-[160px_1px_1fr_auto] items-center">
                  <span className="data-th border-r border-divider py-2">Site start</span>
                  <span />
                  <div className="px-2">{useSiteStartDate && <input type="date" value={siteStartDate} onChange={e => setSiteStartDate(e.target.value)} className="dark-entry border-0 bg-transparent" />}</div>
                  <div className="px-2"><Toggle checked={useSiteStartDate} onChange={v => { setUseSiteStartDate(v); if (!v) setSiteStartDate('') }} /></div>
                </div>
                {/* Expected completion */}
                <div className="grid grid-cols-[160px_1px_1fr_auto] items-center">
                  <span className="data-th border-r border-divider py-2">Expected completion</span>
                  <span />
                  <div className="px-2">{useExpectedCompletion && <input type="date" value={expectedCompletion} onChange={e => setExpectedCompletion(e.target.value)} className="dark-entry border-0 bg-transparent" />}</div>
                  <div className="px-2"><Toggle checked={useExpectedCompletion} onChange={v => { setUseExpectedCompletion(v); if (!v) setExpectedCompletion('') }} /></div>
                </div>
                {/* Next visit */}
                <div className="grid grid-cols-[160px_1px_1fr_auto] items-center">
                  <span className="data-th border-r border-divider py-2">Next visit</span>
                  <span />
                  <div className="px-2">{useNextVisit && <input type="date" value={nextVisit} onChange={e => setNextVisit(e.target.value)} className="dark-entry border-0 bg-transparent" />}</div>
                  <div className="px-2"><Toggle checked={useNextVisit} onChange={v => { setUseNextVisit(v); if (!v) setNextVisit('') }} /></div>
                </div>
                {/* Expected close */}
                <div className="grid grid-cols-[160px_1px_1fr_auto] items-center">
                  <span className="data-th border-r border-divider py-2">Expected close</span>
                  <span />
                  <div className="px-2">{useExpectedClose && <input type="date" value={expectedClose} onChange={e => setExpectedClose(e.target.value)} className="dark-entry border-0 bg-transparent" />}</div>
                  <div className="px-2"><Toggle checked={useExpectedClose} onChange={v => { setUseExpectedClose(v); if (!v) setExpectedClose('') }} /></div>
                </div>
              </div>
            </div>
          </>
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
                            <a href={d.file_url} target="_blank" rel="noreferrer"
                              className="text-primary text-[11px] font-medium">Open</a>
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
            <div className="space-y-2">
              <p className="section-label">AGREEMENTS</p>
              <div className="card overflow-hidden divide-y divide-divider">
                <div className="grid grid-cols-[132px_1px_1fr]">
                  <span className="data-th border-r border-divider py-3">Client-visible</span>
                  <span />
                  <textarea value={agreementNotes} onChange={e => setAgreementNotes(e.target.value)}
                    placeholder="For the client…"
                    className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none min-h-[72px] py-3 resize-none" />
                </div>
                <div className="grid grid-cols-[132px_1px_1fr]">
                  <span className="data-th border-r border-divider py-3">Internal (HR)</span>
                  <span />
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="Internal notes…"
                    className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none min-h-[56px] py-3 resize-none" />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── QUOTATION TAB ── */}
        {!isNew && tab === 'quotation' && (
          <div className="space-y-4">
            <p className="section-label">QUOTATION FOR CLIENT</p>
            <div className="card overflow-hidden divide-y divide-divider">
              <div className="grid grid-cols-[132px_1px_1fr]">
                <span className="data-th border-r border-divider py-3">Status</span>
                <span />
                <span className="data-td text-text-secondary text-[12px]">
                  {project?.status === 'sent' ? 'Sent to client' : 'Not sent'}
                </span>
              </div>
              <div className="grid grid-cols-[132px_1px_1fr]">
                <span className="data-th border-r border-divider py-3">Intro / terms</span>
                <span />
                <textarea value={quotationNotes} onChange={e => setQuotationNotes(e.target.value)}
                  placeholder="For the client…"
                  className="dark-entry rounded-none border-0 bg-transparent focus:ring-0 focus:shadow-none min-h-[56px] py-3 resize-none" />
              </div>
              <div className="grid grid-cols-[132px_1px_1fr_auto] items-center">
                <span className="data-th border-r border-divider py-3">Valid until</span>
                <span />
                <div className="px-2">
                  {useQuotationValidUntil && (
                    <input type="date" value={quotationValidUntil} onChange={e => setQuotationValidUntil(e.target.value)}
                      className="dark-entry border-0 bg-transparent" />
                  )}
                </div>
                <div className="px-2">
                  <Toggle checked={useQuotationValidUntil}
                    onChange={v => { setUseQuotationValidUntil(v); if (!v) setQuotationValidUntil('') }} />
                </div>
              </div>
            </div>

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
                onClick={handleSendQuotation}
                disabled={lines.length === 0 || sendBusy || status === 'sent'}
                className="btn-primary h-11 w-full text-[14px] font-semibold disabled:opacity-40"
              >
                {sendBusy ? 'Sending…' : status === 'sent' ? 'Quotation sent' : 'Send quotation'}
              </button>
            )}
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
          <ProjectFinancialsTab
            projectId={projectId}
            companyId={companyId}
          />
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
