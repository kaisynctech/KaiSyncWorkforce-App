/**
 * Client portal RPC wrappers — anon code-auth, mirrors SupabaseStorageService portal methods.
 */

import { createClient } from '@/lib/supabase/client'
import { grantMediaRead } from '@/lib/media-read'
import { parseLinkedCompanyCode } from '@/lib/client-portal/portal-mode'
import { parseStatementEntries, type ClientStatementEntry } from '@/lib/client-portal/statement'
import type { InvoicePdfInput } from '@/lib/invoice-pdf'
import { letterheadFromRow, loadLetterheadLogo, type Letterhead } from '@/lib/letterhead'
import type { CompliancePackItem, ContractorDocument } from '@/lib/contractor-portal/types'
import type {
  ClientBankingView,
  ActivityUpdate,
  ClientDocumentRequest,
  ClientJobChecklistItem,
  ClientJobDocument,
  ClientJobTeamMember,
  ClientJobVisit,
  ClientPayment,
  ClientPortalJob,
  ClientPortalJobDetail,
  ClientPortalLogin,
  ClientPortalProject,
  DealMessage,
  MessageInboxItem,
  PortalInvoice,
  ProgressPhoto,
  ProjectDocument,
  QuotationLine,
  ClientPortalProfile,
  ClientEditableField,
} from './types'

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v) || 0
  return 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function strN(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s.trim() === '' ? null : s
}

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') return [data as Record<string, unknown>]
  return []
}

function parseQuotationLines(raw: unknown): QuotationLine[] {
  if (!Array.isArray(raw)) return []
  let lineNo = 1
  return raw.map((line) => {
    const r = line as Record<string, unknown>
    const n = typeof r.line_no === 'number' ? r.line_no : lineNo++
    return {
      line_no: n,
      description: str(r.description),
      quantity: num(r.quantity) || 1,
      unit_price: num(r.unit_price),
    }
  })
}

function parseDocuments(raw: unknown): ProjectDocument[] {
  if (!Array.isArray(raw)) return []
  return raw.map((doc) => {
    const r = doc as Record<string, unknown>
    return {
      id: str(r.id),
      document_name: str(r.document_name),
      document_type: str(r.document_type) || 'other',
      file_url: str(r.file_url),
      created_at: str(r.created_at) || new Date().toISOString(),
    }
  })
}

function parseActivity(raw: unknown): ActivityUpdate[] {
  if (!Array.isArray(raw)) return []
  return raw.map((act) => {
    const r = act as Record<string, unknown>
    return {
      body: str(r.body),
      status_from: strN(r.status_from),
      status_to: strN(r.status_to),
      created_at: str(r.created_at) || new Date().toISOString(),
    }
  })
}

function parsePhotos(raw: unknown): ProgressPhoto[] {
  if (!Array.isArray(raw)) return []
  return raw.map((photo) => {
    const r = photo as Record<string, unknown>
    return {
      job_title: str(r.job_title),
      phase: str(r.phase) || 'before',
      url: str(r.url),
    }
  })
}

function parseMessages(raw: unknown): DealMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.map((msg) => {
    const r = msg as Record<string, unknown>
    const senderClient = strN(r.sender_client_id)
    return {
      id: str(r.id),
      author: senderClient ? 'client' : 'hr',
      body: str(r.body),
      created_at: str(r.created_at) || new Date().toISOString(),
      sender_client_id: senderClient,
    }
  })
}

function parsePayments(raw: unknown): ClientPayment[] {
  if (!Array.isArray(raw)) return []
  return raw.map((pay) => {
    const r = pay as Record<string, unknown>
    return {
      id: str(r.id),
      amount: num(r.amount),
      paid_at: str(r.paid_at) || new Date().toISOString(),
      payment_method: strN(r.payment_method),
      reference: strN(r.reference),
      notes: strN(r.notes),
      receipt_url: strN(r.receipt_url),
    }
  })
}

