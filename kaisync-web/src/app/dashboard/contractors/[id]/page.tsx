'use client'

import { useEffect, useState, useCallback, Suspense, useRef, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  isContractorKind,
  partnerKindLabel,
  PARTNER_KIND,
  nextContractorCode,
} from '@/lib/partner-kinds'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  buildComplianceView,
  checklistStatusLabel,
  documentTypeLabel,
} from '@/lib/contractor-portal/compliance'
import {
  CONTRACTOR_DOC_TYPES,
  type CompliancePackItem,
  type ContractorDocument,
} from '@/lib/contractor-portal/types'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { Toggle } from '@/components/Toggle'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ContractorActivityTab } from '@/components/ContractorActivityTab'
import { ContractorQuotesTab } from '@/components/ContractorQuotesTab'
import { ContractorInvoicesTab } from '@/components/ContractorInvoicesTab'
import { KpiTile } from '@/components/ui/KpiTile'
import { DocFilterChip } from '@/components/ui/DocFilterChip'
import type {
  Contractor, ComplianceDocument, JobContractor, Job, IncidentReport,
  ContractorTeamMember, PendingBankingUpdate, Project, ContractorCompliancePack, Employee,
} from '@/types/database'

const TABS = [
  'Information', 'Compliance', 'Payments', 'Team',
  'Jobs', 'Projects', 'Incidents', 'Activity', 'Quotes', 'Invoices',
]
const OPERATIONAL_TABS = new Set(['Jobs', 'Projects', 'Incidents'])

const ACCOUNT_TYPES = [
  { value: 'cheque', label: 'Cheque / Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'transmission', label: 'Transmission' },
]
const PAYMENT_TERMS_OPTIONS = [
  { value: '7_days', label: '7 days' },
  { value: '14_days', label: '14 days' },
  { value: '30_days', label: '30 days' },
  { value: '60_days', label: '60 days' },
  { value: 'on_completion', label: 'On completion' },
]
const PAYMENT_METHODS = [
  { value: 'eft', label: 'EFT' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
]

const CHECKLIST_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  complete: { bg: '#DCFCE7', fg: '#166534' },
  expiring: { bg: '#FEF3C7', fg: '#92400E' },
  expired:  { bg: '#FEE2E2', fg: '#991B1B' },
  pending:  { bg: '#E5E7EB', fg: '#6B7280' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
  missing:  { bg: '#1E293B', fg: '#94A3B8' },
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  approved:  { bg: '#DCFCE7', fg: '#166534' },
  expiring:  { bg: '#FEF3C7', fg: '#92400E' },
  expired:   { bg: '#FEE2E2', fg: '#991B1B' },
  pending:   { bg: '#E5E7EB', fg: '#6B7280' },
  rejected:  { bg: '#FEE2E2', fg: '#991B1B' },
}

const DOC_APPROVAL_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  approved: { bg: '#DCFCE7', fg: '#166534', label: 'Approved' },
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
  jobs?: Pick<Job, 'id' | 'title' | 'status' | 'scheduled_start' | 'deal_id' | 'job_code'> | null
}

type ProjectContractorRow = {
  id: string
  contractor_id: string
  deal_id: string
  role: string | null
  projects?: Pick<Project, 'id' | 'title' | 'project_code' | 'status'> | null
}

function docDisplayStatus(doc: ComplianceDocument): keyof typeof DOC_APPROVAL_COLORS {
  if (doc.approval_status === 'rejected') return 'rejected'
  if (doc.approval_status === 'pending') return 'pending'
  if (doc.expiry_date) {
    const days = (new Date(doc.expiry_date).getTime() - Date.now()) / 86400000
    if (days < 0) return 'expired'
    if (days <= 30) return 'expiring'
  }
  return 'approved'
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const fmtCurrency = (n: number | null) =>
  n != null ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'

export default function ContractorDetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    }>
      <ContractorDetailInner />
    </Suspense>
  )
}

function ContractorDetailInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromSuppliers = searchParams.get('from') === 'suppliers'
  const focusId = searchParams.get('focus')
  const focusType = searchParams.get('focusType')
  const contractorId = params.id

  // Legacy deep-link: send supplier module traffic to dedicated supplier detail
  useEffect(() => {
    if (fromSuppliers && contractorId) {
      router.replace(`/dashboard/suppliers/${contractorId}`)
    }
  }, [fromSuppliers, contractorId, router])

  const [tab, setTab] = useState('Information')
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [complianceDocs, setComplianceDocs] = useState<ComplianceDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [xeroLink,      setXeroLink]      = useState<{ xero_contact_id: string; last_synced_at: string } | null>(null)
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)
  const [sessionToken,  setSessionToken]  = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [focusDocId, setFocusDocId] = useState<string | null>(null)
  const [redirectingSupplier, setRedirectingSupplier] = useState(false)
  const canEdit = can(perms, PERM.contractorsEdit)

  // Information tab
  const [name, setName] = useState('')
  const [partnerKind, setPartnerKind] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [rating, setRating] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [portalEnabled, setPortalEnabled] = useState(false)
  const [taxNumber, setTaxNumber] = useState('')
  const [isVatRegistered, setIsVatRegistered] = useState(false)
  const [vatNumber, setVatNumber] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [compliancePackId, setCompliancePackId] = useState('')
  const [compliancePacks, setCompliancePacks] = useState<ContractorCompliancePack[]>([])
  const [packItems, setPackItems] = useState<CompliancePackItem[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadDocType, setUploadDocType] = useState('other')
  const [docBusy, setDocBusy] = useState(false)

  // Compliance tab
  const [docFilter, setDocFilter] = useState<DocFilterType>('all')
  const [documentSearch, setDocumentSearch] = useState('')
  const [docSort, setDocSort] = useState<'newest' | 'name' | 'expiry'>('newest')

  // Payments tab
  const [accHolder, setAccHolder] = useState('')
  const [payBankName, setPayBankName] = useState('')
  const [payAccNumber, setPayAccNumber] = useState('')
  const [payBranchCode, setPayBranchCode] = useState('')
  const [paySwiftBic, setPaySwiftBic] = useState('')
  const [payAccountType, setPayAccountType] = useState('cheque')
  const [payTerms, setPayTerms] = useState('30_days')
  const [payMethod, setPayMethod] = useState('eft')
  const [bankingVerified, setBankingVerified] = useState(false)
  const [paymentHold, setPaymentHold] = useState(false)
  const [complianceHold, setComplianceHold] = useState(false)
  const [pendingBanking, setPendingBanking] = useState<PendingBankingUpdate | null>(null)

  // Lazy-loaded tab data
  const [members, setMembers] = useState<ContractorTeamMember[]>([])
  const [companyEmployees, setCompanyEmployees] = useState<Pick<Employee, 'id' | 'name' | 'surname'>[]>([])
  const [addMemberId, setAddMemberId] = useState('')
  const [addMemberRole, setAddMemberRole] = useState('')
  const [contractorJobs, setContractorJobs] = useState<JobContractorRow[]>([])
  const [contractorProjects, setContractorProjects] = useState<ProjectContractorRow[]>([])
  const [contractorIncidents, setContractorIncidents] = useState<IncidentReport[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [incidentsLoading, setIncidentsLoading] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [tabsLoaded, setTabsLoaded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && TABS.includes(t)) setTab(t)
    if (focusType?.startsWith('document_') && focusId) {
      setFocusDocId(focusId)
      setDocFilter('all')
    }
  }, [searchParams, focusId, focusType])

  useEffect(() => {
    if (tab !== 'Payments' || focusType !== 'banking_pending') return
    const el = document.getElementById('pending-banking-review')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [tab, focusType, pendingBanking, loading])

  useEffect(() => {
    if (tab !== 'Compliance' || !focusDocId) return
    const el = document.getElementById(`compliance-doc-${focusDocId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [tab, focusDocId, complianceDocs, loading])

  useEffect(() => { load() }, [contractorId])

  useEffect(() => {
    void (async () => {
      if (!compliancePackId) {
        setPackItems([])
        return
      }
      const supabase = createClient()
      const { data } = await supabase
        .from('contractor_compliance_pack_items')
        .select('document_type, requirement, sort_order')
        .eq('pack_id', compliancePackId)
        .order('sort_order')
      setPackItems((data ?? []) as CompliancePackItem[])
    })()
  }, [compliancePackId])

  useEffect(() => {
    if (tab === 'Jobs'      && !tabsLoaded.has('Jobs'))      loadJobs()
    if (tab === 'Projects'  && !tabsLoaded.has('Projects'))  loadProjects()
    if (tab === 'Incidents' && !tabsLoaded.has('Incidents')) loadIncidents()
    if (tab === 'Team'      && !tabsLoaded.has('Team'))      loadTeam()
  }, [tab])

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
    }

    const { data: c } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', contractorId)
      .single()

    if (!c) { router.push(fromSuppliers ? '/dashboard/suppliers' : '/dashboard/contractors'); return }
    const cont = c as Contractor
    // Pure suppliers belong on the suppliers module — keep contractor routes contractor-kind only.
    if (!isContractorKind(cont.partner_kind) && cont.partner_kind) {
      setRedirectingSupplier(true)
      router.replace(`/dashboard/suppliers/${contractorId}`)
      return
    }
    setContractor(cont)

    setName(cont.name ?? '')
    setRating(cont.rating ?? 0)
    setIsActive(cont.is_active ?? true)
    setPortalEnabled(cont.portal_enabled ?? false)
    setTaxNumber(cont.tax_number ?? '')
    setIsVatRegistered(cont.is_vat_registered ?? false)
    setVatNumber(cont.vat_number ?? '')
    setContactPerson(cont.contact_person ?? '')
    setPhone(cont.phone ?? '')
    setEmail(cont.email ?? '')
    setAddress(cont.address ?? '')
    setNotes(cont.notes ?? '')
    setCompliancePackId(cont.compliance_pack_id ?? '')
    setPartnerKind(cont.partner_kind ?? '')
    setRegNumber(cont.registration_number ?? '')

    setAccHolder(cont.account_holder_name ?? '')
    setPayBankName(cont.bank_name ?? '')
    setPayAccNumber(cont.bank_account ?? '')
    setPayBranchCode(cont.bank_branch_code ?? '')
    setPaySwiftBic(cont.swift_bic ?? '')
    setPayAccountType(cont.account_type ?? 'cheque')
    setPayTerms(cont.payment_terms ?? '30_days')
    setPayMethod(cont.preferred_payment_method ?? 'eft')
    setBankingVerified(cont.banking_verified ?? false)
    setPaymentHold(cont.payment_hold ?? false)
    setComplianceHold(cont.compliance_hold ?? false)

    const [docsRes, pendingRes, packsRes] = await Promise.all([
      supabase.from('contractor_documents').select('*').eq('contractor_id', contractorId).eq('is_current', true).order('created_at', { ascending: false }),
      supabase.from('contractor_banking_updates').select('*').eq('contractor_id', contractorId).eq('status', 'pending').maybeSingle(),
      supabase.from('contractor_compliance_packs').select('*').eq('company_id', cont.company_id).eq('is_archived', false).order('sort_order'),
    ])
    setComplianceDocs((docsRes.data ?? []) as ComplianceDocument[])
    setPendingBanking(pendingRes.data as PendingBankingUpdate | null)
    setCompliancePacks((packsRes.data ?? []) as ContractorCompliancePack[])
    const cId = cont.company_id
    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: lnk } = await (supabase.rpc as any)('get_xero_link_for_record', {
        p_company_id: cId, p_record_type: 'contractor', p_record_id: contractorId,
      })
      setXeroLink(lnk ?? null)
    }
    const { data: { session } } = await supabase.auth.getSession()
    setSessionToken(session?.access_token ?? null)
    setLoading(false)
  }

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('job_contractors')
      .select('*, jobs(id, title, status, scheduled_start, deal_id, job_code)')
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
      .select('*, projects:client_deals(id, title, project_code, status)')
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
    const member = await resolveCurrentMember(supabase)
    const [linksRes, empRes] = await Promise.all([
      supabase
        .from('contractor_member_links')
        .select('*, employees(name, surname)')
        .eq('contractor_id', contractorId),
      member
        ? supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name')
        : Promise.resolve({ data: [] as Pick<Employee, 'id' | 'name' | 'surname'>[] }),
    ])
    setMembers((linksRes.data ?? []) as ContractorTeamMember[])
    setCompanyEmployees((empRes.data ?? []) as Pick<Employee, 'id' | 'name' | 'surname'>[])
    setTabsLoaded(prev => new Set([...prev, 'Team']))
    setMembersLoading(false)
  }, [contractorId])

  async function handleSave() {
    if (!canEdit) { setError('You do not have permission to edit contractors.'); return }
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
        portal_enabled:              portalEnabled,
        compliance_pack_id:          compliancePackId || null,
        account_holder_name:         accHolder.trim() || null,
        bank_name:                   payBankName.trim() || null,
        bank_account:                payAccNumber.trim() || null,
        bank_branch_code:            payBranchCode.trim() || null,
        swift_bic:                   paySwiftBic.trim() || null,
        account_type:                payAccountType || null,
        payment_terms:               payTerms || null,
        preferred_payment_method:    payMethod || null,
        banking_verified:            bankingVerified,
        payment_hold:                paymentHold,
        compliance_hold:             complianceHold,
        ...(partnerKind ? { partner_kind: partnerKind } : {}),
        registration_number:         regNumber.trim() || null,
      })
      .eq('id', contractorId)

    if (e) setError(e.message)
    else setContractor(prev => prev
      ? {
          ...prev,
          name: name.trim(),
          is_active: isActive,
          portal_enabled: portalEnabled,
          rating,
          compliance_pack_id: compliancePackId || null,
          banking_verified: bankingVerified,
          bank_branch_code: payBranchCode.trim() || null,
        }
      : prev)
    setSaving(false)
  }

  /** Assign a permanent CT#### code once if missing — never rotates/replaces an existing code. */
  async function ensurePermanentContractorCode(): Promise<string | null> {
    if (!canEdit) return null
    if (!contractor?.company_id) return null
    if (contractor.contractor_code) return contractor.contractor_code

    const supabase = createClient()
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', contractor.company_id).maybeSingle(),
      supabase.from('contractors').select('contractor_code').eq('company_id', contractor.company_id),
    ])
    const companyCode = (company as { code?: string | null } | null)?.code ?? ''
    const code = nextContractorCode(
      companyCode,
      (existing ?? []).map(r => (r as { contractor_code: string | null }).contractor_code),
    )
    const { error: e } = await supabase
      .from('contractors')
      .update({ contractor_code: code })
      .eq('id', contractorId)
      .is('contractor_code', null)
    if (e) {
      setError(e.message)
      return null
    }
    return code
  }

  async function handlePortalToggle(next: boolean) {
    if (!canEdit) return
    setPortalEnabled(next)
    if (!next || hasContractorCode || !contractor?.company_id) return

    setIsBusy(true)
    setError(null)
    const code = await ensurePermanentContractorCode()
    if (code) {
      const supabase = createClient()
      await supabase.from('contractors').update({ portal_enabled: true }).eq('id', contractorId)
      await load()
    }
    setIsBusy(false)
  }

  async function approveBanking() {
    if (!canEdit || !pendingBanking) return
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Account not linked.'); setIsBusy(false); return }
    const { error: e } = await supabase.rpc('hr_approve_contractor_banking', {
      p_update_id: pendingBanking.id,
      p_reviewed_by: member.employeeId,
    })
    if (e) setError(e.message)
    else await load()
    setIsBusy(false)
  }

  async function rejectBanking() {
    if (!canEdit || !pendingBanking) return
    const reason = window.prompt('Rejection reason (required):')
    if (!reason?.trim()) return
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Account not linked.'); setIsBusy(false); return }
    const { error: e } = await supabase.rpc('hr_reject_contractor_banking', {
      p_update_id: pendingBanking.id,
      p_reviewed_by: member.employeeId,
      p_reason: reason.trim(),
    })
    if (e) setError(e.message)
    else {
      setPendingBanking(null)
      await load()
    }
    setIsBusy(false)
  }

  async function approveDocument(doc: ComplianceDocument) {
    if (!canEdit) return
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    const { error: e } = await supabase.from('contractor_documents').update({
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: member?.employeeId ?? null,
      rejected_reason: null,
    }).eq('id', doc.id)
    if (e) { setError(e.message); return }
    setComplianceDocs(prev => prev.map(d => d.id === doc.id
      ? { ...d, approval_status: 'approved' as const, rejected_reason: null }
      : d))
  }

  async function rejectDocument(doc: ComplianceDocument) {
    if (!canEdit) return
    const reason = window.prompt('Rejection reason:')
    if (reason == null) return
    const supabase = createClient()
    const { error: e } = await supabase.from('contractor_documents').update({
      approval_status: 'rejected',
      rejected_reason: reason.trim() || null,
    }).eq('id', doc.id)
    if (e) { setError(e.message); return }
    setComplianceDocs(prev => prev.map(d => d.id === doc.id
      ? { ...d, approval_status: 'rejected' as const, rejected_reason: reason.trim() || null }
      : d))
  }

  async function deleteDocument(doc: ComplianceDocument) {
    if (!canEdit) return
    if (!window.confirm(`Delete "${doc.document_name}"?`)) return
    const supabase = createClient()
    if (doc.storage_path) {
      await supabase.storage.from('workforce-media').remove([doc.storage_path])
    }
    await supabase.from('contractor_documents').delete().eq('id', doc.id)
    setComplianceDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  async function uploadDocument(file: File) {
    if (!canEdit || !contractor) return
    setDocBusy(true)
    setError(null)
    const supabase = createClient()
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
    const path = `contractor_documents/${contractor.company_id}/${contractorId}/hr_${crypto.randomUUID()}${ext}`
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (upErr) {
      setError(upErr.message)
      setDocBusy(false)
      return
    }
    const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(path)
    const { data, error: insErr } = await supabase.from('contractor_documents').insert({
      company_id: contractor.company_id,
      contractor_id: contractorId,
      document_type: uploadDocType || 'other',
      document_name: file.name,
      file_url: pub.publicUrl,
      storage_path: path,
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      is_required: false,
      is_current: true,
      uploaded_by_role: 'hr',
    }).select().single()
    if (insErr) setError(insErr.message)
    else if (data) setComplianceDocs(prev => [data as ComplianceDocument, ...prev])
    if (fileRef.current) fileRef.current.value = ''
    setDocBusy(false)
  }

  async function addTeamMember() {
    if (!canEdit || !addMemberId || !contractor) return
    if (members.some(m => m.employee_id === addMemberId)) {
      setError('That employee is already linked to this contractor.')
      return
    }
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('contractor_member_links').insert({
      company_id: contractor.company_id,
      contractor_id: contractorId,
      employee_id: addMemberId,
      role: addMemberRole.trim() || null,
      is_primary: members.length === 0,
    })
    if (e) {
      const msg = e.message.toLowerCase()
      setError(
        msg.includes('duplicate') || msg.includes('unique') || e.code === '23505'
          ? 'That employee is already linked to this contractor.'
          : e.message,
      )
    } else {
      setAddMemberId('')
      setAddMemberRole('')
      await loadTeam()
    }
    setIsBusy(false)
  }

  async function removeTeamMember(id: string) {
    if (!canEdit) return
    if (!window.confirm('Remove this team member link?')) return
    const supabase = createClient()
    await supabase.from('contractor_member_links').delete().eq('id', id)
    setMembers(prev => prev.filter(m => m.id !== id))
  }

  async function pushToXero() {
    if (!canEdit || !contractor?.company_id || !sessionToken || xeroPushing) return
    setXeroPushing(true)
    setXeroMsg(null)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: contractor.company_id, record_id: contractorId, record_type: 'contractor' }),
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

  async function copyPortalCode() {
    const code = contractor?.contractor_code
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      setError('Could not copy portal code to clipboard.')
    }
  }

  // Compliance calculations — pack checklist when assigned (parity with portal/MAUI)
  const portalDocs = useMemo<ContractorDocument[]>(
    () => complianceDocs.map(d => ({
      id: d.id,
      company_id: d.company_id,
      contractor_id: d.contractor_id,
      document_type: d.document_type,
      document_name: d.document_name,
      file_url: d.file_url,
      storage_path: d.storage_path,
      approval_status: d.approval_status,
      rejected_reason: d.rejected_reason,
      is_required: d.is_required,
      is_current: d.is_current,
      uploaded_by_role: d.uploaded_by_role,
      expiry_date: d.expiry_date,
      created_at: d.created_at,
      updated_at: d.created_at,
    })),
    [complianceDocs],
  )
  const complianceView = useMemo(
    () => buildComplianceView(portalDocs, packItems),
    [portalDocs, packItems],
  )
  const requiredDocsCount = complianceView.required_count
  const validRequired = complianceView.complete_count
  const expiringRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'expiring').length
  const expiredRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'expired').length
  const pendingRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'pending').length
  const rejectedRequired = complianceView.checklist.filter(r => r.is_required && r.status === 'rejected').length
  const missingRequired = complianceView.missing_count
  const compScore = complianceView.score_percent
  const compScoreColor = compScore >= 80 ? '#22C55E' : compScore >= 50 ? '#F59E0B' : '#EF4444'
  const compStatusLabel = complianceView.status_label === 'Near Compliant'
    ? 'At Risk'
    : complianceView.status_label === 'Not Configured'
      ? 'Not Configured'
      : complianceView.status_label === 'Compliant'
        ? 'Compliant'
        : complianceView.status_label === 'Partial'
          ? 'At Risk'
          : 'Non-Compliant'

  const expiringDocs = complianceDocs.filter(d => docDisplayStatus(d) === 'expiring')

  // Document table computed
  const totalDocuments    = complianceDocs.length
  const approvedDocCount  = complianceDocs.filter(d => docDisplayStatus(d) === 'approved').length
  const pendingDocCount   = complianceDocs.filter(d => d.approval_status === 'pending').length
  const rejectedDocCount  = complianceDocs.filter(d => d.approval_status === 'rejected').length
  const expiredDocCount   = complianceDocs.filter(d => docDisplayStatus(d) === 'expired').length

  const filteredDocuments = complianceDocs
    .filter(d => {
      const status = docDisplayStatus(d)
      if (docFilter === 'approved') return status === 'approved'
      if (docFilter === 'pending')  return status === 'pending'
      if (docFilter === 'rejected') return status === 'rejected'
      if (docFilter === 'expired')  return status === 'expired'
      return true
    })
    .filter(d => !documentSearch
      || d.document_type.toLowerCase().includes(documentSearch.toLowerCase())
      || d.document_name.toLowerCase().includes(documentSearch.toLowerCase()))
    .sort((a, b) => {
      if (docSort === 'name') return a.document_name.localeCompare(b.document_name)
      if (docSort === 'expiry') {
        if (!a.expiry_date && !b.expiry_date) return 0
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return a.expiry_date.localeCompare(b.expiry_date)
      }
      return b.created_at.localeCompare(a.created_at)
    })

  const hasContractorCode   = !!contractor?.contractor_code
  const showDocumentsSection = compliancePackId !== '' || complianceDocs.length > 0
  const hasPendingBanking   = !!pendingBanking

  const pendingBankingDisplay = pendingBanking ? {
    ...pendingBanking,
    submittedAtDisplay:  fmtDate(pendingBanking.submitted_at),
    maskedAccount:       pendingBanking.bank_account
      ? `••••${pendingBanking.bank_account.slice(-4)}`
      : '—',
    accountTypeLabel: pendingBanking.account_type ?? '—',
  } : null

  if (fromSuppliers || redirectingSupplier) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Opening supplier…</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  const listHref = '/dashboard/contractors'
  const entityLabel = partnerKindLabel(partnerKind) || 'Contractor'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href={listHref} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-[20px] font-semibold text-text-primary">{contractor?.name ?? entityLabel}</h1>
            <p className="text-[11px] text-text-secondary mt-0.5">{entityLabel}</p>
            {xeroConnected && (
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
          onClick={handleSave}
          disabled={saving || !canEdit}
          title={!canEdit ? 'You do not have permission to edit contractors' : undefined}
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">
            <SectionCard title="COMPANY DETAILS">
              <FormField label="Company / trading name *">
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Company name" required className={entryClass} />
              </FormField>
              <FormSelect label="Partner kind" value={partnerKind} onChange={e => setPartnerKind(e.target.value)}>
                <option value="">Select kind…</option>
                <option value={PARTNER_KIND.contractor}>Contractor</option>
                <option value={PARTNER_KIND.both}>Contractor &amp; supplier</option>
              </FormSelect>
              <p className="text-[11px] text-text-secondary -mt-1">
                Pure suppliers are managed under{' '}
                <Link href="/dashboard/suppliers" className="text-primary hover:underline">Suppliers</Link>.
              </p>
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

            <SectionCard title="CONTRACTOR PORTAL">
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-[14px] font-medium text-text-primary">Portal user</p>
                  <p className="text-[12px] text-text-secondary">
                    Enables portal login and uses 1 contractor seat (50 included, then R49/month).
                  </p>
                </div>
                <Toggle checked={portalEnabled} onChange={handlePortalToggle} />
              </div>
              {hasContractorCode && (
                <>
                  <FormField label="Portal code">
                    <div className="flex gap-2">
                      <input readOnly value={contractor?.contractor_code ?? ''}
                        className={`${entryClass} text-text-secondary cursor-default flex-1`} />
                      <button
                        type="button"
                        onClick={() => void copyPortalCode()}
                        className="h-11 px-3 rounded-lg border border-border text-[12px] font-medium text-primary shrink-0 hover:bg-surface-elevated"
                      >
                        {codeCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </FormField>
                  <p className="text-[11px] text-text-secondary">
                    Permanent login code (assigned once). Contractors sign in with company code + this code.
                    Disable Portal user to revoke access without changing the code.
                  </p>
                </>
              )}
              {!hasContractorCode && portalEnabled && (
                <p className="text-[12px] text-text-secondary">Assigning portal code…</p>
              )}
              {!hasContractorCode && !portalEnabled && (
                <p className="text-[11px] text-text-secondary">
                  Enable Portal user to assign a permanent code (same format as create: CT…).
                </p>
              )}
            </SectionCard>

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
          <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">
            <SectionCard title="COMPLIANCE PACK">
              <FormSelect label="Select compliance pack" value={compliancePackId} onChange={e => setCompliancePackId(e.target.value)}>
                <option value="">None</option>
                {compliancePacks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </FormSelect>
              {compliancePackId ? (
                <div className="grid grid-cols-3 gap-2">
                  <KpiTile value={requiredDocsCount} label="Required" bg="#1E293B" valueFg="#94A3B8" labelFg="#94A3B8" />
                  <KpiTile value={validRequired} label="Complete" bg="#14532D" valueFg="#22C55E" labelFg="#4ADE80" />
                  <KpiTile value={missingRequired + rejectedRequired + expiredRequired} label="Missing" bg="#2D0A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
                </div>
              ) : (
                <p className="text-text-secondary text-[12px]">
                  Assign a compliance pack to enable pack-based scoring and a required document checklist.
                </p>
              )}
            </SectionCard>

            {complianceView.has_pack && complianceView.checklist.length > 0 && (
              <SectionCard title="REQUIRED DOCUMENTS CHECKLIST">
                <p className="text-[11px] text-text-secondary">
                  Based on the assigned compliance pack. Required rows (Req.) count toward the compliance score.
                  Missing types appear here even before a file is uploaded.
                </p>
                <div className="border-t border-divider mt-1 divide-y divide-divider/40">
                  {complianceView.checklist.map(row => {
                    const sc = CHECKLIST_STATUS_COLORS[row.status] ?? CHECKLIST_STATUS_COLORS.missing
                    return (
                      <div key={row.document_type} className="flex items-center gap-3 py-2">
                        <span className="rounded-[6px] px-[6px] py-[3px] text-[9px] font-medium shrink-0"
                          style={{ backgroundColor: row.is_required ? '#450A0A' : '#1E293B', color: row.is_required ? '#FCA5A5' : '#94A3B8' }}>
                          {row.is_required ? 'Req.' : 'Opt.'}
                        </span>
                        <span className="text-text-primary text-[12px] flex-1">{row.type_label}</span>
                        {row.expiry_display && (
                          <span className="text-text-secondary text-[11px] shrink-0">{row.expiry_display}</span>
                        )}
                        <span className="rounded-lg px-2 py-[3px] text-[10px] font-medium shrink-0"
                          style={{ backgroundColor: sc.bg, color: sc.fg }}>
                          {checklistStatusLabel(row.status)}
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
                  <span className="text-[10px] text-text-secondary">({validRequired}/{requiredDocsCount} required)</span>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="h-[10px] rounded-full overflow-hidden bg-surface-elevated">
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${compScore}%`, backgroundColor: compScoreColor }} />
                  </div>
                  <p className="text-[10px] text-text-secondary">
                    {complianceView.has_pack
                      ? 'Required pack types with approved, non-expired documents'
                      : 'Legacy mode: documents marked required'}
                  </p>
                </div>
                <span className="rounded-lg px-[10px] py-[6px] text-[12px] font-medium shrink-0"
                  style={{
                    backgroundColor: compScore >= 80 ? '#DCFCE7' : compScore >= 50 ? '#FEF3C7' : '#FEE2E2',
                    color: compScore >= 80 ? '#166534' : compScore >= 50 ? '#92400E' : '#991B1B',
                  }}>
                  {compStatusLabel}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5 py-2">
                <KpiTile value={validRequired}    label="Valid"    bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
                <KpiTile value={expiringRequired} label="Expiring" bg="#292012" valueFg="#FCD34D" labelFg="#FCD34D" />
                <KpiTile value={expiredRequired}  label="Expired"  bg="#2D0A0A" valueFg="#FCA5A5" labelFg="#FCA5A5" />
                <KpiTile value={pendingRequired}  label="Pending"  bg="#1E293B" valueFg="#94A3B8" labelFg="#64748B" />
                <KpiTile value={rejectedRequired} label="Rejected" bg="#2D0F0F" valueFg="#F87171" labelFg="#F87171" />
              </div>

              {requiredDocsCount === 0 && (
                <div className="rounded-lg border px-3 py-[10px] flex items-center gap-2"
                  style={{ borderColor: '#334155', backgroundColor: '#0F172A' }}>
                  <span className="material-icons text-[16px]" style={{ color: '#64748B' }}>info</span>
                  <p className="text-[12px] flex-1" style={{ color: '#64748B' }}>
                    No required documents configured. Assign a compliance pack first.
                  </p>
                </div>
              )}
              {missingRequired > 0 && (
                <div className="rounded-lg border px-3 py-[10px] flex items-center gap-2"
                  style={{ borderColor: '#334155', backgroundColor: '#0F172A' }}>
                  <span className="material-icons text-[16px]" style={{ color: '#94A3B8' }}>description</span>
                  <p className="text-[12px] flex-1" style={{ color: '#94A3B8' }}>
                    {missingRequired} required type{missingRequired > 1 ? 's' : ''} still missing an upload.
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
                      <span className="text-text-primary text-[12px] flex-1">{documentTypeLabel(doc.document_type)}</span>
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
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="section-label">COMPLIANCE DOCUMENTS</p>
                  <div className="flex items-center gap-2">
                    <select
                      value={uploadDocType}
                      onChange={e => setUploadDocType(e.target.value)}
                      className="text-[11px] h-[34px] px-2 rounded-lg border border-border bg-surface text-text-secondary"
                    >
                      {CONTRACTOR_DOC_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) void uploadDocument(file)
                      }}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        disabled={docBusy}
                        onClick={() => fileRef.current?.click()}
                        className="btn-primary h-[34px] px-[14px] text-[12px] disabled:opacity-50"
                      >
                        {docBusy ? 'Uploading…' : '+ Upload'}
                      </button>
                    )}
                  </div>
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
                  <FormSelect value={docSort} onChange={e => setDocSort(e.target.value as 'newest' | 'name' | 'expiry')}>
                    <option value="newest">Sort: Newest first</option>
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
                        const status = docDisplayStatus(doc)
                        const approval = DOC_APPROVAL_COLORS[status] ?? DOC_APPROVAL_COLORS.pending
                        const hasExpiry = !!doc.expiry_date
                        const daysToExpiry = hasExpiry
                          ? (new Date(doc.expiry_date!).getTime() - Date.now()) / 86400000
                          : Infinity
                        const showWarn = daysToExpiry <= 30 && daysToExpiry >= 0
                        const expiryColor = daysToExpiry < 0 ? '#FCA5A5' : showWarn ? '#F59E0B' : 'var(--color-text-secondary)'
                        return (
                          <tr
                            id={`compliance-doc-${doc.id}`}
                            key={doc.id}
                            className={`bg-surface border-b border-divider last:border-0 ${
                              focusDocId === doc.id ? 'ring-2 ring-primary/60 ring-inset' : ''
                            }`}
                          >
                            <td className="data-td text-[12px] truncate text-text-secondary">{documentTypeLabel(doc.document_type)}</td>
                            <td className="data-td">
                              <p className="text-[12px] text-text-primary truncate">{doc.document_name}</p>
                              {doc.approval_status === 'rejected' && doc.rejected_reason && (
                                <p className="text-[10px] truncate" style={{ color: '#FCA5A5' }}>↳ {doc.rejected_reason}</p>
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
                              <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-primary text-[11px] font-medium px-[5px] h-[30px] inline-flex items-center">View</a>
                              {doc.approval_status !== 'approved' && (
                                <button onClick={() => approveDocument(doc)} className="text-[11px] font-medium px-[5px] h-[30px]" style={{ color: '#22C55E' }}>Approve</button>
                              )}
                              {doc.approval_status !== 'rejected' && (
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">
            {hasPendingBanking && pendingBankingDisplay && (
              <div id="pending-banking-review" className="rounded-[10px] border border-[#78350F] bg-[#1A1200] p-[14px] space-y-[10px]">
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
                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </FormSelect>
              <input placeholder="SWIFT / BIC (international transfers)" value={paySwiftBic}
                onChange={e => setPaySwiftBic(e.target.value)} className="dark-entry" />
            </div>

            <div className="card p-4 space-y-3">
              <p className="section-label">PAYMENT SETTINGS</p>
              <FormSelect value={payTerms} onChange={e => setPayTerms(e.target.value)}>
                <option value="">Payment terms…</option>
                {PAYMENT_TERMS_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </FormSelect>
              <FormSelect value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                <option value="">Preferred payment method…</option>
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
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
                  <p className="text-text-secondary text-[11px]">Warns before create/pay — optional to proceed.</p>
                </div>
                <Toggle checked={paymentHold} onChange={setPaymentHold} activeColor="#D97706" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px]" style={{ color: complianceHold ? '#EF4444' : 'var(--color-text-primary)' }}>Compliance Hold</p>
                  <p className="text-text-secondary text-[11px]">Warns before payouts when compliance is incomplete — optional to proceed.</p>
                </div>
                <Toggle checked={complianceHold} onChange={setComplianceHold} activeColor="#DC2626" />
              </div>
            </div>
          </div>
        )}

        {/* ── TEAM ── */}
        {tab === 'Team' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full">
            {membersLoading ? (
              <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="section-label flex-1">TEAM MEMBERS</p>
                  <FormSelect value={addMemberId} onChange={e => setAddMemberId(e.target.value)}>
                    <option value="">Select employee…</option>
                    {companyEmployees
                      .filter(e => !members.some(m => m.employee_id === e.id))
                      .map(e => (
                        <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
                      ))}
                  </FormSelect>
                  <input
                    value={addMemberRole}
                    onChange={e => setAddMemberRole(e.target.value)}
                    placeholder="Role (optional)"
                    className="dark-entry h-9 w-[140px] text-[12px]"
                  />
                  <button
                    type="button"
                    disabled={!addMemberId || isBusy}
                    onClick={() => void addTeamMember()}
                    className="btn-outlined h-9 px-3 text-[12px] disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
                <div className="bg-surface rounded-lg border border-divider overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-elevated border-b border-divider">
                        <th className="data-th">Employee</th>
                        <th style={{ width: 120 }} className="data-th text-center">Role</th>
                        <th style={{ width:  80 }} className="data-th text-right">Primary</th>
                        <th style={{ width:  64 }} className="data-th"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.length === 0 ? (
                        <tr><td colSpan={4} className="text-text-secondary text-center py-4 text-[13px]">No members linked.</td></tr>
                      ) : (
                        members.map(m => (
                          <tr key={m.id} className="bg-surface border-b border-divider last:border-0">
                            <td className="data-td text-text-primary">
                              {m.employees ? `${m.employees.name} ${m.employees.surname}` : '—'}
                            </td>
                            <td className="data-td text-text-secondary text-center">{m.role ?? '—'}</td>
                            <td className="data-td text-text-secondary text-right">{m.is_primary ? 'Yes' : '—'}</td>
                            <td className="data-td text-center">
                              <button type="button" onClick={() => void removeTeamMember(m.id)} className="text-error text-[12px]">✕</button>
                            </td>
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
                        return (
                            <tr key={jc.id} className="bg-surface border-b border-divider">
                              <td className="data-td text-text-secondary font-medium text-[12px]">{j?.job_code ?? '—'}</td>
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
                                {j?.id ? (
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/dashboard/jobs/${j.id}/contractor-docs`)}
                                    className="rounded w-[34px] h-7 text-[11px]"
                                    style={{ backgroundColor: '#1A2A1A', color: '#4ADE80' }}
                                    title="Contractor documents"
                                  >
                                    📄
                                  </button>
                                ) : '—'}
                              </td>
                              <td className="data-td">
                                <button onClick={() => j?.id && router.push(`/dashboard/jobs/${j.id}`)}
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
                            <td className="data-td text-text-secondary font-medium text-[12px]">{p?.project_code ?? '—'}</td>
                            <td className="data-td text-text-primary text-[13px] truncate">{p?.title ?? '—'}</td>
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

        {/* ── ACTIVITY ── */}
        {tab === 'Activity' && contractor && (
          <div className="flex-1 overflow-y-auto">
            <ContractorActivityTab companyId={contractor.company_id} contractorId={contractorId} />
          </div>
        )}

        {/* ── QUOTES ── */}
        {tab === 'Quotes' && contractor && (
          <div className="flex-1 overflow-y-auto">
            <ContractorQuotesTab
              companyId={contractor.company_id}
              contractorId={contractorId}
              initialQuoteId={focusType === 'quote_pending' ? focusId : null}
            />
          </div>
        )}

        {/* ── INVOICES / PAYOUTS ── */}
        {tab === 'Invoices' && contractor && (
          <div className="flex-1 overflow-y-auto">
            <ContractorInvoicesTab
              companyId={contractor.company_id}
              contractorId={contractorId}
              canEdit={canEdit}
            />
          </div>
        )}
      </div>
    </div>
  )
}
