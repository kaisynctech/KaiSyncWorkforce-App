/**
 * One compliance system: contractors and clients share the contractor compliance tables
 * (packs, pack items, documents). These wrappers cover the client side and the HR grade.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompliancePackItem, ContractorDocument } from '@/lib/contractor-portal/types'

export type PartyKind = 'client' | 'contractor'

async function call<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message || 'Request failed.')
  return data as T
}

export type GradeInfo = {
  grade: 'A' | 'B' | 'C' | 'D' | null
  reason: string | null
  set_at: string | null
  can_edit: boolean
  history: { grade: string | null; reason: string; set_at: string; set_by_name: string | null }[]
}

export function getGrade(supabase: SupabaseClient, companyId: string, kind: PartyKind, partyId: string) {
  return call<GradeInfo>(supabase, 'hr_get_compliance_grade', { p_company_id: companyId, p_kind: kind, p_party_id: partyId })
}

export function setGrade(supabase: SupabaseClient, companyId: string, kind: PartyKind, partyId: string, grade: string | null, reason: string) {
  return call<void>(supabase, 'hr_set_compliance_grade', {
    p_company_id: companyId, p_kind: kind, p_party_id: partyId, p_grade: grade, p_reason: reason,
  })
}

export type ClientComplianceData = {
  pack_id: string | null
  can_edit: boolean
  can_review: boolean
  upload_prefix: string
  packs: { id: string; name: string; is_default: boolean }[]
  items: CompliancePackItem[]
  documents: (ContractorDocument & { direction: 'from_party' | 'to_party' })[]
}

export async function getClientCompliance(supabase: SupabaseClient, companyId: string, clientId: string): Promise<ClientComplianceData> {
  const d = await call<ClientComplianceData>(supabase, 'hr_get_client_compliance', { p_company_id: companyId, p_client_id: clientId })
  return {
    ...d,
    packs: d.packs ?? [],
    items: d.items ?? [],
    documents: (d.documents ?? []).map(doc => ({ ...doc, company_id: companyId, contractor_id: '', direction: doc.direction ?? 'from_party' })),
  }
}

export function assignClientPack(supabase: SupabaseClient, companyId: string, clientId: string, packId: string | null) {
  return call<void>(supabase, 'hr_assign_client_compliance_pack', { p_company_id: companyId, p_client_id: clientId, p_pack_id: packId })
}

export function reviewClientDocument(supabase: SupabaseClient, documentId: string, action: 'approve' | 'reject' | 'remove', reason?: string | null) {
  return call<void>(supabase, 'hr_review_client_document', { p_document_id: documentId, p_action: action, p_reason: reason ?? null })
}

/** HR upload: saved as approved straight away and replaces the current file of the same type. */
export async function uploadClientDocument(supabase: SupabaseClient, p: {
  companyId: string
  clientId: string
  uploadPrefix: string
  file: File
  documentType: string
  direction: 'from_party' | 'to_party'
  expiryDate: string | null
}): Promise<string> {
  const ext = (p.file.name.split('.').pop() ?? '').toLowerCase()
  if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) {
    throw new Error('Use a PDF, image, Word or Excel file.')
  }
  if (p.file.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.')
  const path = `${p.uploadPrefix}hr_${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('workforce-media').upload(path, p.file, { upsert: false, contentType: p.file.type || undefined })
  if (error) throw new Error(`Could not upload the file: ${error.message}`)
  return call<string>(supabase, 'hr_upload_client_document', {
    p_company_id: p.companyId, p_client_id: p.clientId, p_document_type: p.documentType, p_direction: p.direction,
    p_document_name: p.file.name, p_storage_path: path, p_expiry_date: p.expiryDate || null,
  })
}

export type OverviewRow = {
  party_id: string
  name: string
  code: string | null
  pack_id: string | null
  pack_name: string | null
  hr_grade: string | null
  required_count: number
  complete_count: number
  pending_count: number
  missing_count: number
  expiring_count: number
  expired_count: number
  rejected_count: number
  obligations_open: number
}

export async function getOverview(supabase: SupabaseClient, companyId: string, kind: PartyKind): Promise<OverviewRow[]> {
  const d = await call<OverviewRow[] | null>(supabase, 'hr_compliance_overview', { p_company_id: companyId, p_kind: kind })
  return d ?? []
}

export type PackItemInput = { document_type: string; requirement: 'required' | 'recommended'; direction: 'from_party' | 'to_party' }

export function upsertClientPack(supabase: SupabaseClient, companyId: string, packId: string | null, name: string, description: string | null, items: PackItemInput[]) {
  return call<string>(supabase, 'hr_upsert_client_compliance_pack', {
    p_company_id: companyId, p_pack_id: packId, p_name: name, p_description: description, p_items: items,
  })
}
