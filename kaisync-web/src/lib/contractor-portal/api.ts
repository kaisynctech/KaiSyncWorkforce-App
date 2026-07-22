/**
 * Contractor portal RPCs — resolve, profile, jobs, visits, messages.
 */

import { createClient } from '@/lib/supabase/client'
import type {
  CompliancePackItem,
  ContractorBankingDecision,
  ContractorBankingStatus,
  ContractorDocument,
  ContractorJob,
  ContractorPayout,
  ContractorPortalLogin,
  ContractorPortalProfile,
  ContractorQuote,
  ContractorQuoteAttachment,
  ContractorQuoteItem,
  JobMessage,
  JobSiteSessionRow,
  JobSiteVisit,
  OpenVisit,
  QuoteLineDraft,
  QuoteVatMode,
} from './types'

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function strN(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s.trim() === '' ? null : s
}

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v) || 0
  return 0
}

function bool(v: unknown, defaultTrue = false): boolean {
  if (v === true) return true
  if (v === false) return false
  return defaultTrue
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') return [data as Record<string, unknown>]
  return []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args)
  if (error) throw error
  return data
}

function codes(companyCode: string, contractorCode: string) {
  return {
    p_company_code: companyCode.trim().toUpperCase(),
    p_contractor_code: contractorCode.trim().toUpperCase(),
  }
}

function ids(contractorId: string, companyId: string) {
  return {
    p_contractor_id: contractorId,
    p_company_id: companyId,
  }
}

export async function resolveContractorByCode(
  companyCode: string,
  contractorCode: string,
): Promise<ContractorPortalLogin | null> {
  try {
    const data = await rpc('contractor_resolve_by_code', codes(companyCode, contractorCode))
    const row = asRows(data)[0]
    if (!row?.contractor_id || !row?.company_id) return null
    return {
      contractor_id: str(row.contractor_id),
      company_id: str(row.company_id),
      contractor_name: str(row.contractor_name),
      contractor_code: str(row.contractor_code) || contractorCode.trim().toUpperCase(),
      company_code: str(row.company_code) || companyCode.trim().toUpperCase(),
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('PORTAL_CODE_EXPIRED')) {
      throw new Error('Your portal code has expired. Contact your administrator.')
    }
    throw e
  }
}

export function parseProfile(row: Record<string, unknown>): ContractorPortalProfile {
  return {
    name: str(row.name),
    registration_number: strN(row.registration_number),
    tax_number: strN(row.tax_number),
    is_vat_registered: bool(row.is_vat_registered),
    vat_number: strN(row.vat_number),
    contact_person: strN(row.contact_person),
    phone: strN(row.phone),
    email: strN(row.email),
    address: strN(row.address),
    company_name: str(row.company_name),
    company_code: str(row.company_code),
    contractor_code: str(row.contractor_code),
    partner_kind: str(row.partner_kind),
    banking_verified: bool(row.banking_verified),
    payment_hold: bool(row.payment_hold),
    compliance_hold: bool(row.compliance_hold),
    is_active: bool(row.is_active, true),
    payment_terms: strN(row.payment_terms),
    preferred_payment_method: strN(row.preferred_payment_method),
    compliance_pack_name: strN(row.compliance_pack_name),
  }
}

export async function getProfile(
  contractorId: string,
  companyId: string,
): Promise<ContractorPortalProfile | null> {
  const data = await rpc('contractor_portal_get_profile', ids(contractorId, companyId))
  if (data == null || data === 'null') return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  return parseProfile(row as Record<string, unknown>)
}

export async function updateProfile(
  contractorId: string,
  companyId: string,
  profile: Pick<
    ContractorPortalProfile,
    | 'name'
    | 'registration_number'
    | 'tax_number'
    | 'is_vat_registered'
    | 'vat_number'
    | 'contact_person'
    | 'phone'
    | 'email'
    | 'address'
  >,
): Promise<void> {
  await rpc('contractor_portal_update_profile', {
    ...ids(contractorId, companyId),
    p_name: profile.name.trim(),
    p_registration_number: profile.registration_number?.trim() ?? '',
    p_tax_number: profile.tax_number?.trim() ?? '',
    p_is_vat_registered: profile.is_vat_registered,
    p_vat_number: profile.is_vat_registered ? (profile.vat_number?.trim() ?? '') : '',
    p_contact_person: profile.contact_person?.trim() ?? '',
    p_phone: profile.phone?.trim() ?? '',
    p_email: profile.email?.trim() ?? '',
    p_address: profile.address?.trim() ?? '',
  })
}