export function parseClientPortalProject(row: Record<string, unknown>): ClientPortalProject {
  return {
    id: str(row.id),
    company_id: str(row.company_id),
    client_id: str(row.client_id),
    project_code: strN(row.project_code),
    title: str(row.title),
    status: str(row.status),
    offer_amount: num(row.offer_amount),
    deposit_required: num(row.deposit_required),
    amount_paid: num(row.amount_paid),
    progress_percent: Math.round(num(row.progress_percent)),
    agreement_notes: strN(row.agreement_notes),
    last_update_note: strN(row.last_update_note),
    last_update_at: strN(row.last_update_at),
    expected_close_date: strN(row.expected_close_date),
    site_start_date: strN(row.site_start_date),
    expected_completion_date: strN(row.expected_completion_date),
    next_visit_date: strN(row.next_visit_date),
    job_id: strN(row.job_id),
    quotation_notes: strN(row.quotation_notes),
    quotation_valid_until: strN(row.quotation_valid_until),
    quotation_sent_at: strN(row.quotation_sent_at),
    quotation_response: 'pending',
    quotation_response_note: null,
    quotation_response_at: null,
    quotation_response_storage_path: null,
    created_at: str(row.created_at) || new Date().toISOString(),
    updated_at: str(row.updated_at) || new Date().toISOString(),
    job_count: Math.round(num(row.job_count)),
    quotation_lines: parseQuotationLines(row.quotation_lines),
    documents: parseDocuments(row.documents),
    activity_updates: parseActivity(row.activity_updates),
    progress_photos: parsePhotos(row.progress_photos),
    messages: parseMessages(row.messages),
    payments: parsePayments(row.payments),
  }
}

/**
 * Database functions a linked customer company can use through its link (same rules as the
 * portal; see supabase/migrations/20261031090000_linked_view.sql).
 */
const LINKED_FUNCTIONS = new Set([
  'list_jobs', 'get_job', 'list_job_reports', 'list_projects', 'get_project', 'get_quotation_response',
  'list_message_inbox', 'list_invoices', 'get_invoice', 'get_statement', 'get_letterhead', 'get_profile',
  'get_compliance', 'get_compliance_documents', 'get_compliance_pack', 'list_document_requests', 'grant_media_read',
])

/** A portal call made from a linked company's dashboard goes to the matching linked_* function. */
export function linkedCall(fn: string, args: Record<string, unknown>): { fn: string; args: Record<string, unknown> } | null {
  const link = parseLinkedCompanyCode(typeof args.p_company_code === 'string' ? args.p_company_code : null)
  if (!link) return null
  const name = fn.replace(/^client_portal_/, '')
  if (name === fn || !LINKED_FUNCTIONS.has(name)) throw new Error('This is not available for linked companies yet.')
  const rest = { ...args }
  delete rest.p_company_code
  delete rest.p_client_code
  return { fn: `linked_${name}`, args: { p_company_id: link.companyId, p_link_id: link.linkId, ...rest } }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const supabase = createClient()
  const linked = linkedCall(fn, args)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(linked?.fn ?? fn, linked?.args ?? args)
  if (error) {
    const raw = error as { message?: unknown }
    const message = typeof raw.message === 'string' && raw.message.trim()
      ? raw.message
      : 'Request failed.'
    if (message.includes('PORTAL_DISABLED')) {
      throw new Error('Portal access is turned off for this client. Turn on Portal user on the client record, then sign in again.')
    }
    throw new Error(message)
  }
  return data
}

function codes(companyCode: string, clientCode: string) {
  return {
    p_company_code: companyCode.trim().toUpperCase(),
    p_client_code: clientCode.trim().toUpperCase(),
  }
}

