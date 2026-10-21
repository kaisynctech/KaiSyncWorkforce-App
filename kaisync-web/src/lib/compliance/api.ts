/**
 * Shared compliance engine (CLIENT-COMPLIANCE-SPEC-001) — HR side.
 * All writes go through checked database functions; scores are computed on the server.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type PartyKind = 'client' | 'contractor'
export type Direction = 'from_party' | 'to_party'
export type ComplianceStatus = 'not_configured' | 'compliant' | 'near' | 'partial' | 'non_compliant'
export type DocStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded'

export type ComplianceSummary = {
  pack_id: string | null
  status: ComplianceStatus
  score: number
  required_count: number
  complete_count: number
  missing_count: number
  pending_count: number
  expiring_count: number
  expired_count: number
  rejected_count: number
  obligations_open: number
  hr_grade: 'A' | 'B' | 'C' | 'D' | null
  hr_grade_reason: string | null
  hr_grade_set_at: string | null
  last_evaluated_at: string | null
}

export type PackItem = {
  id?: string
  document_type_code: string
  direction: Direction
  requirement: 'required' | 'recommended'
  validity_days: number | null
  expiry_required: boolean
  weight: number
  notes: string | null
  label?: string
}

export type ComplianceDocument = {
  id: string
  document_type_code: string
  direction: Direction
  document_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  issue_date: string | null
  expiry_date: string | null
  status: DocStatus
  is_current: boolean
  reviewed_at: string | null
  rejected_reason: string | null
  uploaded_by_kind: 'hr' | 'client_portal' | 'contractor_portal' | 'migration'
  created_at: string
  reviewed_by_name: string | null
}

export type PartyCompliance = {
  summary: ComplianceSummary
  can_review: boolean
  can_edit: boolean
  upload_prefix: string
  pack: { id: string; name: string } | null
  items: PackItem[]
  documents: ComplianceDocument[]
  grade_history: { grade: string | null; reason: string; set_at: string; set_by_name: string | null }[]
  packs: { id: string; name: string; is_default: boolean }[]
}

export type DocType = {
  code: string
  label: string
  default_direction: Direction
  default_validity_days: number | null
  party_kind: 'client' | 'contractor' | 'any'
}

export type PackWithItems = {
  id: string
  name: string
  description: string | null
  is_default: boolean
  is_archived: boolean
  assigned_count: number
  items: PackItem[]
}

export type OverviewRow = {
  party_id: string
  name: string
  code: string | null
  pack_id: string | null
  pack_name: string | null
  status: ComplianceStatus
  score: number
  hr_grade: string | null
  pending_count: number
  expiring_count: number
  expired_count: number
  missing_count: number
  obligations_open: number
  last_evaluated_at: string | null
}

async function call<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args)
  if (error) {
    const msg = String(error.message ?? 'Request failed')
    if (msg.includes('INSUFFICIENT_PERMISSION')) throw new Error('You do not have permission to do this.')
    throw new Error(msg)
  }
  return data as T
}

export const STATUS_LABEL: Record<ComplianceStatus, string> = {
  not_configured: 'No pack assigned',
  compliant: 'Compliant',
  near: 'Nearly compliant',
  partial: 'Partially compliant',
  non_compliant: 'Non-compliant',
}

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  superseded: 'Replaced',
}

export function statusTone(s: ComplianceStatus): 'success' | 'warning' | 'error' | 'muted' {
  if (s === 'compliant') return 'success'
  if (s === 'near' || s === 'partial') return 'warning'
  if (s === 'non_compliant') return 'error'
  return 'muted'
}

export const getPartyCompliance = (s: SupabaseClient, companyId: string, kind: PartyKind, partyId: string) =>
  call<PartyCompliance>(s, 'hr_get_party_compliance', { p_company_id: companyId, p_kind: kind, p_party_id: partyId })

export const assignPack = (s: SupabaseClient, companyId: string, kind: PartyKind, partyId: string, packId: string | null) =>
  call<ComplianceSummary>(s, 'hr_assign_compliance_pack', { p_company_id: companyId, p_kind: kind, p_party_id: partyId, p_pack_id: packId })

export const reviewDocument = (s: SupabaseClient, documentId: string, approve: boolean, reason?: string) =>
  call<ComplianceSummary>(s, 'hr_review_compliance_document', { p_document_id: documentId, p_approve: approve, p_reason: reason ?? null })

export const setGrade = (s: SupabaseClient, companyId: string, kind: PartyKind, partyId: string, grade: string | null, reason: string) =>
  call<ComplianceSummary>(s, 'hr_set_party_grade', { p_company_id: companyId, p_kind: kind, p_party_id: partyId, p_grade: grade, p_reason: reason })

export const getOverview = (s: SupabaseClient, companyId: string, kind: PartyKind) =>
  call<OverviewRow[]>(s, 'hr_get_compliance_overview', { p_company_id: companyId, p_kind: kind })

export const listPacks = (s: SupabaseClient, companyId: string, kind: PartyKind) =>
  call<{ packs: PackWithItems[]; types: DocType[] }>(s, 'hr_list_compliance_packs', { p_company_id: companyId, p_kind: kind })

export const upsertPack = (s: SupabaseClient, companyId: string, kind: PartyKind, pack: {
  id: string | null; name: string; description: string; is_default: boolean; items: PackItem[]
}) => call<string>(s, 'hr_upsert_compliance_pack', {
  p_company_id: companyId, p_pack_id: pack.id, p_party_kind: kind, p_name: pack.name,
  p_description: pack.description, p_is_default: pack.is_default,
  p_items: pack.items.map(i => ({
    document_type_code: i.document_type_code, direction: i.direction, requirement: i.requirement,
    validity_days: i.validity_days ?? '', expiry_required: i.expiry_required, weight: i.weight, notes: i.notes ?? '',
  })),
})

export const archivePack = (s: SupabaseClient, packId: string, archived: boolean) =>
  call<void>(s, 'hr_archive_compliance_pack', { p_pack_id: packId, p_archived: archived })

const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx']
export const MAX_COMPLIANCE_FILE_BYTES = 25 * 1024 * 1024

export function checkComplianceFile(file: File): string | null {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) return 'Use a PDF, image, Word or Excel file.'
  if (file.size > MAX_COMPLIANCE_FILE_BYTES) return 'The file is larger than 25 MB.'
  return null
}

/** HR upload: file to storage under the party's compliance folder, then register it. */
export async function hrUploadDocument(s: SupabaseClient, p: {
  companyId: string; kind: PartyKind; partyId: string; uploadPrefix: string; file: File
  typeCode: string; direction: Direction; name: string; issueDate: string | null; expiryDate: string | null; notes: string | null
}): Promise<string> {
  const problem = checkComplianceFile(p.file)
  if (problem) throw new Error(problem)
  const ext = (p.file.name.split('.').pop() ?? 'pdf').toLowerCase()
  const path = `${p.uploadPrefix}${crypto.randomUUID()}.${ext}`
  const { error } = await s.storage.from('workforce-media').upload(path, p.file, { upsert: false, contentType: p.file.type || undefined })
  if (error) throw new Error(`Could not upload the file: ${error.message}`)
  return call<string>(s, 'hr_upload_compliance_document', {
    p_company_id: p.companyId, p_kind: p.kind, p_party_id: p.partyId, p_type_code: p.typeCode, p_direction: p.direction,
    p_name: p.name || p.file.name, p_storage_path: path, p_mime: p.file.type || null, p_size: p.file.size,
    p_issue: p.issueDate || null, p_expiry: p.expiryDate || null, p_notes: p.notes || null,
  })
}

/** Checklist row for one pack item: the current document (if any) and its state. */
export type ChecklistRow = {
  item: PackItem
  doc: ComplianceDocument | null
  state: 'missing' | 'pending' | 'approved' | 'expiring' | 'expired' | 'rejected'
}

export function buildChecklist(items: PackItem[], docs: ComplianceDocument[], today = new Date().toISOString().slice(0, 10)): ChecklistRow[] {
  const in30 = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10)
  return items.map(item => {
    const doc = docs.find(d => d.is_current && d.status !== 'superseded'
      && d.document_type_code === item.document_type_code && d.direction === item.direction) ?? null
    let state: ChecklistRow['state'] = 'missing'
    if (doc) {
      if (doc.status === 'approved') {
        if (doc.expiry_date && doc.expiry_date < today) state = 'expired'
        else if (doc.expiry_date && doc.expiry_date <= in30) state = 'expiring'
        else state = 'approved'
      } else if (doc.status === 'expired') state = 'expired'
      else if (doc.status === 'pending') state = 'pending'
      else if (doc.status === 'rejected') state = 'rejected'
    }
    return { item, doc, state }
  })
}