export async function listJobs(companyCode: string, contractorCode: string): Promise<ContractorJob[]> {
  const data = await rpc('contractor_portal_list_jobs', codes(companyCode, contractorCode))
  return asRows(data)
    .map(row => ({
      id: str(row.id),
      title: str(row.title),
      status: str(row.status) || 'scheduled',
      job_code: strN(row.job_code),
      contractor_cost: num(row.contractor_cost),
      deal_id: strN(row.deal_id),
      client_id: strN(row.client_id),
      photo_urls_before: stringArr(row.photo_urls_before),
      photo_urls_after: stringArr(row.photo_urls_after),
    }))
    .filter(j => j.id)
}

function stringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(x => str(x)).filter(Boolean)
}

export async function getVisitHistory(
  companyCode: string,
  contractorCode: string,
  jobId?: string | null,
): Promise<JobSiteVisit[]> {
  const args: Record<string, unknown> = { ...codes(companyCode, contractorCode) }
  if (jobId) args.p_job_id = jobId
  const data = await rpc('contractor_portal_visit_history', args)
  return asRows(data).map(row => ({
    id: str(row.id),
    job_id: str(row.job_id),
    sign_in_at: str(row.sign_in_at),
    sign_out_at: strN(row.sign_out_at),
    sign_in_address: strN(row.sign_in_address),
    sign_out_address: strN(row.sign_out_address),
    reported_by_name: strN(row.reported_by_name),
  })).filter(v => v.sign_in_at)
}

/** Pair visits into display sessions (MAUI JobSiteSession.Build). */
export function buildVisitSessions(visits: JobSiteVisit[]): JobSiteSessionRow[] {
  return [...visits]
    .sort((a, b) => b.sign_in_at.localeCompare(a.sign_in_at))
    .map(v => {
      const start = new Date(v.sign_in_at).getTime()
      const end = v.sign_out_at ? new Date(v.sign_out_at).getTime() : Date.now()
      const hours = Math.max(0, (end - start) / 3600000)
      return {
        sign_in_at: v.sign_in_at,
        sign_out_at: v.sign_out_at,
        total_hours: Math.round(hours * 10) / 10,
        hours_display: `${hours.toFixed(1)}h`,
        is_open: !v.sign_out_at,
      }
    })
}

export async function getJobMessages(
  companyCode: string,
  contractorCode: string,
  jobId: string,
): Promise<JobMessage[]> {
  const data = await rpc('contractor_portal_get_job_messages', {
    ...codes(companyCode, contractorCode),
    p_job_id: jobId,
  })
  return asRows(data).map(row => {
    const contractorSender = strN(row.sender_contractor_id)
    return {
      id: str(row.id),
      body: str(row.body),
      created_at: str(row.created_at) || new Date().toISOString(),
      sender_display_name: strN(row.sender_display_name),
      sender_contractor_id: contractorSender,
      is_contractor: Boolean(contractorSender),
    }
  })
}

export async function sendJobMessage(
  companyCode: string,
  contractorCode: string,
  jobId: string,
  body: string,
  senderName?: string | null,
): Promise<void> {
  await rpc('contractor_portal_send_job_message', {
    ...codes(companyCode, contractorCode),
    p_job_id: jobId,
    p_body: body.trim(),
    p_sender_name: senderName ?? '',
  })
}

export function jobStatusLabel(raw: string): string {
  const key = (raw ?? '').toLowerCase()
  const map: Record<string, string> = {
    scheduled: 'Scheduled',
    open: 'Open',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    canceled: 'Cancelled',
  }
  return map[key] ?? (raw ? raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—')
}

export async function listPayouts(companyCode: string, contractorCode: string): Promise<ContractorPayout[]> {
  const data = await rpc('contractor_portal_list_payouts', codes(companyCode, contractorCode))
  let raw: unknown = data
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { raw = [] }
  }
  const rows = asRows(raw)
  return rows.map(row => ({
    id: str(row.id),
    company_id: str(row.company_id),
    contractor_id: strN(row.contractor_id),
    job_id: strN(row.job_id),
    job_contractor_id: strN(row.job_contractor_id),
    subtotal: num(row.subtotal),
    vat_amount: num(row.vat_amount),
    total_amount: num(row.total_amount),
    retention_amount: num(row.retention_amount),
    payout_status: str(row.payout_status) || 'pending',
    approval_status: str(row.approval_status) || 'pending',
    rejection_reason: strN(row.rejection_reason),
    notes: strN(row.notes),
    payout_date: strN(row.payout_date),
    approved_at: strN(row.approved_at),
    paid_at: strN(row.paid_at),
    created_at: strN(row.created_at),
    job_title: strN(row.job_title),
    job_code: strN(row.job_code),
  })).filter(p => p.id)
}

