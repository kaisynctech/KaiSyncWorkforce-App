/**
 * Linked companies extras: search and filter, at-a-glance numbers, work from all contractors,
 * proof of payment and per-link history. See supabase/migrations/20261031120000_linked_extras.sql —
 * the database checks the company, the link and the person on every call.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { linkErrorMessage, statusWords, type CompanyLink } from '@/lib/company-links'

type R<T> = { ok: true; data: T } | { ok: false; message: string }

export type LinkSummary = { open_jobs: number; quotes_waiting: number; owing: number }
export type WorkItem = {
  kind: 'job' | 'quote' | 'invoice'
  link_id: string
  provider: string
  id: string
  ref: string | null
  title: string | null
  status: string | null
  date: string | null
  amount: number | null
}
export type PaymentProof = {
  id: string
  amount: number | null
  reference: string | null
  status: string
  submitted_at: string
  review_notes: string | null
}
export type HistoryRow = { action: string; at: string; who: string | null; details: Record<string, unknown> | null }

const EXTRA_MESSAGES: [RegExp, string][] = [
  [/INVOICE_NOT_FOUND/, 'That invoice was not found.'],
  [/INVOICE_CLOSED/, 'This invoice is already paid or closed.'],
  [/FILE_REQUIRED/, 'Choose a file to send.'],
  [/BAD_AMOUNT/, 'The amount must be more than zero.'],
]

export function extrasError(raw: string | null | undefined): string {
  const text = raw ?? ''
  for (const [re, msg] of EXTRA_MESSAGES) if (re.test(text)) return msg
  return linkErrorMessage(text)
}

async function call<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<R<T>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args)
  if (error) return { ok: false, message: extrasError(error.message) }
  return { ok: true, data: data as T }
}

// ── Search and status filter (pure, tested) ──────────────────────────────────

export type StatusFilter = 'all' | 'linked' | 'waiting'

/** Links whose company, legal name or my record matches the search, with the chosen status. */
export function filterLinks(links: CompanyLink[], query: string, status: StatusFilter): CompanyLink[] {
  const q = query.trim().toLowerCase()
  return links.filter(l => {
    if (status === 'linked' && l.status !== 'active') return false
    if (status === 'waiting' && l.status !== 'pending') return false
    if (!q) return true
    return [l.other.name, l.other.legal_name, l.my_record_name, statusWords(l)]
      .some(v => (v ?? '').toLowerCase().includes(q))
  })
}

// ── At a glance and work overview ────────────────────────────────────────────

export async function linkSummary(supabase: SupabaseClient, companyId: string): Promise<R<Record<string, LinkSummary>>> {
  const res = await call<Record<string, LinkSummary> | null>(supabase, 'linked_summary', { p_company_id: companyId })
  if (!res.ok) return res
  const out: Record<string, LinkSummary> = {}
  for (const [id, v] of Object.entries(res.data ?? {})) {
    out[id] = { open_jobs: Number(v?.open_jobs ?? 0), quotes_waiting: Number(v?.quotes_waiting ?? 0), owing: Number(v?.owing ?? 0) }
  }
  return { ok: true, data: out }
}

export async function workOverview(supabase: SupabaseClient, companyId: string): Promise<R<WorkItem[]>> {
  const res = await call<WorkItem[] | null>(supabase, 'linked_work_overview', { p_company_id: companyId })
  return res.ok ? { ok: true, data: sortWork(res.data ?? []) } : res
}

const KIND_ORDER: Record<WorkItem['kind'], number> = { quote: 0, invoice: 1, job: 2 }

/** Quotes waiting first, then invoices owing, then open jobs; newest or soonest first inside each. */
export function sortWork(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (k !== 0) return k
    return (a.date ?? '9999').localeCompare(b.date ?? '9999')
  })
}

/** Where a work item opens inside the linked view. */
export function workHref(item: WorkItem): string {
  const base = `/dashboard/linked-companies/${item.link_id}`
  if (item.kind === 'job') return `${base}/jobs/${item.id}`
  if (item.kind === 'quote') return `${base}/projects/${item.id}`
  return `${base}?tab=invoices`
}

export function workStatusWords(item: WorkItem): string {
  if (item.kind === 'quote') return 'Waiting for your answer'
  return (item.status ?? '').replace(/_/g, ' ') || '—'
}

// ── Proof of payment ─────────────────────────────────────────────────────────

const PROOF_TYPES = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic']

/** Problem with the chosen file, or null when it is fine. */
export function proofFileProblem(file: { name: string; size: number } | null): string | null {
  if (!file) return 'Choose a file to send.'
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!file.name.includes('.') || !PROOF_TYPES.includes(ext)) return 'Use a PDF or a photo (JPG, PNG).'
  if (file.size > 10 * 1024 * 1024) return 'The file is larger than 10 MB.'
  return null
}