export async function resolveClientByCode(
  companyCode: string,
  clientCode: string,
): Promise<ClientPortalLogin | null> {
  try {
    const data = await rpc('client_resolve_by_code', codes(companyCode, clientCode))
    const row = asArray(data)[0]
    if (!row?.client_id || !row?.company_id) return null
    return {
      client_id: str(row.client_id),
      company_id: str(row.company_id),
      company_code: str(row.company_code) || companyCode.trim().toUpperCase(),
      client_code: str(row.client_code) || clientCode.trim().toUpperCase(),
      client_name: str(row.client_name),
      email: strN(row.email),
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('ACCOUNT_LOCKED')) {
      throw new Error('Too many failed sign-in attempts. Please try again later.')
    }
    if (msg.includes('PORTAL_DISABLED')) {
      throw new Error('Portal access is turned off for this client. Turn on Portal user on the client record, then sign in again.')
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}

export async function listJobs(companyCode: string, clientCode: string): Promise<ClientPortalJob[]> {
  const data = await rpc('client_portal_list_jobs', codes(companyCode, clientCode))
  return asArray(data)
    .map((row) => ({
      id: str(row.id),
      job_code: strN(row.job_code),
      title: str(row.title),
      status: str(row.status),
      scheduled_start: strN(row.scheduled_start),
      scheduled_end: strN(row.scheduled_end),
      created_at: str(row.created_at) || new Date().toISOString(),
      deal_id: strN(row.deal_id),
      project_code: strN(row.project_code),
      project_title: strN(row.project_title),
    }))
    .filter(job => job.id)
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => str(item).trim()).filter(Boolean)
}

function parseTeam(raw: unknown): ClientJobTeamMember[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => {
    const r = item as Record<string, unknown>
    return {
      id: str(r.id),
      name: str(r.name).trim() || 'Team member',
      on_site: r.on_site === true,
      since: strN(r.since),
    }
  }).filter(row => row.id)
}

function parseChecklist(raw: unknown): ClientJobChecklistItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => {
    const r = item as Record<string, unknown>
    return {
      description: str(r.description),
      is_checked: r.is_checked === true,
      sort_order: Math.round(num(r.sort_order)),
    }
  }).filter(row => row.description)
}

function parseVisits(raw: unknown): ClientJobVisit[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => {
    const r = item as Record<string, unknown>
    return {
      sign_in_at: str(r.sign_in_at),
      sign_out_at: strN(r.sign_out_at),
      sign_in_address: strN(r.sign_in_address),
      sign_out_address: strN(r.sign_out_address),
      notes: strN(r.notes),
    }
  }).filter(row => row.sign_in_at)
}

function parseJobDocuments(raw: unknown): ClientJobDocument[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => {
    const r = item as Record<string, unknown>
    return {
      id: str(r.id),
      document_name: str(r.document_name),
      document_type: str(r.document_type) || 'other',
      file_url: str(r.file_url),
      created_at: str(r.created_at) || new Date().toISOString(),
    }
  }).filter(row => row.id && row.file_url)
}

export async function getJob(
  companyCode: string,
  clientCode: string,
  jobId: string,
): Promise<ClientPortalJobDetail | null> {
  const data = await rpc('client_portal_get_job', {
    ...codes(companyCode, clientCode),
    p_job_id: jobId,
  })
  if (data == null) return null
  const row = asArray(data)[0]
  if (!row?.id) return null
  return {
    id: str(row.id),
    job_code: strN(row.job_code),
    title: str(row.title),
    description: strN(row.description),
    status: str(row.status),
    priority: strN(row.priority),
    address: strN(row.address),
    site_name: strN(row.site_name),
    site_address: strN(row.site_address),
    scheduled_start: strN(row.scheduled_start),
    scheduled_end: strN(row.scheduled_end),
    opened_at: strN(row.opened_at),
    closed_at: strN(row.closed_at),
    updated_at: strN(row.updated_at),
    deal_id: strN(row.deal_id),
    project_code: strN(row.project_code),
    project_title: strN(row.project_title),
    photos_before: parseStringList(row.photos_before),
    photos_after: parseStringList(row.photos_after),
    photos: parseStringList(row.photos),
    team: parseTeam(row.team),
    checklist: parseChecklist(row.checklist),
    visits: parseVisits(row.visits),
    documents: parseJobDocuments(row.documents),
  }
}

/** Work reports on a job that the company lets the client see (newest first). */
export type ClientJobReport = {
  id: string
  author: string | null
  report_date: string
  start_time: string | null
  end_time: string | null
  work_performed: string
  materials_used: string | null
  marks_job_complete: boolean
}

export async function listJobReports(companyCode: string, clientCode: string, jobId: string): Promise<ClientJobReport[]> {
  const data = await rpc('client_portal_list_job_reports', { ...codes(companyCode, clientCode), p_job_id: jobId })
  return asArray(data).map(r => ({
    id: str(r.id),
    author: strN(r.author),
    report_date: str(r.report_date),
    start_time: strN(r.start_time),
    end_time: strN(r.end_time),
    work_performed: str(r.work_performed),
    materials_used: strN(r.materials_used),
    marks_job_complete: r.marks_job_complete === true,
  })).filter(r => r.id && r.work_performed)
}

