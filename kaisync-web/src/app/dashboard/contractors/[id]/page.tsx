'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { Toggle } from '@/components/Toggle'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ComingSoon } from '@/components/ui/ComingSoon'
import { KpiTile } from '@/components/ui/KpiTile'
import { InfoBanner } from '@/components/ui/InfoBanner'
import { DocFilterChip } from '@/components/ui/DocFilterChip'
import type {
  Contractor, ComplianceDocument, JobContractor, Job, IncidentReport,
  ContractorTeamMember, PendingBankingUpdate, Project,
} from '@/types/database'

const TABS = [
  'Information', 'Compliance', 'Payments', 'Team',
  'Jobs', 'Projects', 'Incidents', 'Activity', 'Quotes', 'Invoices',
]
const OPERATIONAL_TABS = new Set(['Jobs', 'Projects', 'Incidents'])

const PARTNER_KINDS = [
  'Sole Proprietor', 'Partnership', 'Private Company (Pty Ltd)',
  'Close Corporation', 'Public Company', 'Trust', 'Other',
]
const COMPLIANCE_PACKS = ['Standard', 'Premium', 'Basic', 'Government']
const ACCOUNT_TYPES = ['Cheque / Current', 'Savings', 'Transmission']
const PAYMENT_TERMS_OPTIONS = ['7 days', '14 days', '30 days', '60 days', 'On completion']
const PAYMENT_METHODS = ['EFT', 'Cheque', 'Cash', 'Credit Card']

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  valid:     { bg: '#DCFCE7', fg: '#166534' },
  expiring:  { bg: '#FEF3C7', fg: '#92400E' },
  expired:   { bg: '#FEE2E2', fg: '#991B1B' },
  pending:   { bg: '#E5E7EB', fg: '#6B7280' },
  rejected:  { bg: '#FEE2E2', fg: '#991B1B' },
}

const DOC_APPROVAL_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  valid:    { bg: '#DCFCE7', fg: '#166534', label: 'Approved' },
  pending:  { bg: '#1E293B', fg: '#94A3B8', label: 'Pending' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B', label: 'Rejected' },
  expired:  { bg: '#450A0A', fg: '#FCA5A5', label: 'Expired' },
  expiring: { bg: '#FEF3C7', fg: '#92400E', label: 'Expiring' },
}

const JOB_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open:        { bg: '#DBEAFE', fg: '#1E40AF' },
  scheduled:   { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  completed:   { bg: '#DCFCE7', fg: '#166534' },
  cancelled:   { bg: '#E5E7EB', fg: '#6B7280' },
}

const INCIDENT_SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
  high:     { bg: '#FEF3C7', fg: '#92400E' },
  medium:   { bg: '#DBEAFE', fg: '#1E40AF' },
  low:      { bg: '#DCFCE7', fg: '#166534' },
}

const INCIDENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open:          { bg: '#FEE2E2', fg: '#991B1B' },
  investigating: { bg: '#FEF3C7', fg: '#92400E' },
  resolved:      { bg: '#DBEAFE', fg: '#1E40AF' },
  closed:        { bg: '#DCFCE7', fg: '#166534' },
}

type DocFilterType = 'all' | 'approved' | 'pending' | 'rejected' | 'expired'

type JobContractorRow = JobContractor & {
  jobs?: Pick<Job, 'id' | 'title' | 'status' | 'scheduled_start' | 'project_id'> | null
}