/** Upload into the provider's folder for us (checked by the database), then send it for review. */
export async function sendPaymentProof(supabase: SupabaseClient, params: {
  companyId: string
  linkId: string
  providerCompanyId: string
  clientId: string
  invoiceId: string
  file: File
  amount: number | null
  reference: string
}): Promise<R<string>> {
  const problem = proofFileProblem(params.file)
  if (problem) return { ok: false, message: problem }
  const ext = params.file.name.split('.').pop()!.toLowerCase()
  const path = `client_documents/${params.providerCompanyId}/${params.clientId}/payment_${crypto.randomUUID()}.${ext}`
  const prep = await call<unknown>(supabase, 'linked_prepare_upload', { p_company_id: params.companyId, p_link_id: params.linkId, p_storage_path: path })
  if (!prep.ok) return prep
  const { error } = await supabase.storage.from('workforce-media').upload(path, params.file, { upsert: false, contentType: params.file.type || undefined })
  if (error) return { ok: false, message: `Could not upload the file: ${error.message}` }
  return call<string>(supabase, 'linked_submit_payment_proof', {
    p_company_id: params.companyId,
    p_link_id: params.linkId,
    p_invoice_id: params.invoiceId,
    p_storage_path: path,
    p_amount: params.amount,
    p_reference: params.reference.trim() || null,
    p_notes: null,
  })
}

export async function paymentProofs(supabase: SupabaseClient, companyId: string, linkId: string, invoiceId: string): Promise<R<PaymentProof[]>> {
  const res = await call<PaymentProof[] | null>(supabase, 'linked_list_payment_proofs', { p_company_id: companyId, p_link_id: linkId, p_invoice_id: invoiceId })
  return res.ok ? { ok: true, data: res.data ?? [] } : res
}

export function proofStatusWords(status: string): string {
  if (status === 'submitted') return 'Waiting for review'
  if (status === 'accepted') return 'Accepted'
  if (status === 'rejected') return 'Rejected'
  return status
}

// ── History ──────────────────────────────────────────────────────────────────

export async function linkHistory(supabase: SupabaseClient, companyId: string, linkId: string): Promise<R<HistoryRow[]>> {
  const res = await call<HistoryRow[] | null>(supabase, 'linked_link_history', { p_company_id: companyId, p_link_id: linkId })
  return res.ok ? { ok: true, data: res.data ?? [] } : res
}

const HISTORY_WORDS: Record<string, string> = {
  company_link_requested: 'Link requested',
  company_link_accepted: 'Link accepted',
  company_link_declined: 'Link declined',
  company_link_disconnected: 'Disconnected',
  linked_quote_accepted: 'Quote accepted',
  linked_quote_revision_requested: 'Changes asked on a quote',
  linked_message_sent: 'Message sent',
  linked_project_document_added: 'Document added to a project',
  linked_document_request_submitted: 'Requested document sent',
  linked_compliance_uploaded: 'Compliance document sent',
  linked_details_updated: 'Company details updated',
  linked_banking_submitted: 'Banking details sent',
  linked_job_created: 'Job created',
  linked_job_cancelled: 'Job cancelled',
  linked_payment_proof_submitted: 'Proof of payment sent',
  linked_from_provider_quote: 'Quote sent',
  linked_from_provider_invoice: 'Invoice sent',
  linked_from_provider_message: 'Message from the provider',
  linked_from_provider_job_created: 'Job created by the provider',
  linked_from_provider_job_assigned: 'Team assigned',
  linked_from_provider_job_completed: 'Job completed',
}

/** The history action in plain words (unknown ones are made readable). */
export function historyWords(action: string): string {
  if (HISTORY_WORDS[action]) return HISTORY_WORDS[action]
  const words = action.replace(/^(company_link_|linked_from_provider_|linked_)/, '').replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : action
}

// ── Alerts ───────────────────────────────────────────────────────────────────

/** Where a linked-company alert opens, or null for other alerts. */
export function linkedAlertHref(n: { type?: string | null; ref_type?: string | null; ref_id?: string | null; data?: Record<string, unknown> | null }): string | null {
  const type = n.type ?? ''
  const ref = n.ref_id ?? ''
  if (type === 'linked_payment_proof') return ref ? `/dashboard/money/invoices/${ref}` : null
  if (!type.startsWith('linked_from_provider_')) return null
  const linkId = typeof n.data?.link_id === 'string' ? n.data.link_id : ''
  if (!linkId) return '/dashboard/linked-companies'
  const base = `/dashboard/linked-companies/${linkId}`
  if (n.ref_type === 'job' && ref) return `${base}/jobs/${ref}`
  if (n.ref_type === 'project' && ref) return `${base}/projects/${ref}${type.endsWith('_message') ? '?messages=1' : ''}`
  if (n.ref_type === 'invoice') return `${base}?tab=invoices`
  return base
}