export async function listProjects(companyCode: string, clientCode: string): Promise<ClientPortalProject[]> {
  const data = await rpc('client_portal_list_projects', codes(companyCode, clientCode))
  return asArray(data).map(parseClientPortalProject).filter(p => p.id)
}

export async function listMessageInbox(companyCode: string, clientCode: string): Promise<MessageInboxItem[]> {
  const data = await rpc('client_portal_list_message_inbox', codes(companyCode, clientCode))
  return asArray(data)
    .map((row) => ({
      deal_id: str(row.deal_id),
      project_title: str(row.project_title),
      project_code: strN(row.project_code),
      last_message_at: strN(row.last_message_at),
      last_message_preview: strN(row.last_message_preview),
      last_from_hr: Boolean(row.last_from_hr),
    }))
    .filter(i => i.deal_id)
}

export async function listInvoices(companyCode: string, clientCode: string): Promise<PortalInvoice[]> {
  const data = await rpc('client_portal_list_invoices', codes(companyCode, clientCode))
  return asArray(data).map((r) => ({
    id: str(r.id),
    company_id: str(r.company_id),
    client_id: strN(r.client_id),
    invoice_number: strN(r.invoice_number),
    status: str(r.status) || 'sent',
    currency: str(r.currency) || 'ZAR',
    subtotal: num(r.subtotal),
    vat_rate: num(r.vat_rate),
    vat_amount: num(r.vat_amount),
    total_amount: num(r.total_amount),
    amount_paid: num(r.amount_paid),
    balance_due: num(r.balance_due),
    issue_date: strN(r.issue_date),
    due_date: strN(r.due_date),
    notes: strN(r.notes),
  }))
}

export async function getProject(
  companyCode: string,
  clientCode: string,
  dealId: string,
): Promise<ClientPortalProject | null> {
  const data = await rpc('client_portal_get_project', {
    ...codes(companyCode, clientCode),
    p_deal_id: dealId,
  })
  if (data == null) return null
  const rows = asArray(data)
  if (rows.length === 0) return null
  const project = parseClientPortalProject(rows[0])
  if (!project.id) return null
  try {
    const raw = await rpc('client_portal_get_quotation_response', {
      ...codes(companyCode, clientCode),
      p_deal_id: dealId,
    })
    if (raw && typeof raw === 'object') {
      const response = raw as Record<string, unknown>
      const status = str(response.quotation_response)
      project.quotation_response = status === 'accepted' || status === 'revision_requested' ? status : 'pending'
      project.quotation_response_note = strN(response.quotation_response_note)
      project.quotation_response_at = strN(response.quotation_response_at)
      project.quotation_response_storage_path = strN(response.quotation_response_storage_path)
    }
  } catch {
    // The project still loads if the answer lookup fails.
  }
  return project
}

/** Object path inside workforce-media, whether the stored value is a path or a public URL. */
export function portalStorageObjectName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const noQuery = trimmed.split('?')[0]
  if (/^(job_photos|project_documents|job_documents|client_documents)\//.test(noQuery)) return noQuery
  const marker = '/workforce-media/'
  const at = noQuery.indexOf(marker)
  if (at === -1) return null
  const raw = noQuery.slice(at + marker.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Photos are stored as public links on a private bucket, so the browser cannot load them.
 * Mint a short-lived signed link for each file the portal already returned.
 */
export async function signPortalMedia(values: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))]
  const supabase = createClient()
  const signedByPath = new Map<string, string>()
  // Ask the server for read access to exactly these files first (checked against this client).
  const names = unique.map(portalStorageObjectName).filter((n): n is string => Boolean(n))
  await grantMediaRead(supabase, names)
  await Promise.all(unique.map(async (original) => {
    const name = portalStorageObjectName(original)
    if (!name) return
    const { data } = await supabase.storage.from('workforce-media').createSignedUrl(name, 3600)
    if (data?.signedUrl) signedByPath.set(name, data.signedUrl)
  }))
  const out: Record<string, string> = {}
  for (const original of unique) {
    const name = portalStorageObjectName(original)
    if (name && signedByPath.has(name)) out[original] = signedByPath.get(name) as string
    else if (!name && /^https?:\/\//i.test(original)) out[original] = original
  }
  return out
}

