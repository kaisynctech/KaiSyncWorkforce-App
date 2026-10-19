/**
 * Client portal RPC wrappers — anon code-auth, mirrors SupabaseStorageService portal methods.
 */

import { createClient } from '@/lib/supabase/client'
import type {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args)
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
