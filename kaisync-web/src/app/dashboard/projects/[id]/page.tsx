'use client'

// AUDIT MIS-2026-00013: Found 1 gap vs HrProjectDetailViewModel.
// Fixed: Pipeline tab now shows visual stage chip selector (replaced ComingSoon)
// Deferred: client messaging thread, payment recording/receipt attachment, post-update timeline entries

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { Toggle } from '@/components/Toggle'
import { ProjectPaymentsTab } from '@/components/ProjectPaymentsTab'
import type { Project, Client, Employee, Job, ProjectDocument, ProjectQuotationLine } from '@/types/database'

const PROJECT_TABS = ['details', 'docs', 'quotation', 'pipeline', 'payments']
const TAB_LABELS: Record<string, string> = {
  details: 'Details', docs: 'Docs', quotation: 'Quotation', pipeline: 'Pipeline', payments: 'Payments',
}
const STATUS_OPTIONS = ['draft', 'sent', 'in_progress', 'won', 'lost']

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const fmtCurrency = (n: number) =>
  `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params.id
  const isNew = projectId === 'new'

  const [tab, setTab] = useState('details')
  const [project, setProject] = useState<Project | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [docs, setDocs] = useState<ProjectDocument[]>([])
  const [lines, setLines] = useState<ProjectQuotationLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const [newLineDetail, setNewLineDetail] = useState('')
  const [newLineAmount, setNewLineAmount] = useState('')

  useEffect(() => { load() }, [projectId])

  async function load() {
    setLoading(true)
    const supabase = createClient()

    if (isNew) {
      const [cRes, mRes] = await Promise.all([
        supabase.from('clients').select('id, name, code').order('name'),
        supabase.from('employees').select('id, name, surname').eq('is_active', true).order('name'),
      ])
      setClients((cRes.data ?? []) as Client[])
      setManagers((mRes.data ?? []) as Employee[])
      setLoading(false)
      return
    }

    const [pRes, cRes, mRes, jRes, dRes, lRes] = await Promise.all([
      supabase.from('projects').select('*, clients(id, name), employees(id, name, surname)').eq('id', projectId).single(),
      supabase.from('clients').select('id, name, code').order('name'),
      supabase.from('employees').select('id, name, surname').eq('is_active', true).order('name'),
      supabase.from('jobs').select('id, title, status').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_documents').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_quotation_lines').select('*').eq('project_id', projectId).order('sort_order'),
    ])

    if (!pRes.data) { router.push('/dashboard/projects'); return }

    const p = pRes.data as Project
    setProject(p)
    setTitle(p.name ?? '')
    setCode(p.code ?? '')
    setClientId(p.client_id ?? '')
    setManagerId(p.manager_id ?? '')
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

  function generateCode() {
    const ts = Date.now().toString(36).toUpperCase()
    setCode(`P28${ts}`)
  }

  async function save() {
    if (!title.trim()) { setError('Project name is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      name:                    title.trim(),
      code:                    code.trim() || null,
      client_id:               clientId || null,
      manager_id:              managerId || null,
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
      const { data: np, error: e } = await supabase.from('projects').insert({ ...payload, company_id: member.companyId }).select().single()
      if (e) { setError(e.message); setSaving(false); return }
      router.push(`/dashboard/projects/${np.id}`)
    } else {
      const { error: e } = await supabase.from('projects').update(payload).eq('id', projectId)
      if (e) setError(e.message)
    }
    setSaving(false)
  }

  async function addLine() {
    if (!newLineDesc.trim()) return
    const supabase = createClient()
    const { data } = await supabase.from('project_quotation_lines').insert({
      project_id: projectId,
      description: newLineDesc.trim(),
      detail: newLineDetail.trim() || null,
      amount: parseFloat(newLineAmount) || 0,
      sort_order: lines.length,
    }).select().single()
    if (data) { setLines(prev => [...prev, data as ProjectQuotationLine]); setNewLineDesc(''); setNewLineDetail(''); setNewLineAmount('') }
  }

  async function deleteLine(id: string) {
    const supabase = createClient()
    await supabase.from('project_quotation_lines').delete().eq('id', id)
    setLines(prev => prev.filter(l => l.id !== id))
  }

  async function deleteDoc(doc: ProjectDocument) {
    if (!window.confirm('Delete this document?')) return
    const supabase = createClient()
    await supabase.from('project_documents').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  const subtotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0)
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
        <button onClick={save} disabled={saving}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[96px]">
          {saving ? 'Saving…' : 'Save'}
        </button>
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
                <input placeholder="P28xxxx" value={code} onChange={e => setCode(e.target.value)}
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
                  <button className="btn-primary h-10 px-[14px] text-[12px]">+ Add job</button>
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
                <div className="flex gap-2">
                  <select className="text-[11px] h-9 px-2 rounded-lg border border-border bg-surface text-text-secondary w-[140px]">
                    <option>Document type…</option>
                    <option>Contract</option>
                    <option>Specification</option>
                    <option>Permit</option>
                    <option>Other</option>
                  </select>
                  <button className="btn-primary h-9 px-3 text-[12px]">+ Upload</button>
                </div>
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
                            <a href={d.url} target="_blank" rel="noreferrer"
                              className="text-primary text-[11px] font-medium">Open</a>
                          </td>
                          <td className="data-td text-center">
                            <button onClick={() => deleteDoc(d)} className="text-error text-[12px] font-medium">✕</button>
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
                      <th style={{ width: 88 }} className="data-th">Detail</th>
                      <th style={{ width: 88 }} className="data-th text-right">Amount</th>
                      <th style={{ width: 40 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.id} className="border-b border-divider">
                        <td className="data-td text-text-primary text-[13px]">{l.description}</td>
                        <td className="data-td text-text-secondary text-[12px]">{l.detail ?? '—'}</td>
                        <td className="data-td text-right text-[12px] font-medium text-text-primary">{fmtCurrency(l.amount)}</td>
                        <td className="data-td text-center">
                          <button onClick={() => deleteLine(l.id)} className="text-error text-[12px]">✕</button>
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
                        <input placeholder="Detail…" value={newLineDetail} onChange={e => setNewLineDetail(e.target.value)}
                          className="dark-entry text-[12px]" />
                      </td>
                      <td className="data-td">
                        <input placeholder="0.00" value={newLineAmount} onChange={e => setNewLineAmount(e.target.value)}
                          inputMode="decimal" className="dark-entry text-[12px] text-right" />
                      </td>
                      <td className="data-td text-center">
                        <button onClick={addLine} className="text-primary text-[18px] font-light leading-none">+</button>
                      </td>
                    </tr>
                    {/* Totals */}
                    <tr className="border-b border-divider">
                      <td colSpan={2} className="data-td text-text-secondary text-[12px]">Total (excl. VAT)</td>
                      <td className="data-td text-right text-[12px] text-text-secondary">{fmtCurrency(subtotal)}</td>
                      <td />
                    </tr>
                    <tr className="border-b border-divider">
                      <td colSpan={2} className="data-td text-text-secondary text-[12px]">VAT (15%)</td>
                      <td className="data-td text-right text-[12px] text-text-secondary">{fmtCurrency(vat)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={2} className="data-td text-text-primary text-[13px] font-semibold">Total (incl. VAT)</td>
                      <td className="data-td text-right text-[14px] font-semibold text-primary">{fmtCurrency(total)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <button disabled={lines.length === 0}
              className="btn-primary h-11 w-full text-[14px] font-semibold disabled:opacity-40">
              Send quotation
            </button>
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
                    onClick={() => setStatus(s)}
                    className="flex items-center gap-2 rounded-xl px-4 h-10 text-[13px] font-semibold transition-colors border shrink-0"
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
            {project?.status !== status && (
              <p className="text-[12px]" style={{ color: '#FCD34D' }}>
                Stage changed — click Save in the header to persist.
              </p>
            )}
          </div>
        )}

        {/* ── PAYMENTS ── */}
        {!isNew && tab === 'payments' && (
          <ProjectPaymentsTab
            projectId={projectId}
            offerAmount={project?.offer_amount ?? null}
            onPaidUpdated={(paid) => {
              setProject(prev => prev ? { ...prev, paid_amount: paid } : prev)
            }}
          />
        )}
      </div>
    </div>
  )
}