export async function sendMessage(
  companyCode: string,
  clientCode: string,
  dealId: string,
  body: string,
): Promise<void> {
  await rpc('client_portal_send_message', {
    ...codes(companyCode, clientCode),
    p_deal_id: dealId,
    p_body: body.trim(),
  })
}

export async function addDocumentLink(
  companyCode: string,
  clientCode: string,
  dealId: string,
  documentName: string,
  fileUrl: string,
): Promise<string> {
  const data = await rpc('client_portal_add_document_link', {
    ...codes(companyCode, clientCode),
    p_deal_id: dealId,
    p_document_name: documentName.trim(),
    p_file_url: fileUrl.trim(),
  })
  return typeof data === 'string' ? data.replace(/"/g, '') : str(data)
}

export async function registerDocument(
  companyCode: string,
  clientCode: string,
  dealId: string,
  documentName: string,
  fileUrl: string,
): Promise<string> {
  const data = await rpc('client_portal_register_document', {
    ...codes(companyCode, clientCode),
    p_deal_id: dealId,
    p_document_name: documentName.trim(),
    p_file_url: fileUrl.trim(),
  })
  return typeof data === 'string' ? data.replace(/"/g, '') : str(data)
}

/** Upload file to workforce-media then register . */
export async function uploadDocument(params: {
  companyCode: string
  clientCode: string
  companyId: string
  dealId: string
  file: File
  documentName: string
}): Promise<ProjectDocument> {
  const { companyCode, clientCode, companyId, dealId, file, documentName } = params
  const supabase = createClient()
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
  const path = `project_documents/${companyId}/${dealId}/client_${crypto.randomUUID()}${ext}`
  await rpc('client_portal_prepare_upload', {
    ...codes(companyCode, clientCode),
    p_storage_path: path,
  })

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (upErr) throw upErr

  const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(path)
  const fileUrl = pub.publicUrl
  const id = await registerDocument(companyCode, clientCode, dealId, documentName, fileUrl)

  return {
    id,
    document_name: documentName,
    document_type: 'client_upload',
    file_url: fileUrl,
    created_at: new Date().toISOString(),
  }
}

function handshakeError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Request failed.'
  if (message.includes('NOTE_REQUIRED')) throw new Error('Add a note so the office knows what to change.')
  if (message.includes('QUOTATION_NOT_SHARED')) throw new Error('There is no quotation to accept yet.')
  if (message.includes('QUOTATION_ALREADY_ACCEPTED')) throw new Error('This quotation is already accepted.')
  if (message.includes('REQUEST_NOT_OPEN')) throw new Error('That request is no longer waiting for a file.')
  if (message.includes('FILE_REQUIRED')) throw new Error('Choose a file to send.')
  throw error instanceof Error ? error : new Error(message)
}

export async function listDocumentRequests(
  companyCode: string,
  clientCode: string,
): Promise<ClientDocumentRequest[]> {
  const data = await rpc('client_portal_list_document_requests', codes(companyCode, clientCode))
  return asArray(data).map(row => ({
    id: str(row.id),
    document_name: str(row.document_name),
    document_type: str(row.document_type) || 'other',
    request_note: strN(row.request_note),
    status: str(row.status) || 'requested',
    review_note: strN(row.review_note),
    storage_path: strN(row.storage_path),
    submitted_at: strN(row.submitted_at),
    created_at: str(row.created_at) || new Date().toISOString(),
  })).filter(row => row.id)
}

async function uploadPortalClientFile(
  companyCode: string,
  clientCode: string,
  companyId: string,
  clientId: string,
  file: File,
  prefix: string,
): Promise<string> {
  const supabase = createClient()
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
  const path = `client_documents/${companyId}/${clientId}/${prefix}_${crypto.randomUUID()}${ext}`
  await rpc('client_portal_prepare_upload', {
    ...codes(companyCode, clientCode),
    p_storage_path: path,
  })
  const { error } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw error
  return path
}

export async function submitDocumentRequest(params: {
  companyCode: string
  clientCode: string
  companyId: string
  clientId: string
  requestId: string
  file: File
}): Promise<void> {
  const path = await uploadPortalClientFile(
    params.companyCode,
    params.clientCode,
    params.companyId,
    params.clientId,
    params.file,
    'portal',
  )
  try {
    await rpc('client_portal_submit_document_request', {
      ...codes(params.companyCode, params.clientCode),
      p_request_id: params.requestId,
      p_storage_path: path,
      p_file_size_bytes: params.file.size,
      p_mime_type: params.file.type || null,
    })
  } catch (error) {
    handshakeError(error)
  }
}

export async function acceptQuotation(companyCode: string, clientCode: string, dealId: string): Promise<void> {
  try {
    await rpc('client_portal_accept_quotation', {
      ...codes(companyCode, clientCode),
      p_deal_id: dealId,
    })
  } catch (error) {
    handshakeError(error)
  }
}

export async function reviseQuotation(params: {
  companyCode: string
  clientCode: string
  companyId: string
  clientId: string
  dealId: string
  note: string
  file: File | null
}): Promise<void> {
  const path = params.file
    ? await uploadPortalClientFile(
      params.companyCode,
      params.clientCode,
      params.companyId,
      params.clientId,
      params.file,
      'quote',
    )
    : null
  try {
    await rpc('client_portal_revise_quotation', {
      ...codes(params.companyCode, params.clientCode),
      p_deal_id: params.dealId,
      p_note: params.note,
      p_storage_path: path,
    })
  } catch (error) {
    handshakeError(error)
  }
}


function parseProfile(raw: unknown): ClientPortalProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const contacts = Array.isArray(row.contacts) ? (row.contacts as Record<string, unknown>[]) : []
  const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
  return {
    id: str(row.id),
    client_code: strN(row.client_code),
    name: str(row.name),
    legal_name: strN(row.legal_name),
    company_number: strN(row.company_number),
    vat_number: strN(row.vat_number),
    contact_person: strN(row.contact_person),
    email: strN(row.email),
    phone: strN(row.phone),
    mobile: strN(row.mobile),
    direct_line: strN(row.direct_line),
    fax: strN(row.fax),
    website: strN(row.website),
    address: strN(row.address),
    billing_address: strN(row.billing_address),
    account_number: strN(row.account_number),
    payment_terms_days: n(row.payment_terms_days),
    credit_limit: n(row.credit_limit),
    tax_exempt: row.tax_exempt == null ? null : Boolean(row.tax_exempt),
    contacts: contacts.map(c => ({ id: str(c.id), name: str(c.name), email: strN(c.email) })),
  }
}