export async function submitInvoice(params: {
  companyCode: string
  contractorCode: string
  jobId: string
  amount: number
  invoiceReference?: string | null
  notes?: string | null
}): Promise<string> {
  if (!(params.amount > 0)) throw new Error('Enter the invoice amount before submitting.')
  const data = await rpc('contractor_portal_submit_invoice', {
    ...codes(params.companyCode, params.contractorCode),
    p_job_id: params.jobId,
    p_amount: params.amount,
    p_invoice_reference: params.invoiceReference?.trim() || null,
    p_notes: params.notes?.trim() || null,
  })
  const id = typeof data === 'string' ? data.replace(/"/g, '') : str(data)
  if (!id) throw new Error('Invoice submission failed.')
  return id
}

export async function resubmitPayout(params: {
  companyCode: string
  contractorCode: string
  payoutId: string
  amount: number
  invoiceReference?: string | null
  notes?: string | null
}): Promise<void> {
  if (!(params.amount > 0)) throw new Error('Enter a valid amount.')
  try {
    await rpc('contractor_portal_resubmit_payout', {
      ...codes(params.companyCode, params.contractorCode),
      p_payout_id: params.payoutId,
      p_amount: params.amount,
      p_invoice_reference: params.invoiceReference?.trim() || null,
      p_notes: params.notes?.trim() || null,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('PAYOUT_NOT_FOUND_OR_NOT_REJECTED')) {
      throw new Error('Only rejected invoices can be revised.')
    }
    if (msg.includes('CONTRACTOR_NOT_FOUND')) {
      throw new Error('Contractor portal session is invalid. Sign in again.')
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}

export async function getOpenVisit(companyCode: string, contractorCode: string): Promise<OpenVisit | null> {
  const data = await rpc('contractor_portal_open_visit', codes(companyCode, contractorCode))
  if (data == null || data === 'null') return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const jobId = strN(r.job_id)
  const signIn = strN(r.sign_in_at)
  if (!jobId && !signIn) return null
  return {
    job_id: jobId,
    sign_in_at: signIn,
    job_title: strN(r.job_title) ?? strN(r.title),
  }
}

function mapVisitRpcError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('ALREADY_ON_SITE')) {
    return new Error('You are already signed in on another job. Sign out there first.')
  }
  if (msg.includes('NO_OPEN_VISIT')) {
    return new Error('No open site visit on this job.')
  }
  if (msg.includes('JOB_NOT_ASSIGNED')) {
    return new Error('This job is not assigned to you.')
  }
  if (msg.includes('CONTRACTOR_NOT_FOUND')) {
    return new Error('Contractor portal session is invalid. Sign in again.')
  }
  return e instanceof Error ? e : new Error(msg)
}

export async function siteSignIn(
  companyCode: string,
  contractorCode: string,
  jobId: string,
  opts?: {
    latitude?: number | null
    longitude?: number | null
    address?: string | null
    reportedByName?: string | null
    notes?: string | null
  },
): Promise<void> {
  const args: Record<string, unknown> = {
    ...codes(companyCode, contractorCode),
    p_job_id: jobId,
  }
  if (opts?.latitude != null) args.p_latitude = opts.latitude
  if (opts?.longitude != null) args.p_longitude = opts.longitude
  if (opts?.address != null) args.p_address = opts.address
  if (opts?.reportedByName != null) args.p_reported_by_name = opts.reportedByName
  if (opts?.notes != null) args.p_notes = opts.notes
  try {
    await rpc('contractor_portal_site_sign_in', args)
  } catch (e) {
    throw mapVisitRpcError(e)
  }
}

export async function siteSignOut(
  companyCode: string,
  contractorCode: string,
  jobId: string,
  opts?: {
    latitude?: number | null
    longitude?: number | null
    address?: string | null
    notes?: string | null
  },
): Promise<void> {
  const args: Record<string, unknown> = {
    ...codes(companyCode, contractorCode),
    p_job_id: jobId,
  }
  if (opts?.latitude != null) args.p_latitude = opts.latitude
  if (opts?.longitude != null) args.p_longitude = opts.longitude
  if (opts?.address != null) args.p_address = opts.address
  if (opts?.notes != null) args.p_notes = opts.notes
  try {
    await rpc('contractor_portal_site_sign_out', args)
  } catch (e) {
    throw mapVisitRpcError(e)
  }
}

function parseBankingStatus(row: Record<string, unknown>): ContractorBankingStatus {
  return {
    account_holder_name: strN(row.account_holder_name),
    bank_name: strN(row.bank_name),
    masked_account: strN(row.masked_account),
    bank_branch_code: strN(row.bank_branch_code),
    account_type: strN(row.account_type),
    swift_bic: strN(row.swift_bic),
    has_banking_details: bool(row.has_banking_details),
    banking_verified: bool(row.banking_verified),
    payment_hold: bool(row.payment_hold),
    compliance_hold: bool(row.compliance_hold),
    payment_terms: strN(row.payment_terms),
    preferred_payment_method: strN(row.preferred_payment_method),
  }
}

function parseBankingDecision(row: Record<string, unknown>): ContractorBankingDecision {
  return {
    id: str(row.id),
    account_holder_name: strN(row.account_holder_name),
    bank_name: strN(row.bank_name),
    masked_account: strN(row.masked_account),
    bank_branch_code: strN(row.bank_branch_code),
    account_type: strN(row.account_type),
    swift_bic: strN(row.swift_bic),
    status: str(row.status) || 'pending',
    submitted_at: strN(row.submitted_at),
    reviewed_at: strN(row.reviewed_at),
    rejection_reason: strN(row.rejection_reason),
  }
}

export async function getBanking(
  contractorId: string,
  companyId: string,
): Promise<ContractorBankingStatus | null> {
  const data = await rpc('contractor_portal_get_banking', ids(contractorId, companyId))
  if (data == null || data === 'null') return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  return parseBankingStatus(row as Record<string, unknown>)
}

export async function getLatestBankingDecision(
  contractorId: string,
  companyId: string,
): Promise<ContractorBankingDecision | null> {
  const data = await rpc('contractor_portal_get_latest_banking_decision', ids(contractorId, companyId))
  if (data == null || data === 'null') return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  return parseBankingDecision(row as Record<string, unknown>)
}

export async function submitBanking(
  contractorId: string,
  companyId: string,
  input: {
    accountHolder: string
    bankName: string
    bankAccount: string
    branchCode: string
    accountType: string
    swiftBic: string
  },
): Promise<void> {
  await rpc('contractor_portal_submit_banking', {
    ...ids(contractorId, companyId),
    p_account_holder: input.accountHolder.trim(),
    p_bank_name: input.bankName.trim(),
    p_bank_account: input.bankAccount.trim(),
    p_branch_code: input.branchCode.trim(),
    p_account_type: input.accountType.trim() || 'cheque',
    p_swift_bic: input.swiftBic.trim(),
  })
}

export async function prepareJobPhotoUpload(
  companyCode: string,
  contractorCode: string,
  jobId: string,
  storagePath: string,
): Promise<void> {
  await rpc('contractor_portal_prepare_job_photo_upload', {
    ...codes(companyCode, contractorCode),
    p_job_id: jobId,
    p_storage_path: storagePath,
  })
}

export async function appendJobPhoto(
  companyCode: string,
  contractorCode: string,
  jobId: string,
  phase: 'before' | 'after',
  photoUrl: string,
): Promise<void> {
  await rpc('contractor_portal_append_job_photo', {
    ...codes(companyCode, contractorCode),
    p_job_id: jobId,
    p_phase: phase,
    p_photo_url: photoUrl,
  })
}

/** Upload job photo then append URL (MAUI AddPhotoAsync). */
export async function uploadJobPhoto(params: {
  companyCode: string
  contractorCode: string
  companyId: string
  jobId: string
  phase: 'before' | 'after'
  file: File
}): Promise<string> {
  const supabase = createClient()
  const ext = params.file.name.includes('.')
    ? `.${params.file.name.split('.').pop()!.toLowerCase()}`
    : '.jpg'
  const phase = params.phase
  const storagePath = `job_photos/${params.companyId}/${params.jobId}/${phase}/${crypto.randomUUID()}${ext}`

  await prepareJobPhotoUpload(
    params.companyCode,
    params.contractorCode,
    params.jobId,
    storagePath,
  )

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(storagePath, params.file, {
      upsert: false,
      contentType: params.file.type || 'image/jpeg',
    })
  if (upErr) throw new Error(`Could not upload photo: ${upErr.message}`)

  const { data: signed, error: signErr } = await supabase.storage
    .from('workforce-media')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
  if (signErr || !signed?.signedUrl) {
    const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(storagePath)
    await appendJobPhoto(
      params.companyCode,
      params.contractorCode,
      params.jobId,
      phase,
      pub.publicUrl,
    )
    return pub.publicUrl
  }

  await appendJobPhoto(
    params.companyCode,
    params.contractorCode,
    params.jobId,
    phase,
    signed.signedUrl,
  )
  return signed.signedUrl
}

export async function createIncident(params: {
  companyCode: string
  contractorCode: string
  jobId: string
  description: string
  severity?: string
  reportedByName?: string | null
}): Promise<void> {
  const data = await rpc('contractor_portal_create_incident', {
    ...codes(params.companyCode, params.contractorCode),
    p_job_id: params.jobId,
    p_description: params.description.trim(),
    p_severity: (params.severity || 'medium').trim() || 'medium',
    p_reported_by_name: params.reportedByName?.trim() ?? '',
  })
  if (data == null || data === 'null') {
    throw new Error('Could not report incident.')
  }
}

function parseDocument(row: Record<string, unknown>): ContractorDocument {
  return {
    id: str(row.id),
    company_id: str(row.company_id),
    contractor_id: str(row.contractor_id),
    document_type: str(row.document_type),
    document_name: str(row.document_name),
    file_url: str(row.file_url),
    storage_path: strN(row.storage_path),
    approval_status: str(row.approval_status) || 'pending',
    rejected_reason: strN(row.rejected_reason),
    is_required: bool(row.is_required),
    is_current: bool(row.is_current, true),
    uploaded_by_role: str(row.uploaded_by_role) || 'hr',
    expiry_date: strN(row.expiry_date),
    created_at: str(row.created_at) || new Date().toISOString(),
    updated_at: str(row.updated_at) || new Date().toISOString(),
  }
}

export async function getDocuments(
  contractorId: string,
  companyId: string,
): Promise<ContractorDocument[]> {
  const data = await rpc('contractor_portal_get_documents', ids(contractorId, companyId))
  return asRows(data).map(parseDocument).filter(d => d.id)
}

export async function getCompliancePack(
  contractorId: string,
  companyId: string,
): Promise<CompliancePackItem[]> {
  const data = await rpc('contractor_portal_get_compliance_pack', ids(contractorId, companyId))
  return asRows(data)
    .map(row => ({
      document_type: str(row.document_type),
      requirement: str(row.requirement) || 'required',
      sort_order: num(row.sort_order),
    }))
    .filter(i => i.document_type)
}

export async function insertDocument(params: {
  contractorId: string
  companyId: string
  documentType: string
  documentName: string
  fileUrl: string
  storagePath: string
  expiryDate?: string | null
  oldDocumentId?: string | null
}): Promise<string> {
  const args: Record<string, unknown> = {
    ...ids(params.contractorId, params.companyId),
    p_document_type: params.documentType,
    p_document_name: params.documentName.trim(),
    p_file_url: params.fileUrl,
    p_storage_path: params.storagePath,
  }
  if (params.expiryDate) args.p_expiry_date = params.expiryDate
  if (params.oldDocumentId) args.p_old_document_id = params.oldDocumentId
  const data = await rpc('contractor_portal_insert_document', args)
  return typeof data === 'string' ? data.replace(/"/g, '') : str(data)
}

/** Upload to workforce-media then insert via portal RPC (MAUI ContractorPortalUploadDocumentAsync). */
export async function uploadComplianceDocument(params: {
  contractorId: string
  companyId: string
  file: File
  documentType: string
  documentName: string
  expiryDate?: string | null
  oldDocumentId?: string | null
}): Promise<string> {
  const supabase = createClient()
  const ext = params.file.name.includes('.')
    ? `.${params.file.name.split('.').pop()!.toLowerCase()}`
    : ''
  const storagePath = `contractor_documents/${params.companyId}/${params.contractorId}/${crypto.randomUUID()}${ext}`

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(storagePath, params.file, {
      upsert: false,
      contentType: params.file.type || undefined,
    })
  if (upErr) throw new Error(`Could not upload document: ${upErr.message}`)

  const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(storagePath)
  return insertDocument({
    contractorId: params.contractorId,
    companyId: params.companyId,
    documentType: params.documentType,
    documentName: params.documentName,
    fileUrl: pub.publicUrl,
    storagePath,
    expiryDate: params.expiryDate,
    oldDocumentId: params.oldDocumentId,
  })
}

function parseQuoteItem(row: Record<string, unknown>): ContractorQuoteItem {
  return {
    id: str(row.id),
    description: str(row.description),
    quantity: num(row.quantity) || 1,
    unit_price: num(row.unit_price),
    discount_amount: num(row.discount_amount),
    subtotal: num(row.subtotal),
    line_total: num(row.line_total),
    line_no: num(row.line_no),
  }
}

function parseQuoteAttachment(row: Record<string, unknown>): ContractorQuoteAttachment {
  return {
    id: str(row.id),
    file_name: str(row.file_name),
    file_url: str(row.file_url),
    storage_path: strN(row.storage_path),
    is_primary: bool(row.is_primary),
  }
}

function parseQuote(row: Record<string, unknown>): ContractorQuote {
  const itemsRaw = row.items
  const attsRaw = row.attachments
  return {
    id: str(row.id),
    quote_number: strN(row.quote_number),
    title: str(row.title),
    description: strN(row.description),
    source_mode: str(row.source_mode) || 'manual',
    vat_mode: (str(row.vat_mode) || 'none') as QuoteVatMode,
    vat_rate: num(row.vat_rate) || 0.15,
    subtotal: num(row.subtotal),
    discount_amount: num(row.discount_amount),
    freight_amount: num(row.freight_amount),
    duty_amount: num(row.duty_amount),
    levies_amount: num(row.levies_amount),
    other_charges_amount: num(row.other_charges_amount),
    taxable_amount: num(row.taxable_amount),
    vat_amount: num(row.vat_amount),
    total_amount: num(row.total_amount),
    quote_date: strN(row.quote_date),
    valid_until: strN(row.valid_until),
    status: str(row.status) || 'draft',
    terms: strN(row.terms),
    contractor_notes: strN(row.contractor_notes),
    revision_comments: strN(row.revision_comments),
    rejection_reason: strN(row.rejection_reason),
    submitted_at: strN(row.submitted_at),
    reviewed_at: strN(row.reviewed_at),
    converted_at: strN(row.converted_at),
    converted_to_job_id: strN(row.converted_to_job_id),
    created_at: strN(row.created_at),
    items: Array.isArray(itemsRaw)
      ? (itemsRaw as Record<string, unknown>[]).map(parseQuoteItem)
      : [],
    attachments: Array.isArray(attsRaw)
      ? (attsRaw as Record<string, unknown>[]).map(parseQuoteAttachment)
      : [],
  }
}

export async function listQuotes(contractorId: string, companyId: string): Promise<ContractorQuote[]> {
  const data = await rpc('contractor_portal_list_quotes', ids(contractorId, companyId))
  let raw: unknown = data
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { raw = [] }
  }
  return asRows(raw).map(parseQuote).filter(q => q.id)
}

export async function getQuote(
  contractorId: string,
  companyId: string,
  quoteId: string,
): Promise<ContractorQuote | null> {
  const data = await rpc('contractor_portal_get_quote', {
    ...ids(contractorId, companyId),
    p_quote_id: quoteId,
  })
  if (data == null || data === 'null') return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  return parseQuote(row as Record<string, unknown>)
}

export async function saveQuoteDraft(params: {
  contractorId: string
  companyId: string
  quoteId?: string | null
  title: string
  description?: string
  quoteNumber?: string
  validUntil?: string | null
  vatMode: QuoteVatMode
  vatRate: number
  discount: number
  freight: number
  duty: number
  levies: number
  otherCharges: number
  terms?: string
  contractorNotes?: string
  items: QuoteLineDraft[]
}): Promise<string> {
  const args: Record<string, unknown> = {
    ...ids(params.contractorId, params.companyId),
    p_title: params.title.trim(),
    p_description: params.description?.trim() ?? '',
    p_quote_number: params.quoteNumber?.trim() ?? '',
    p_valid_until: params.validUntil || null,
    p_vat_mode: params.vatMode,
    p_vat_rate: params.vatRate,
    p_discount: params.discount || 0,
    p_freight: params.freight || 0,
    p_duty: params.duty || 0,
    p_levies: params.levies || 0,
    p_other_charges: params.otherCharges || 0,
    p_terms: params.terms?.trim() ?? '',
    p_contractor_notes: params.contractorNotes?.trim() ?? '',
    // Must be a real array — not a JSON string (MAUI bugfix)
    p_items: params.items.map(i => ({
      description: i.description.trim(),
      quantity: Number(i.quantity) || 0,
      unit_price: Number(i.unit_price) || 0,
      discount_amount: Number(i.discount_amount) || 0,
    })),
  }
  if (params.quoteId) args.p_quote_id = params.quoteId
  const data = await rpc('contractor_portal_save_quote_draft', args)
  const id = typeof data === 'string' ? data.replace(/"/g, '') : str(data)
  if (!id) throw new Error('Could not save quote draft.')
  return id
}

export async function submitQuote(
  contractorId: string,
  companyId: string,
  quoteId: string,
): Promise<void> {
  await rpc('contractor_portal_submit_quote', {
    ...ids(contractorId, companyId),
    p_quote_id: quoteId,
  })
}

export async function resubmitQuote(
  contractorId: string,
  companyId: string,
  quoteId: string,
): Promise<void> {
  await rpc('contractor_portal_resubmit_quote', {
    ...ids(contractorId, companyId),
    p_quote_id: quoteId,
  })
}

export async function deleteQuoteDraft(
  contractorId: string,
  companyId: string,
  quoteId: string,
): Promise<void> {
  await rpc('contractor_portal_delete_draft', {
    ...ids(contractorId, companyId),
    p_quote_id: quoteId,
  })
}

export async function uploadQuote(params: {
  contractorId: string
  companyId: string
  file: File
  title: string
  description?: string
  quoteNumber?: string
  amount: number
  vatMode: QuoteVatMode
  vatRate: number
  discount: number
  freight: number
  duty: number
  levies: number
  otherCharges: number
  validUntil?: string | null
  contractorNotes?: string
}): Promise<string> {
  if (!(params.amount > 0)) throw new Error('Enter a base amount for the uploaded quote.')
  if (!params.title.trim()) throw new Error('Title is required.')

  const supabase = createClient()
  const ext = params.file.name.includes('.')
    ? `.${params.file.name.split('.').pop()!.toLowerCase()}`
    : ''
  const storagePath = `contractor_quotes/${params.companyId}/${params.contractorId}/${crypto.randomUUID()}${ext}`

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(storagePath, params.file, {
      upsert: false,
      contentType: params.file.type || undefined,
    })
  if (upErr) throw new Error(`Could not upload quote file: ${upErr.message}`)

  let fileUrl: string
  const { data: signed } = await supabase.storage
    .from('workforce-media')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
  if (signed?.signedUrl) {
    fileUrl = signed.signedUrl
  } else {
    fileUrl = supabase.storage.from('workforce-media').getPublicUrl(storagePath).data.publicUrl
  }

  const data = await rpc('contractor_portal_upload_quote', {
    ...ids(params.contractorId, params.companyId),
    p_title: params.title.trim(),
    p_description: params.description?.trim() ?? '',
    p_quote_number: params.quoteNumber?.trim() ?? '',
    p_amount: params.amount,
    p_vat_mode: params.vatMode,
    p_vat_rate: params.vatRate,
    p_discount: params.discount || 0,
    p_freight: params.freight || 0,
    p_duty: params.duty || 0,
    p_levies: params.levies || 0,
    p_other_charges: params.otherCharges || 0,
    p_valid_until: params.validUntil || null,
    p_contractor_notes: params.contractorNotes?.trim() ?? '',
    p_file_url: fileUrl,
    p_file_name: params.file.name,
    p_storage_path: storagePath,
  })
  const id = typeof data === 'string' ? data.replace(/"/g, '') : str(data)
  if (!id) throw new Error('Could not submit uploaded quote.')
  return id
}
