/**
 * Tenant portal RPC wrappers — anon code-auth.
 */

import { createClient } from '@/lib/supabase/client'
import type {
  TenantInvoice,
  TenantIssue,
  TenantLeasePayload,
  TenantPortalLogin,
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

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') return [data as Record<string, unknown>]
  return []
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(name, args)
  if (error) throw new Error(error.message)
  return data
}

function codes(companyCode: string, residentCode: string) {
  return {
    p_company_code: companyCode.trim(),
    p_resident_code: residentCode.trim(),
  }
}

export async function resolveResidentByCode(
  companyCode: string,
  residentCode: string,
): Promise<TenantPortalLogin | null> {
  const data = await rpc('resident_resolve_by_code', codes(companyCode, residentCode))
  const rows = asArray(data)
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    resident_id: str(r.resident_id),
    company_id: str(r.company_id),
    company_code: str(r.company_code),
    resident_code: str(r.resident_code),
    resident_name: str(r.resident_name),
    email: strN(r.email),
    phone: strN(r.phone),
  }
}

export async function getLeaseSummary(
  companyCode: string,
  residentCode: string,
): Promise<TenantLeasePayload> {
  const data = await rpc('resident_portal_get_lease_summary', codes(companyCode, residentCode))
  const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const resident = (payload.resident ?? {}) as Record<string, unknown>
  const leases = asArray(payload.leases).map(l => ({
    id: str(l.id),
    status: str(l.status),
    start_date: str(l.start_date),
    end_date: strN(l.end_date),
    rent_amount: l.rent_amount == null ? null : num(l.rent_amount),
    deposit_amount: l.deposit_amount == null ? null : num(l.deposit_amount),
    currency: str(l.currency) || 'ZAR',
    payment_frequency: str(l.payment_frequency),
    notes: strN(l.notes),
    site_id: str(l.site_id),
    site_name: str(l.site_name),
    site_address: strN(l.site_address),
    unit_id: strN(l.unit_id),
    unit_number: strN(l.unit_number),
    unit_type: strN(l.unit_type),
  }))
  return {
    resident: {
      id: str(resident.id),
      name: str(resident.name),
      surname: str(resident.surname),
      phone: strN(resident.phone),
      email: strN(resident.email),
      move_in_date: strN(resident.move_in_date),
      move_out_date: strN(resident.move_out_date),
    },
    leases,
  }
}

export async function listInvoices(
  companyCode: string,
  residentCode: string,
): Promise<TenantInvoice[]> {
  const data = await rpc('resident_portal_list_invoices', codes(companyCode, residentCode))
  return asArray(data).map(r => ({
    id: str(r.id),
    invoice_number: strN(r.invoice_number),
    status: str(r.status),
    issue_date: str(r.issue_date),
    due_date: strN(r.due_date),
    total_amount: num(r.total_amount),
    amount_paid: num(r.amount_paid),
    balance_due: num(r.balance_due),
    currency: str(r.currency) || 'ZAR',
    invoice_type: strN(r.invoice_type),
    lease_id: strN(r.lease_id),
    site_id: strN(r.site_id),
  }))
}

export async function listIssues(
  companyCode: string,
  residentCode: string,
): Promise<TenantIssue[]> {
  const data = await rpc('resident_portal_list_issues', codes(companyCode, residentCode))
  return asArray(data).map(r => ({
    id: str(r.id),
    job_code: strN(r.job_code),
    title: str(r.title),
    description: strN(r.description),
    status: str(r.status),
    opened_at: str(r.opened_at),
    site_id: strN(r.site_id),
    unit_id: strN(r.unit_id),
    photo_urls_before: Array.isArray(r.photo_urls_before)
      ? (r.photo_urls_before as string[])
      : null,
  }))
}

export async function submitPaymentProof(params: {
  companyCode: string
  residentCode: string
  companyId: string
  invoiceId: string
  file: File
  amount?: number | null
  reference?: string | null
  notes?: string | null
}): Promise<void> {
  const supabase = createClient()
  const ext = params.file.name.includes('.')
    ? `.${params.file.name.split('.').pop()!.toLowerCase()}`
    : '.jpg'
  const storagePath = `payment_proofs/${params.companyId}/${params.invoiceId}/${crypto.randomUUID()}${ext}`

  await rpc('resident_portal_prepare_payment_proof_upload', {
    ...codes(params.companyCode, params.residentCode),
    p_invoice_id: params.invoiceId,
    p_storage_path: storagePath,
  })

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(storagePath, params.file, { upsert: true, contentType: params.file.type || undefined })
  if (upErr) throw new Error(upErr.message)

  const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(storagePath)

  await rpc('resident_portal_submit_payment_proof', {
    ...codes(params.companyCode, params.residentCode),
    p_invoice_id: params.invoiceId,
    p_storage_path: storagePath,
    p_file_url: pub.publicUrl,
    p_amount: params.amount ?? null,
    p_reference: params.reference ?? null,
    p_notes: params.notes ?? null,
  })
}

export async function createIssue(params: {
  companyCode: string
  residentCode: string
  companyId: string
  title: string
  description?: string | null
  leaseId?: string | null
  photo?: File | null
}): Promise<{ id: string; job_code: string | null }> {
  const data = await rpc('resident_portal_create_issue', {
    ...codes(params.companyCode, params.residentCode),
    p_title: params.title,
    p_description: params.description ?? null,
    p_lease_id: params.leaseId ?? null,
  }) as Record<string, unknown>

  const jobId = str(data.id)
  const jobCode = strN(data.job_code)

  if (params.photo && jobId) {
    const supabase = createClient()
    const ext = params.photo.name.includes('.')
      ? `.${params.photo.name.split('.').pop()!.toLowerCase()}`
      : '.jpg'
    const storagePath = `job_photos/${params.companyId}/${jobId}/before/${crypto.randomUUID()}${ext}`

    await rpc('resident_portal_prepare_issue_photo_upload', {
      ...codes(params.companyCode, params.residentCode),
      p_job_id: jobId,
      p_storage_path: storagePath,
    })

    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(storagePath, params.photo, { upsert: true, contentType: params.photo.type || undefined })
    if (upErr) throw new Error(upErr.message)

    const { data: pub } = supabase.storage.from('workforce-media').getPublicUrl(storagePath)
    await rpc('resident_portal_append_issue_photo', {
      ...codes(params.companyCode, params.residentCode),
      p_job_id: jobId,
      p_photo_url: pub.publicUrl,
    })
  }

  return { id: jobId, job_code: jobCode }
}