/** The signed-in client's own details. */
export async function getProfile(companyCode: string, clientCode: string): Promise<ClientPortalProfile | null> {
  return parseProfile(await rpc('client_portal_get_profile', codes(companyCode, clientCode)))
}

/**
 * Save the client's own details. Changes apply straight away; the server records each
 * change (old → new) on the HR client record and notifies HR.
 */
export async function updateProfile(
  companyCode: string,
  clientCode: string,
  values: Record<ClientEditableField, string>,
): Promise<ClientPortalProfile | null> {
  if (!values.name.trim()) throw new Error('Company name is required.')
  const data = await rpc('client_portal_update_profile', {
    ...codes(companyCode, clientCode),
    p_name: values.name,
    p_legal_name: values.legal_name,
    p_company_number: values.company_number,
    p_vat_number: values.vat_number,
    p_contact_person: values.contact_person,
    p_email: values.email,
    p_phone: values.phone,
    p_mobile: values.mobile,
    p_direct_line: values.direct_line,
    p_fax: values.fax,
    p_website: values.website,
    p_address: values.address,
    p_billing_address: values.billing_address,
  })
  return parseProfile(data)
}

/** Full statement: invoices, payments, credit notes and refunds, in date order. */
export async function getStatement(companyCode: string, clientCode: string): Promise<ClientStatementEntry[]> {
  return parseStatementEntries(await rpc('client_portal_get_statement', codes(companyCode, clientCode)))
}