type ProjectContractorRow = {
  id: string
  contractor_id: string
  project_id: string
  role: string | null
  projects?: Pick<Project, 'id' | 'name' | 'code' | 'status'> | null
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const fmtCurrency = (n: number | null) =>
  n != null ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'

export default function ContractorDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const contractorId = params.id

  const [tab, setTab] = useState('Information')
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [complianceDocs, setComplianceDocs] = useState<ComplianceDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Information tab
  const [name, setName] = useState('')
  const [partnerKind, setPartnerKind] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [rating, setRating] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [taxNumber, setTaxNumber] = useState('')
  const [isVatRegistered, setIsVatRegistered] = useState(false)
  const [vatNumber, setVatNumber] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [compliancePack, setCompliancePack] = useState('')

  // Compliance tab
  const [docFilter, setDocFilter] = useState<DocFilterType>('all')
  const [documentSearch, setDocumentSearch] = useState('')

  // Payments tab
  const [accHolder, setAccHolder] = useState('')
  const [payBankName, setPayBankName] = useState('')
  const [payAccNumber, setPayAccNumber] = useState('')
  const [payBranchCode, setPayBranchCode] = useState('')
  const [paySwiftBic, setPaySwiftBic] = useState('')
  const [payAccountType, setPayAccountType] = useState('')
  const [payTerms, setPayTerms] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [bankingVerified, setBankingVerified] = useState(false)
  const [paymentHold, setPaymentHold] = useState(false)
  const [complianceHold, setComplianceHold] = useState(false)
  const [pendingBanking, setPendingBanking] = useState<PendingBankingUpdate | null>(null)

  // Lazy-loaded tab data
  const [members, setMembers] = useState<ContractorTeamMember[]>([])
  const [contractorJobs, setContractorJobs] = useState<JobContractorRow[]>([])
  const [contractorProjects, setContractorProjects] = useState<ProjectContractorRow[]>([])
  const [contractorIncidents, setContractorIncidents] = useState<IncidentReport[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [incidentsLoading, setIncidentsLoading] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [tabsLoaded, setTabsLoaded] = useState<Set<string>>(new Set())

  useEffect(() => { load() }, [contractorId])

  useEffect(() => {
    if (tab === 'Jobs'      && !tabsLoaded.has('Jobs'))      loadJobs()
    if (tab === 'Projects'  && !tabsLoaded.has('Projects'))  loadProjects()
    if (tab === 'Incidents' && !tabsLoaded.has('Incidents')) loadIncidents()
    if (tab === 'Team'      && !tabsLoaded.has('Team'))      loadTeam()
  }, [tab])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const { data: c } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', contractorId)
      .single()

    if (!c) { router.push('/dashboard/contractors'); return }
    const cont = c as Contractor
    setContractor(cont)

    setName(cont.name ?? '')
    setRating(cont.rating ?? 0)
    setIsActive(cont.is_active ?? true)
    setTaxNumber(cont.tax_number ?? '')
    setIsVatRegistered(cont.is_vat_registered ?? false)
    setVatNumber(cont.vat_number ?? '')
    setContactPerson(cont.contact_person ?? '')
    setPhone(cont.phone ?? '')
    setEmail(cont.email ?? '')
    setAddress(cont.address ?? '')
    setNotes(cont.notes ?? '')
    setCompliancePack(cont.compliance_pack ?? '')

    setAccHolder(cont.account_holder_name ?? '')
    setPayBankName(cont.bank_name ?? '')
    setPayAccNumber(cont.account_number ?? '')
    setPayBranchCode(cont.branch_code ?? '')
    setPaySwiftBic(cont.swift_bic ?? '')
    setPayAccountType(cont.account_type ?? '')
    setPayTerms(cont.payment_terms ?? '')
    setPayMethod(cont.preferred_payment_method ?? '')
    setBankingVerified(cont.is_banking_verified ?? false)
    setPaymentHold(cont.payment_hold ?? false)
    setComplianceHold(cont.compliance_hold ?? false)

    const [docsRes, pendingRes] = await Promise.all([
      supabase.from('compliance_documents').select('*').eq('contractor_id', contractorId),
      supabase.from('contractor_banking_updates').select('*').eq('contractor_id', contractorId).eq('status', 'pending').maybeSingle(),
    ])
    setComplianceDocs((docsRes.data ?? []) as ComplianceDocument[])
    setPendingBanking(pendingRes.data as PendingBankingUpdate | null)
    setLoading(false)
  }

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('job_contractors')
      .select('*, jobs(id, title, status, scheduled_start, project_id)')
      .eq('contractor_id', contractorId)
    setContractorJobs((data ?? []) as JobContractorRow[])
    setTabsLoaded(prev => new Set([...prev, 'Jobs']))
    setJobsLoading(false)
  }, [contractorId])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('project_contractors')
      .select('*, projects(id, name, code, status)')
      .eq('contractor_id', contractorId)
    setContractorProjects((data ?? []) as ProjectContractorRow[])
    setTabsLoaded(prev => new Set([...prev, 'Projects']))
    setProjectsLoading(false)
  }, [contractorId])

  const loadIncidents = useCallback(async () => {
    setIncidentsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('incident_reports')
      .select('*, jobs(title)')
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
    setContractorIncidents((data ?? []) as IncidentReport[])
    setTabsLoaded(prev => new Set([...prev, 'Incidents']))
    setIncidentsLoading(false)
  }, [contractorId])

  const loadTeam = useCallback(async () => {
    setMembersLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('contractor_employees')
      .select('*, employees(name, surname)')
      .eq('contractor_id', contractorId)
    setMembers((data ?? []) as ContractorTeamMember[])
    setTabsLoaded(prev => new Set([...prev, 'Team']))
    setMembersLoading(false)
  }, [contractorId])

  async function handleSave() {
    if (!name.trim()) { setError('Company name is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase
      .from('contractors')
      .update({
        name: name.trim(),
        tax_number:                  taxNumber.trim() || null,
        is_vat_registered:           isVatRegistered,
        vat_number:                  isVatRegistered ? (vatNumber.trim() || null) : null,
        contact_person:              contactPerson.trim() || null,
        phone:                       phone.trim() || null,
        email:                       email.trim() || null,
        address:                     address.trim() || null,
        notes:                       notes.trim() || null,
        rating,
        is_active:                   isActive,
        compliance_pack:             compliancePack || null,
        account_holder_name:         accHolder.trim() || null,
        bank_name:                   payBankName.trim() || null,
        account_number:              payAccNumber.trim() || null,
        branch_code:                 payBranchCode.trim() || null,
        swift_bic:                   paySwiftBic.trim() || null,
        account_type:                payAccountType || null,
        payment_terms:               payTerms || null,
        preferred_payment_method:    payMethod || null,
        is_banking_verified:         bankingVerified,
        payment_hold:                paymentHold,
        compliance_hold:             complianceHold,
      })
      .eq('id', contractorId)

    if (e) setError(e.message)
    else setContractor(prev => prev ? { ...prev, name: name.trim(), is_active: isActive, rating } : prev)
    setSaving(false)
  }

  async function handleRotateCode() {
    const supabase = createClient()
    try { await supabase.rpc('rotate_contractor_portal_code', { p_contractor_id: contractorId }); load() } catch {}
  }

  async function approveBanking() {
    if (!pendingBanking) return
    setIsBusy(true)
    const supabase = createClient()
    try {
      await supabase.from('contractor_banking_updates').update({ status: 'approved' }).eq('id', pendingBanking.id)
      load()
    } catch {}
    setIsBusy(false)
  }

  async function rejectBanking() {
    if (!pendingBanking) return
    setIsBusy(true)
    const supabase = createClient()
    try {
      await supabase.from('contractor_banking_updates').update({ status: 'rejected' }).eq('id', pendingBanking.id)
      setPendingBanking(null)
    } catch {}
    setIsBusy(false)
  }

  async function approveDocument(doc: ComplianceDocument) {
    const supabase = createClient()
    await supabase.from('compliance_documents').update({ status: 'valid' }).eq('id', doc.id)
    setComplianceDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'valid' as const } : d))
  }

  async function rejectDocument(doc: ComplianceDocument) {
    const supabase = createClient()
    await supabase.from('compliance_documents').update({ status: 'rejected' }).eq('id', doc.id)
    setComplianceDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'rejected' as const } : d))
  }

  async function deleteDocument(doc: ComplianceDocument) {
    if (!window.confirm(`Delete "${doc.document_type}"?`)) return
    const supabase = createClient()
    await supabase.from('compliance_documents').delete().eq('id', doc.id)
    setComplianceDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  // Compliance calculations
  const requiredDocs      = complianceDocs.filter(d => d.is_required)
  const validRequired     = requiredDocs.filter(d => d.status === 'valid').length
  const expiringRequired  = requiredDocs.filter(d => d.status === 'expiring').length
  const expiredRequired   = requiredDocs.filter(d => d.status === 'expired').length
  const pendingRequired   = requiredDocs.filter(d => d.status === 'pending').length
  const rejectedRequired  = requiredDocs.filter(d => d.status === 'rejected').length
  const compScore = requiredDocs.length > 0
    ? Math.round((validRequired / requiredDocs.length) * 100)
    : 0
  const compScoreColor = compScore >= 80 ? '#22C55E' : compScore >= 50 ? '#F59E0B' : '#EF4444'

  const expiringDocs = complianceDocs.filter(d => {
    if (!d.expiry_date) return false
    const days = (new Date(d.expiry_date).getTime() - Date.now()) / 86400000
    return days <= 30 && days >= 0
  })

  // Document table computed
  const totalDocuments    = complianceDocs.length
  const approvedDocCount  = complianceDocs.filter(d => d.status === 'valid').length
  const pendingDocCount   = complianceDocs.filter(d => d.status === 'pending').length
  const rejectedDocCount  = complianceDocs.filter(d => d.status === 'rejected').length
  const expiredDocCount   = complianceDocs.filter(d => d.status === 'expired').length

  const filteredDocuments = complianceDocs
    .filter(d => {
      if (docFilter === 'approved') return d.status === 'valid'
      if (docFilter === 'pending')  return d.status === 'pending'
      if (docFilter === 'rejected') return d.status === 'rejected'
      if (docFilter === 'expired')  return d.status === 'expired'
      return true
    })
    .filter(d => !documentSearch || d.document_type.toLowerCase().includes(documentSearch.toLowerCase()))

  const hasContractorCode   = !!contractor?.contractor_code
  const showDocumentsSection = compliancePack !== '' || complianceDocs.length > 0
  const hasPendingBanking   = !!pendingBanking

  const pendingBankingDisplay = pendingBanking ? {
    ...pendingBanking,
    submittedAtDisplay:  fmtDate(pendingBanking.submitted_at),
    maskedAccount:       pendingBanking.account_number
      ? `••••${pendingBanking.account_number.slice(-4)}`
      : '—',
    accountTypeLabel: pendingBanking.account_type ?? '—',
  } : null

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
          <Link href="/dashboard/contractors" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary">{contractor?.name ?? 'Contractor'}</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-11 px-5 text-[15px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[96px]"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      {/* Tab bar */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-divider overflow-x-auto shrink-0">
        {TABS.map(t => {
          const active = tab === t
          const isOp   = OPERATIONAL_TABS.has(t)
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="rounded-[14px] h-[34px] px-3 text-[12px] font-medium border-0 shrink-0 transition-colors"
              style={{
                backgroundColor: active ? (isOp ? '#3B82F6' : '#1E3A5F') : '#E5E7EB',
                color: active ? '#FFFFFF' : '#6B7280',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* ── INFORMATION ── */}
        {tab === 'Information' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            <SectionCard title="COMPANY DETAILS">
              <FormField label="Company / trading name *">
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Company name" required className={entryClass} />
              </FormField>
              <FormSelect label="Partner type" value={partnerKind} onChange={e => setPartnerKind(e.target.value)}>
                <option value="">Select type…</option>
                {PARTNER_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </FormSelect>
              <FormField label="Registration number">
                <input type="text" value={regNumber} onChange={e => setRegNumber(e.target.value)}
                  placeholder="e.g. 2023/123456/07" className={entryClass} />
              </FormField>
              {hasContractorCode && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-text-primary font-semibold text-[14px]">Code: {contractor?.contractor_code}</span>
                  <span className="text-text-secondary text-[11px]">auto-generated</span>
                </div>
              )}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-[14px] font-medium text-text-primary">Rating</p>
                  <p className="text-primary text-[13px] font-semibold">★ {rating.toFixed(1)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setRating(r => Math.max(0, parseFloat((r - 0.5).toFixed(1))))}
                    className="w-8 h-8 rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors">−</button>
                  <span className="text-[14px] text-text-primary w-6 text-center">{rating}</span>
                  <button onClick={() => setRating(r => Math.min(5, parseFloat((r + 0.5).toFixed(1))))}
                    className="w-8 h-8 rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors">+</button>
                </div>
              </div>
              <div className="flex items-center justify-between py-1">
                <p className="text-[14px] font-medium text-text-primary">Active</p>
                <Toggle checked={isActive} onChange={setIsActive} />
              </div>
            </SectionCard>

            <SectionCard title="TAX & IDENTIFICATION">
              <FormField label="Tax number (SARS income tax ref.)">
                <input type="text" value={taxNumber} onChange={e => setTaxNumber(e.target.value)}
                  placeholder="e.g. 1234567890" className={entryClass} />
              </FormField>
              <div className="flex items-center justify-between py-1">
                <p className="text-[14px] font-medium text-text-primary">VAT Registered</p>
                <Toggle checked={isVatRegistered} onChange={setIsVatRegistered} />
              </div>
              <FormField label="VAT number">
                <input type="text" value={vatNumber} onChange={e => setVatNumber(e.target.value)}
                  placeholder="e.g. 4123456789" disabled={!isVatRegistered} className={entryClass} />
              </FormField>
            </SectionCard>

            {hasContractorCode && (
              <SectionCard title="CONTRACTOR PORTAL CODE">
                <p className="text-[12px] text-text-secondary">
                  Share with the subcontractor team — one code for sign-in, site time, photos, and messages.
                </p>
                <FormField label="Auto-generated">
                  <input readOnly value={contractor?.contractor_code ?? ''}
                    className={`${entryClass} text-text-secondary cursor-default`} />
                </FormField>
                <button onClick={handleRotateCode}
                  className="h-10 px-4 text-[12px] rounded-lg font-semibold transition-colors"
                  style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                  Rotate portal code
                </button>
                {contractor?.contractor_code_expires_at && (
                  <p className="text-[11px] text-text-secondary">
                    Expires: {fmtDate(contractor.contractor_code_expires_at)}
                  </p>
                )}
              </SectionCard>
            )}

            <SectionCard title="CONTACT">
              <FormField label="Contact person">
                <input type="text" value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                  placeholder="Full name" className={entryClass} />
              </FormField>
              <FormField label="Phone">
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+27…" className={entryClass} />
              </FormField>
              <FormField label="Email">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="email@contractor.co.za" className={entryClass} />
              </FormField>
              <FormField label="Address">
                <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="Physical address" className={entryClass} />
              </FormField>
            </SectionCard>

            <SectionCard title="NOTES">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Internal notes about this contractor…"
                rows={3} className={`${entryClass} resize-none h-auto min-h-[72px] py-3`} />
            </SectionCard>
          </div>
        )}

        {/* ── COMPLIANCE ── */}
        {tab === 'Compliance' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            <SectionCard title="COMPLIANCE PACK">
              <FormSelect label="Select compliance pack" value={compliancePack} onChange={e => setCompliancePack(e.target.value)}>
                <option value="">None</option>
                {COMPLIANCE_PACKS.map(p => <option key={p} value={p}>{p}</option>)}
              </FormSelect>
              {compliancePack ? (
                <div className="grid grid-cols-3 gap-2">
                  <KpiTile value={requiredDocs.length} label="Required" bg="#1E293B" valueFg="#94A3B8" labelFg="#94A3B8" />
                  <KpiTile value={validRequired}       label="Complete" bg="#14532D" valueFg="#22C55E" labelFg="#4ADE80" />
                  <KpiTile value={expiredRequired + rejectedRequired} label="Missing" bg="#2D0A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
                </div>
              ) : (
                <p className="text-text-secondary text-[12px]">
                  Assign a compliance pack to enable pack-based scoring and a required document checklist.
                </p>
              )}
            </SectionCard>

            {complianceDocs.length > 0 && (
              <SectionCard title="REQUIRED DOCUMENTS CHECKLIST">
                <p className="text-[11px] text-text-secondary">
                  Based on the assigned compliance pack. Required rows (Req.) count toward the compliance score.
                </p>
                <div className="border-t border-divider mt-1 divide-y divide-divider/40">
                  {complianceDocs.map(doc => {
                    const sc = STATUS_COLORS[doc.status] ?? STATUS_COLORS.pending
                    return (
                      <div key={doc.id} className="flex items-center gap-3 py-2">
                        <span className="rounded-[6px] px-[6px] py-[3px] text-[9px] font-medium shrink-0"
                          style={{ backgroundColor: doc.is_required ? '#450A0A' : '#1E293B', color: doc.is_required ? '#FCA5A5' : '#94A3B8' }}>
                          {doc.is_required ? 'Req.' : 'Opt.'}
                        </span>
                        <span className="text-text-primary text-[12px] flex-1">{doc.document_type}</span>
                        {doc.expiry_date && (
                          <span className="text-text-secondary text-[11px] shrink-0">{fmtDate(doc.expiry_date)}</span>
                        )}
                        <span className="rounded-lg px-2 py-[3px] text-[10px] font-medium shrink-0"
                          style={{ backgroundColor: sc.bg, color: sc.fg }}>
                          {doc.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            )}

            <SectionCard title="COMPLIANCE OVERVIEW">
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center shrink-0">
                  <span className="text-[30px] font-bold" style={{ color: compScoreColor }}>{compScore}%</span>
                  <span className="text-[10px] text-text-secondary">({validRequired} required)</span>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="h-[10px] rounded-full overflow-hidden bg-surface-elevated">
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${compScore}%`, backgroundColor: compScoreColor }} />
                  </div>
                  <p className="text-[10px] text-text-secondary">Required documents valid</p>
                </div>
                <span className="rounded-lg px-[10px] py-[6px] text-[12px] font-medium shrink-0"
                  style={{
                    backgroundColor: compScore >= 80 ? '#DCFCE7' : compScore >= 50 ? '#FEF3C7' : '#FEE2E2',
                    color: compScore >= 80 ? '#166534' : compScore >= 50 ? '#92400E' : '#991B1B',
                  }}>
                  {compScore >= 80 ? 'Compliant' : compScore >= 50 ? 'At Risk' : 'Non-Compliant'}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5 py-2">
                <KpiTile value={validRequired}    label="Valid"    bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
                <KpiTile value={expiringRequired} label="Expiring" bg="#292012" valueFg="#FCD34D" labelFg="#FCD34D" />
                <KpiTile value={expiredRequired}  label="Expired"  bg="#2D0A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
                <KpiTile value={pendingRequired}  label="Pending"  bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
                <KpiTile value={rejectedRequired} label="Rejected" bg="#2D0F0F" valueFg="#F87171" labelFg="#F87171" />
              </div>

              {requiredDocs.length === 0 && (
                <div className="rounded-lg border px-3 py-[10px] flex items-center gap-2"
                  style={{ borderColor: '#334155', backgroundColor: '#0F172A' }}>
                  <span className="material-icons text-[16px]" style={{ color: '#64748B' }}>info</span>
                  <p className="text-[12px] flex-1" style={{ color: '#64748B' }}>
                    No required documents configured. Assign a compliance pack first.
                  </p>
                </div>
              )}
              {expiredRequired > 0 && (
                <div className="rounded-lg border px-3 py-[10px] flex items-center gap-2"
                  style={{ borderColor: '#7F1D1D', backgroundColor: '#2D0A0A' }}>
                  <span className="material-icons text-[16px]" style={{ color: '#FCA5A5' }}>warning</span>
                  <p className="text-[12px] flex-1" style={{ color: '#FCA5A5' }}>
                    {expiredRequired} required document{expiredRequired > 1 ? 's' : ''} have expired.
                  </p>
                </div>
              )}
              {pendingRequired > 0 && (
                <div className="rounded-lg border px-3 py-[10px] flex items-center gap-2"
                  style={{ borderColor: '#78350F', backgroundColor: '#292012' }}>
                  <span className="material-icons text-[16px]" style={{ color: '#FCD34D' }}>info</span>
                  <p className="text-[12px] flex-1" style={{ color: '#FCD34D' }}>
                    {pendingRequired} required document{pendingRequired > 1 ? 's' : ''} pending review.
                  </p>
                </div>
              )}
              {rejectedRequired > 0 && (
                <div className="rounded-lg border px-3 py-[10px] flex items-center gap-2"
                  style={{ borderColor: '#7F1D1D', backgroundColor: '#2D0F0F' }}>
                  <span className="material-icons text-[16px]" style={{ color: '#F87171' }}>cancel</span>
                  <p className="text-[12px] flex-1" style={{ color: '#F87171' }}>
                    {rejectedRequired} required document{rejectedRequired > 1 ? 's' : ''} rejected.
                  </p>
                </div>
              )}
              {expiringDocs.length > 0 && (
                <div className="border-t border-divider pt-3 space-y-2">
                  <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Expiring Within 30 Days</p>
                  {expiringDocs.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2">
                      {doc.is_required && (
                        <span className="rounded-[6px] px-[6px] py-[3px] text-[9px] font-medium shrink-0"
                          style={{ backgroundColor: '#450A0A', color: '#FCA5A5' }}>Req.</span>
                      )}
                      <span className="text-text-primary text-[12px] flex-1">{doc.document_type}</span>
                      {doc.expiry_date && (
                        <span className="text-[11px] shrink-0" style={{ color: '#F59E0B' }}>{fmtDate(doc.expiry_date)}</span>
                      )}
                      <span className="material-icons text-[14px]" style={{ color: '#F59E0B' }}>warning</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Document table — shown when compliance pack set or docs exist */}
            {showDocumentsSection && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="section-label">COMPLIANCE DOCUMENTS</p>
                  <button className="btn-primary h-[34px] px-[14px] text-[12px]">+ Upload</button>
                </div>

                <div className="flex gap-1.5 flex-wrap">
                  <DocFilterChip count={totalDocuments}   label="Total"    active={docFilter === 'all'}      bg="#1E293B" valueFg="#CBD5E1" labelFg="#64748B" onClick={() => setDocFilter('all')} />
                  <DocFilterChip count={approvedDocCount} label="Approved" active={docFilter === 'approved'} bg="#14532D" valueFg="#22C55E" labelFg="#22C55E" onClick={() => setDocFilter('approved')} />
                  <DocFilterChip count={pendingDocCount}  label="Pending"  active={docFilter === 'pending'}  bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" onClick={() => setDocFilter('pending')} />
                  <DocFilterChip count={rejectedDocCount} label="Rejected" active={docFilter === 'rejected'} bg="#7F1D1D" valueFg="#FCA5A5" labelFg="#FCA5A5" onClick={() => setDocFilter('rejected')} />
                  <DocFilterChip count={expiredDocCount}  label="Expired"  active={docFilter === 'expired'}  bg="#450A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" onClick={() => setDocFilter('expired')} />
                </div>

                <div className="grid grid-cols-[1fr_180px] gap-2">
                  <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-2">
                    <span className="material-icons text-text-secondary text-[16px]">search</span>
                    <input placeholder="Search documents…" value={documentSearch}
                      onChange={e => setDocumentSearch(e.target.value)}
                      className="flex-1 bg-transparent text-text-primary text-[13px] h-[38px] outline-none placeholder:text-text-disabled" />
                  </div>
                  <FormSelect value="" onChange={() => {}}>
                    <option value="">Sort: Newest first</option>
                    <option value="name">Sort: Name A–Z</option>
                    <option value="expiry">Sort: Expiry</option>
                  </FormSelect>
                </div>

                <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
                  <table style={{ minWidth: 925 }} className="w-full">
                    <thead>
                      <tr className="bg-surface-elevated border-b border-divider">
                        <th style={{ width: 160 }} className="data-th">Type</th>
                        <th style={{ width: 175 }} className="data-th">Document Name</th>
                        <th style={{ width: 120 }} className="data-th">Status</th>
                        <th style={{ width: 115 }} className="data-th">Expires</th>
                        <th style={{ width:  65 }} className="data-th text-center">Req.</th>
                        <th style={{ width:  90 }} className="data-th text-center">Uploaded</th>
                        <th style={{ width: 185 }} className="data-th text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocuments.map(doc => {
                        const approval = DOC_APPROVAL_COLORS[doc.status] ?? DOC_APPROVAL_COLORS.pending
                        const hasExpiry = !!doc.expiry_date
                        const daysToExpiry = hasExpiry
                          ? (new Date(doc.expiry_date!).getTime() - Date.now()) / 86400000
                          : Infinity
                        const showWarn = daysToExpiry <= 30 && daysToExpiry >= 0
                        const expiryColor = daysToExpiry < 0 ? '#FCA5A5' : showWarn ? '#F59E0B' : 'var(--color-text-secondary)'
                        return (
                          <tr key={doc.id} className="bg-surface border-b border-divider last:border-0">
                            <td className="data-td text-[12px] truncate text-text-secondary">{doc.document_type}</td>
                            <td className="data-td">
                              <p className="text-[12px] text-text-primary truncate">{doc.document_name ?? doc.document_type}</p>
                              {doc.status === 'rejected' && doc.rejection_reason && (
                                <p className="text-[10px] truncate" style={{ color: '#FCA5A5' }}>↳ {doc.rejection_reason}</p>
                              )}
                            </td>
                            <td className="data-td">
                              <StatusBadge label={approval.label} bg={approval.bg} fg={approval.fg} />
                            </td>
                            <td className="data-td text-[11px]">
                              <div className="flex items-center gap-1">
                                {showWarn && <span className="material-icons text-[13px]" style={{ color: expiryColor }}>warning</span>}
                                <span style={{ color: expiryColor }}>
                                  {hasExpiry ? fmtDate(doc.expiry_date!) : '—'}
                                </span>
                              </div>
                            </td>
                            <td className="data-td text-center">
                              {doc.is_required
                                ? <span className="inline-block rounded-[6px] px-[6px] py-[3px] bg-[#450A0A] text-[#FCA5A5] text-[10px] font-medium">Req.</span>
                                : <span className="inline-block rounded-[6px] px-[6px] py-[3px] bg-[#1E293B] text-[#64748B] text-[10px] font-medium">Opt.</span>
                              }
                            </td>
                            <td className="data-td text-[11px] text-center text-text-secondary">
                              {fmtDate(doc.created_at)}
                            </td>
                            <td className="data-td text-right">
                              <button className="text-primary text-[11px] font-medium px-[5px] h-[30px]">View</button>
                              {doc.status !== 'valid' && (
                                <button onClick={() => approveDocument(doc)} className="text-[11px] font-medium px-[5px] h-[30px]" style={{ color: '#22C55E' }}>Approve</button>
                              )}
                              {doc.status !== 'rejected' && (
                                <button onClick={() => rejectDocument(doc)} className="text-[11px] font-medium px-[5px] h-[30px]" style={{ color: '#FCD34D' }}>Reject</button>
                              )}
                              <button onClick={() => deleteDocument(doc)} className="text-error text-[11px] font-medium px-[5px] h-[30px]">Delete</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filteredDocuments.length === 0 && (
                    <p className="text-text-secondary text-center py-6 text-[13px]">No documents match this filter.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PAYMENTS ── */}
        {tab === 'Payments' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            {hasPendingBanking && pendingBankingDisplay && (
              <div className="rounded-[10px] border border-[#78350F] bg-[#1A1200] p-[14px] space-y-[10px]">
                <div className="flex items-center gap-2">
                  <span className="material-icons text-[18px]" style={{ color: '#FCD34D' }}>info</span>
                  <div>
                    <p className="font-semibold text-[13px]" style={{ color: '#FCD34D' }}>Pending Banking Update — Requires Review</p>
                    <p className="text-[11px]" style={{ color: '#FDE68A' }}>Submitted by contractor: {pendingBankingDisplay.submittedAtDisplay}</p>
                  </div>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-y-1.5 mt-1">
                  <span className="text-[11px]" style={{ color: '#FDE68A' }}>Account Holder</span>
                  <span className="font-medium text-[12px] text-white">{pendingBankingDisplay.account_holder_name ?? '—'}</span>
                  <span className="text-[11px]" style={{ color: '#FDE68A' }}>Bank</span>
                  <span className="font-medium text-[12px] text-white">{pendingBankingDisplay.bank_name ?? '—'}</span>
                  <span className="text-[11px]" style={{ color: '#FDE68A' }}>Account No.</span>
                  <span className="font-medium text-[12px] text-white">{pendingBankingDisplay.maskedAccount}</span>
                  <span className="text-[11px]" style={{ color: '#FDE68A' }}>Account Type</span>
                  <span className="text-[12px]" style={{ color: '#FDE8A0' }}>{pendingBankingDisplay.accountTypeLabel}</span>
                </div>
                <div className="border-t border-[#78350F] my-1.5" />
                <div className="flex items-center gap-[10px]">
                  <p className="flex-1 text-[11px]" style={{ color: '#FDE68A' }}>
                    Approving copies these details to the contractor record. Banking verification will be reset.
                  </p>
                  <button onClick={rejectBanking} disabled={isBusy}
                    className="rounded-lg px-4 h-9 text-[12px] font-medium bg-[#450A0A] text-[#FCA5A5]">Reject</button>
                  <button onClick={approveBanking} disabled={isBusy}
                    className="rounded-lg px-4 h-9 text-[12px] font-semibold bg-[#14532D] text-[#22C55E]">Approve Banking</button>
                </div>
              </div>
            )}

            <div className="card p-4 space-y-3">
              <p className="section-label">BANKING DETAILS</p>
              <input placeholder="Account holder name (legal name) *" value={accHolder}
                onChange={e => setAccHolder(e.target.value)} className="dark-entry" />
              <input placeholder="Bank name" value={payBankName}
                onChange={e => setPayBankName(e.target.value)} className="dark-entry" />
              <input placeholder="Account number" value={payAccNumber}
                onChange={e => setPayAccNumber(e.target.value)} className="dark-entry" />
              <input placeholder="Branch code (6-digit)" value={payBranchCode}
                onChange={e => setPayBranchCode(e.target.value)} inputMode="numeric" className="dark-entry" />
              <FormSelect value={payAccountType} onChange={e => setPayAccountType(e.target.value)}>
                <option value="">Account type…</option>
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </FormSelect>
              <input placeholder="SWIFT / BIC (international transfers)" value={paySwiftBic}
                onChange={e => setPaySwiftBic(e.target.value)} className="dark-entry" />
            </div>

            <div className="card p-4 space-y-3">
              <p className="section-label">PAYMENT SETTINGS</p>
              <FormSelect value={payTerms} onChange={e => setPayTerms(e.target.value)}>
                <option value="">Payment terms…</option>
                {PAYMENT_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </FormSelect>
              <FormSelect value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                <option value="">Preferred payment method…</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </FormSelect>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-primary text-[14px]">Banking Verified</p>
                  <p className="text-text-secondary text-[11px]">Bank details confirmed against proof of banking.</p>
                </div>
                <Toggle checked={bankingVerified} onChange={setBankingVerified} activeColor="#16A34A" />
              </div>
              <div className="h-px bg-divider" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px]" style={{ color: paymentHold ? '#F59E0B' : 'var(--color-text-primary)' }}>Payment Hold</p>
                  <p className="text-text-secondary text-[11px]">Blocks all payouts to this contractor.</p>
                </div>
                <Toggle checked={paymentHold} onChange={setPaymentHold} activeColor="#D97706" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px]" style={{ color: complianceHold ? '#EF4444' : 'var(--color-text-primary)' }}>Compliance Hold</p>
                  <p className="text-text-secondary text-[11px]">Compliance documents missing or expired — blocks payments.</p>
                </div>
                <Toggle checked={complianceHold} onChange={setComplianceHold} activeColor="#DC2626" />
              </div>
            </div>
          </div>
        )}

        {/* ── TEAM ── */}
        {tab === 'Team' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            {membersLoading ? (
              <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="section-label flex-1">TEAM MEMBERS</p>
                  <button className="text-primary text-[13px] px-2">Invite</button>
                  <button className="btn-outlined h-9 px-3 text-[12px]">+ Add</button>
                </div>
                <div className="bg-surface rounded-lg border border-divider overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-elevated border-b border-divider">
                        <th className="data-th">Employee</th>
                        <th style={{ width: 120 }} className="data-th text-center">Role</th>
                        <th style={{ width:  80 }} className="data-th text-right">Primary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.length === 0 ? (
                        <tr><td colSpan={3} className="text-text-secondary text-center py-4 text-[13px]">No members linked.</td></tr>
                      ) : (
                        members.map(m => (
                          <tr key={m.id} className="bg-surface border-b border-divider last:border-0">
                            <td className="data-td text-text-primary">
                              {m.employees ? `${m.employees.name} ${m.employees.surname}` : '—'}
                            </td>
                            <td className="data-td text-text-secondary text-center">{m.role ?? '—'}</td>
                            <td className="data-td text-text-secondary text-right">{m.is_primary ? 'Yes' : '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── JOBS ── */}
        {tab === 'Jobs' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-[10px] border-b border-divider shrink-0">
              <p className="section-label">JOBS</p>
              {jobsLoading && <span className="text-text-secondary text-[12px]">Loading…</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="overflow-x-auto mx-4 my-2">
                <table style={{ minWidth: 700 }} className="w-full bg-surface rounded-lg border border-divider">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th style={{ width:  80 }} className="data-th">Code</th>
                      <th                        className="data-th">Title</th>
                      <th style={{ width:  90 }} className="data-th text-center">Role</th>
                      <th style={{ width:  90 }} className="data-th text-center">Status</th>
                      <th style={{ width:  80 }} className="data-th text-right">Scheduled</th>
                      <th style={{ width:  80 }} className="data-th text-right">Agreed</th>
                      <th style={{ width:  50 }} className="data-th text-center">📄</th>
                      <th style={{ width:  70 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractorJobs.length === 0 && !jobsLoading ? (
                      <tr><td colSpan={8} className="text-text-secondary text-center py-6 text-[13px]">No jobs linked to this contractor yet.</td></tr>
                    ) : (
                      contractorJobs.map(jc => {
                        const j = jc.jobs
                        const statusColors = JOB_STATUS_COLORS[j?.status ?? 'open'] ?? JOB_STATUS_COLORS.open
                        const hasFin = (jc.paid_amount ?? 0) > 0 || (jc.approved_amount ?? 0) > 0
                        const variance = (jc.paid_amount ?? 0) - (jc.agreed_amount ?? 0)
                        return (
                          <>
                            <tr key={jc.id} className="bg-surface border-b border-divider">
                              <td className="data-td text-text-secondary font-medium text-[12px]">—</td>
                              <td className="data-td text-text-primary text-[13px] truncate">{j?.title ?? '—'}</td>
                              <td className="data-td text-text-secondary text-center text-[12px]">{jc.role ?? '—'}</td>
                              <td className="data-td text-center">
                                <StatusBadge label={j?.status ?? 'open'} bg={statusColors.bg} fg={statusColors.fg} />
                              </td>
                              <td className="data-td text-text-secondary text-right text-[11px]">
                                {j?.scheduled_start ? fmtDate(j.scheduled_start) : '—'}
                              </td>
                              <td className="data-td text-text-secondary text-right text-[12px]">
                                {fmtCurrency(jc.agreed_amount)}
                              </td>
                              <td className="data-td text-center">
                                <button className="rounded w-[34px] h-7 text-[11px]" style={{ backgroundColor: '#1A2A1A', color: '#4ADE80' }}>📄</button>
                              </td>
                              <td className="data-td">
                                <button onClick={() => j?.id && router.push(`/dashboard/jobs/${j.id}`)}
                                  className="text-primary text-[11px] font-medium h-[30px]">Open →</button>
                              </td>
                            </tr>
                            {hasFin && (
                              <tr key={`${jc.id}-fin`} className="bg-surface border-b border-divider">
                                <td colSpan={2} className="px-[12px] pb-[6px] pt-0">
                                  <div className="flex gap-2 text-[10px]">
                                    <span className="text-text-secondary">Finance:</span>
                                    <span style={{ color: '#22C55E' }}>Paid {fmtCurrency(jc.paid_amount)}</span>
                                    <span style={{ color: '#0EA5E9' }}>Approved {fmtCurrency(jc.approved_amount)}</span>
                                    <span style={{ color: variance >= 0 ? '#EF4444' : '#22C55E' }}>
                                      {variance >= 0 ? `↑ Over R${Math.abs(variance).toFixed(2)}` : `↓ Under R${Math.abs(variance).toFixed(2)}`}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── PROJECTS ── */}
        {tab === 'Projects' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-[10px] border-b border-divider shrink-0">
              <p className="section-label">PROJECTS</p>
              {projectsLoading && <span className="text-text-secondary text-[12px]">Loading…</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="overflow-x-auto mx-4 my-2">
                <table style={{ minWidth: 450 }} className="w-full bg-surface rounded-lg border border-divider">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th style={{ width:  90 }} className="data-th">Code</th>
                      <th                        className="data-th">Project</th>
                      <th style={{ width: 100 }} className="data-th text-center">Role</th>
                      <th style={{ width:  90 }} className="data-th text-center">Status</th>
                      <th style={{ width:  70 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractorProjects.length === 0 && !projectsLoading ? (
                      <tr><td colSpan={5} className="text-text-secondary text-center py-6 text-[13px]">No projects linked to this contractor yet.</td></tr>
                    ) : (
                      contractorProjects.map(pc => {
                        const p = pc.projects
                        return (
                          <tr key={pc.id} className="bg-surface border-b border-divider last:border-0">
                            <td className="data-td text-text-secondary font-medium text-[12px]">{p?.code ?? '—'}</td>
                            <td className="data-td text-text-primary text-[13px] truncate">{p?.name ?? '—'}</td>
                            <td className="data-td text-text-secondary text-center text-[12px]">{pc.role ?? '—'}</td>
                            <td className="data-td text-center">
                              <StatusBadge
                                label={p?.status ?? 'draft'}
                                bg={p?.status === 'won' ? '#DCFCE7' : p?.status === 'in_progress' ? '#FEF3C7' : '#E5E7EB'}
                                fg={p?.status === 'won' ? '#166534' : p?.status === 'in_progress' ? '#92400E' : '#6B7280'}
                              />
                            </td>
                            <td className="data-td">
                              <button onClick={() => p?.id && router.push(`/dashboard/projects/${p.id}`)}
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
          </div>
        )}

        {/* ── INCIDENTS ── */}
        {tab === 'Incidents' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-[10px] border-b border-divider shrink-0">
              <p className="section-label">INCIDENTS</p>
              {incidentsLoading && <span className="text-text-secondary text-[12px]">Loading…</span>}
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="overflow-x-auto mx-4 my-2">
                <table style={{ minWidth: 530 }} className="w-full bg-surface rounded-lg border border-divider">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th style={{ width:  90 }} className="data-th">Date</th>
                      <th                        className="data-th">Incident</th>
                      <th style={{ width:  90 }} className="data-th text-center">Severity</th>
                      <th style={{ width:  90 }} className="data-th text-center">Status</th>
                      <th style={{ width:  40 }} className="data-th text-center">Job</th>
                      <th style={{ width:  40 }} className="data-th text-center">Proj</th>
                      <th style={{ width:  70 }} className="data-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractorIncidents.length === 0 && !incidentsLoading ? (
                      <tr><td colSpan={7} className="text-text-secondary text-center py-6 text-[13px]">No incidents linked to this contractor.</td></tr>
                    ) : (
                      contractorIncidents.map(inc => {
                        const sev = INCIDENT_SEVERITY_COLORS[inc.severity?.toLowerCase() ?? 'low'] ?? INCIDENT_SEVERITY_COLORS.low
                        const sta = INCIDENT_STATUS_COLORS[inc.status?.toLowerCase() ?? 'open'] ?? INCIDENT_STATUS_COLORS.open
                        return (
                          <tr key={inc.id} className="bg-surface border-b border-divider last:border-0">
                            <td className="data-td text-text-secondary text-[11px]">{fmtDate(inc.created_at)}</td>
                            <td className="data-td text-text-primary text-[13px] truncate">{inc.title ?? inc.description}</td>
                            <td className="data-td text-center"><StatusBadge label={inc.severity} bg={sev.bg} fg={sev.fg} /></td>
                            <td className="data-td text-center"><StatusBadge label={inc.status}   bg={sta.bg} fg={sta.fg} /></td>
                            <td className="data-td text-center text-text-secondary text-[11px]">{inc.job_id ? '●' : '—'}</td>
                            <td className="data-td text-center text-text-secondary text-[11px]">{inc.deal_id ? '●' : '—'}</td>
                            <td className="data-td">
                              <button onClick={() => router.push(`/dashboard/incidents/${inc.id}`)}
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
          </div>
        )}

        {/* ── DEFERRED TABS ── */}
        {['Activity', 'Quotes', 'Invoices'].includes(tab) && (
          <div className="flex-1 overflow-y-auto">
            <ComingSoon />
          </div>
        )}
      </div>
    </div>
  )
}