/** One invoice with its lines, for the PDF download. */
export async function getInvoiceForPdf(
  companyCode: string,
  clientCode: string,
  invoiceId: string,
): Promise<InvoicePdfInput | null> {
  const data = await rpc('client_portal_get_invoice', { ...codes(companyCode, clientCode), p_invoice_id: invoiceId })
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : []
  return {
    invoice_number: strN(r.invoice_number),
    status: str(r.status),
    issue_date: strN(r.issue_date),
    due_date: strN(r.due_date),
    notes: strN(r.notes),
    client_name: strN(r.client_name),
    client_email: strN(r.client_email),
    company_name: str(r.company_name),
    lines: lines.map(l => ({
      description: str(l.description),
      qty: Number(l.qty ?? 0) || 0,
      unit_price: Number(l.unit_price ?? 0) || 0,
      vat_amount: Number(l.vat_amount ?? 0) || 0,
      total: Number(l.total ?? 0) || 0,
    })),
    subtotal: Number(r.subtotal ?? 0) || 0,
    vat: Number(r.vat_amount ?? 0) || 0,
    total: Number(r.total_amount ?? 0) || 0,
    amount_paid: Number(r.amount_paid ?? 0) || 0,
    balance_due: Number(r.balance_due ?? 0) || 0,
    letterhead: await getLetterhead(companyCode, clientCode, str(r.company_name)).catch(() => null),
  }
}

/** The company's letterhead (logo, details, banking when switched on) for documents. */
export async function getLetterhead(companyCode: string, clientCode: string, fallbackName = ''): Promise<Letterhead> {
  const data = await rpc('client_portal_get_letterhead', codes(companyCode, clientCode))
  const lh = letterheadFromRow(data && typeof data === 'object' ? (data as Record<string, unknown>) : null, fallbackName)
  return loadLetterheadLogo(createClient(), lh)
}


/** Bank details for refunds: current (masked) and the latest request with its review result. */
export async function getBanking(companyCode: string, clientCode: string): Promise<ClientBankingView> {
  const data = await rpc('client_portal_get_banking', codes(companyCode, clientCode))
  const r = (data && typeof data === 'object' ? data : {}) as Partial<ClientBankingView>
  return { current: r.current ?? null, latest: r.latest ?? null }
}

/** Submit bank details for refunds; our team reviews them before they are used. */
export async function submitBanking(companyCode: string, clientCode: string, v: {
  accountHolder: string
  bankName: string
  accountNumber: string
  branchCode: string
  accountType: string
}): Promise<void> {
  const account = v.accountNumber.replace(/\s/g, '')
  if (!v.accountHolder.trim()) throw new Error('Account holder name is required.')
  if (!v.bankName.trim()) throw new Error('Bank name is required.')
  if (!/^[0-9]{5,20}$/.test(account)) throw new Error('Account number must be 5 to 20 digits.')
  await rpc('client_portal_submit_banking', {
    ...codes(companyCode, clientCode),
    p_account_holder: v.accountHolder,
    p_bank_name: v.bankName,
    p_account_number: account,
    p_branch_code: v.branchCode,
    p_account_type: v.accountType,
  })
}

export type ClientComplianceView = {
  summary: {
    status: 'not_configured' | 'compliant' | 'near' | 'partial' | 'non_compliant'
    score: number
    required_count: number
    complete_count: number
    missing_count: number
    pending_count: number
    expiring_count: number
    expired_count: number
    rejected_count: number
    has_pack: boolean
  }
  upload_prefix: string
  items: {
    document_type_code: string
    direction: 'from_party' | 'to_party'
    requirement: 'required' | 'recommended'
    validity_days: number | null
    expiry_required: boolean
    notes: string | null
    label: string
  }[]
  documents: {
    id: string
    document_type_code: string
    direction: 'from_party' | 'to_party'
    document_name: string
    storage_path: string
    issue_date: string | null
    expiry_date: string | null
    status: 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded'
    is_current: boolean
    rejected_reason: string | null
    uploaded_by_kind: string
    created_at: string
    reviewed_at: string | null
  }[]
}

/** Compliance checklist, the client's uploads and approved documents from us. */
export async function getCompliance(companyCode: string, clientCode: string): Promise<ClientComplianceView> {
  return (await rpc('client_portal_get_compliance', codes(companyCode, clientCode))) as ClientComplianceView
}

/** Upload a compliance document: checked upload, then registered as "waiting for review". */
export async function submitComplianceDocument(params: {
  companyCode: string
  clientCode: string
  uploadPrefix: string
  typeCode: string
  file: File
  issueDate: string | null
  expiryDate: string | null
  notes: string | null
}): Promise<string> {
  const { companyCode, clientCode, uploadPrefix, typeCode, file } = params
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) {
    throw new Error('Use a PDF, image, Word or Excel file.')
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.')
  const path = `${uploadPrefix}${crypto.randomUUID()}.${ext}`
  await rpc('client_portal_prepare_upload', { ...codes(companyCode, clientCode), p_storage_path: path })
  const supabase = createClient()
  const { error } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error(`Could not upload the file: ${error.message}`)
  const id = await rpc('client_portal_submit_compliance_document', {
    ...codes(companyCode, clientCode),
    p_type_code: typeCode,
    p_name: file.name,
    p_storage_path: path,
    p_mime: file.type || null,
    p_size: file.size,
    p_issue: params.issueDate || null,
    p_expiry: params.expiryDate || null,
    p_notes: params.notes || null,
  })
  return typeof id === 'string' ? id.replace(/"/g, '') : String(id)
}

// ── Compliance (the same system contractors use) ─────────────────────────────

/** Current compliance documents: the client's uploads plus approved documents we give them. */
export async function getPartyComplianceDocuments(companyCode: string, clientCode: string): Promise<ContractorDocument[]> {
  const rows = asArray(await rpc('client_portal_get_compliance_documents', codes(companyCode, clientCode)))
  const paths = rows.map(r => str(r.storage_path || r.file_url)).filter(Boolean)
  const signed = paths.length ? await signPortalMedia(paths).catch(() => ({} as Record<string, string>)) : {}
  return rows.map(r => {
    const path = str(r.storage_path || r.file_url)
    return {
      id: str(r.id),
      company_id: str(r.company_id),
      contractor_id: '',
      document_type: str(r.document_type),
      document_name: str(r.document_name),
      file_url: signed[path] ?? '',
      storage_path: path || null,
      approval_status: str(r.approval_status),
      rejected_reason: r.rejected_reason == null ? null : str(r.rejected_reason),
      is_required: Boolean(r.is_required),
      is_current: Boolean(r.is_current),
      uploaded_by_role: str(r.uploaded_by_role),
      expiry_date: r.expiry_date == null ? null : str(r.expiry_date),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      direction: r.direction === 'to_party' ? 'to_party' : 'from_party',
    }
  })
}

export async function getPartyCompliancePack(companyCode: string, clientCode: string): Promise<CompliancePackItem[]> {
  return asArray(await rpc('client_portal_get_compliance_pack', codes(companyCode, clientCode))).map(r => ({
    document_type: str(r.document_type),
    requirement: str(r.requirement),
    sort_order: num(r.sort_order),
    direction: r.direction === 'to_party' ? 'to_party' : 'from_party',
  }))
}

/** Checked upload into the client's own folder, then saved as "waiting for HR review". */
export async function uploadPartyComplianceDocument(params: {
  companyCode: string
  clientCode: string
  companyId: string
  clientId: string
  file: File
  documentType: string
  documentName: string
  expiryDate: string | null
  oldDocumentId: string | null
}): Promise<string> {
  const { companyCode, clientCode, companyId, clientId, file } = params
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) {
    throw new Error('Use a PDF, image, Word or Excel file.')
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.')
  const path = `client_documents/${companyId}/${clientId}/compliance/${crypto.randomUUID()}.${ext}`
  await rpc('client_portal_prepare_upload', { ...codes(companyCode, clientCode), p_storage_path: path })
  const supabase = createClient()
  const { error } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error(`Could not upload the file: ${error.message}`)
  const id = await rpc('client_portal_insert_document', {
    ...codes(companyCode, clientCode),
    p_document_type: params.documentType,
    p_document_name: params.documentName,
    p_storage_path: path,
    p_expiry_date: params.expiryDate || null,
    p_old_document_id: params.oldDocumentId || null,
  })
  return typeof id === 'string' ? id.replace(/"/g, '') : String(id)
}
