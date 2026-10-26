/**
 * Equipment (assets) inside client areas, the units on a job card, and each unit's service history.
 * Tables: assets (area_id, quantity, capacity), job_assets. Technicians use the employee_* RPCs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AreaOption, Result, SiteArea, UnitImportRow } from '@/lib/job-services'

export type Equipment = {
  id: string
  site_id: string | null
  area_id: string | null
  asset_type: string
  label: string | null
  manufacturer: string | null
  model_number: string | null
  serial_number: string | null
  capacity: string | null
  quantity: number
  status: string
  notes: string | null
}

export type JobEquipmentStatus = 'pending' | 'done' | 'not_done'

export type JobEquipment = {
  id: string
  asset_id: string
  status: JobEquipmentStatus
  notes: string | null
  done_at: string | null
  asset: Equipment | null
}

export type EquipmentHistoryRow = {
  id: string
  status: JobEquipmentStatus
  notes: string | null
  done_at: string | null
  created_at: string
  job: { id: string; job_code: string | null; title: string; status: string | null; scheduled_start: string | null; service: { name: string } | null } | null
}

export const EQUIPMENT_COLUMNS =
  'id, site_id, area_id, asset_type, label, manufacturer, model_number, serial_number, capacity, quantity, status, notes'

export const STATUS_LABEL: Record<JobEquipmentStatus, string> = { pending: 'To do', done: 'Done', not_done: 'Not done' }

function friendly(message: string): string {
  if (/job_assets_job_id_asset_id_key/.test(message)) return 'That unit is already on this job.'
  if (/AREA_NOT_IN_SITE/.test(message)) return 'That area is at a different site.'
  if (/row-level security|permission denied/i.test(message)) return 'You do not have permission to change this.'
  if (/NOT_ASSIGNED_TO_JOB/.test(message)) return 'You are not assigned to this job.'
  return message
}

/** "Midea Underceiling · 36 000 btu × 2" */
export function equipmentName(e: Pick<Equipment, 'asset_type' | 'label' | 'manufacturer' | 'model_number' | 'capacity' | 'quantity'>): string {
  const make = [e.manufacturer, e.model_number].filter(Boolean).join(' ')
  const main = [e.label, make, e.asset_type].filter(Boolean).join(' ')
  const size = e.capacity ? ` · ${e.capacity}` : ''
  const qty = e.quantity > 1 ? ` × ${e.quantity}` : ''
  return `${main}${size}${qty}`
}

export async function listSiteEquipment(
  supabase: SupabaseClient, companyId: string, siteIds: string[],
): Promise<Result<Equipment[]>> {
  if (siteIds.length === 0) return { ok: true, data: [] }
  const out: Equipment[] = []
  for (let i = 0; i < siteIds.length; i += 100) {
    const { data, error } = await supabase.from('assets').select(EQUIPMENT_COLUMNS)
      .eq('company_id', companyId).in('site_id', siteIds.slice(i, i + 100))
      .order('asset_type').limit(5000)
    if (error) return { ok: false, message: friendly(error.message) }
    out.push(...((data ?? []) as Equipment[]))
  }
  return { ok: true, data: out }
}

export type EquipmentInput = {
  siteId: string
  areaId: string | null
  assetType: string
  manufacturer?: string
  capacity?: string
  quantity?: number
  label?: string
  serialNumber?: string
  notes?: string
}

function payload(input: EquipmentInput) {
  const q = Number(input.quantity ?? 1)
  return {
    site_id: input.siteId,
    area_id: input.areaId || null,
    asset_type: input.assetType.trim(),
    manufacturer: input.manufacturer?.trim() || null,
    capacity: input.capacity?.trim() || null,
    quantity: Number.isInteger(q) && q >= 1 ? q : 1,
    label: input.label?.trim() || null,
    serial_number: input.serialNumber?.trim() || null,
    notes: input.notes?.trim() || null,
  }
}

export async function saveEquipment(
  supabase: SupabaseClient, companyId: string, input: EquipmentInput, id?: string,
): Promise<Result<Equipment>> {
  if (!input.assetType.trim()) return { ok: false, message: 'Type is required, e.g. Midwall-split.' }
  const q = id
    ? supabase.from('assets').update(payload(input)).eq('id', id).eq('company_id', companyId)
    : supabase.from('assets').insert({ company_id: companyId, ...payload(input) })
  const { data, error } = await q.select(EQUIPMENT_COLUMNS).single()
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: data as Equipment }
}

export async function removeEquipment(supabase: SupabaseClient, companyId: string, id: string): Promise<Result<void>> {
  const { error } = await supabase.from('assets').delete().eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

/**
 * Adds the units read from a sheet to the areas of one site. Areas are matched by name
 * (area, or area › inner area). A unit that was already in that area before the import (same make, type and
 * size) is skipped, so importing the same sheet again adds nothing; repeated lines within one sheet are all kept.
 */
export async function importSiteEquipment(
  supabase: SupabaseClient, companyId: string, siteId: string,
  units: UnitImportRow[], areas: SiteArea[], existing: Equipment[],
): Promise<Result<{ added: number; skipped: number }>> {
  const top = new Map<string, string>()
  for (const a of areas) if (!a.parent_area_id) top.set(norm(a.name), a.id)
  const inner = new Map<string, string>()
  for (const a of areas) if (a.parent_area_id) inner.set(`${a.parent_area_id}|${norm(a.name)}`, a.id)
  const key = (areaId: string, make: string, type: string, size: string) => `${areaId}|${norm(make)}|${norm(type)}|${norm(size)}`
  const known = new Set(existing.filter(e => e.area_id).map(e => key(e.area_id!, e.manufacturer ?? '', e.asset_type, e.capacity ?? '')))
  const rows: Record<string, unknown>[] = []
  let skipped = 0
  for (const u of units) {
    const parent = top.get(norm(u.area))
    const areaId = u.subArea ? (parent ? inner.get(`${parent}|${norm(u.subArea)}`) : undefined) : parent
    if (!areaId) { skipped++; continue }
    if (known.has(key(areaId, u.make, u.type, u.size))) { skipped++; continue }
    rows.push({
      company_id: companyId, site_id: siteId, area_id: areaId, asset_type: u.type.slice(0, 120),
      manufacturer: u.make || null, capacity: u.size ? u.size.slice(0, 80) : null, quantity: u.quantity, notes: u.notes || null,
    })
  }
  let added = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.from('assets').insert(rows.slice(i, i + 500)).select('id')
    if (error) return { ok: false, message: friendly(error.message) }
    added += data?.length ?? 0
  }
  return { ok: true, data: { added, skipped } }
}

/** The area and every area inside it (for "add the area's equipment"). */
export function areaAndInner(areaId: string, options: AreaOption[]): Set<string> {
  const out = new Set<string>([areaId])
  let grew = true
  while (grew) {
    grew = false
    for (const a of options) if (a.parent_area_id && out.has(a.parent_area_id) && !out.has(a.id)) { out.add(a.id); grew = true }
  }
  return out
}

// ── Equipment on a job ────────────────────────────────────────────────────────

export async function listJobEquipment(supabase: SupabaseClient, companyId: string, jobId: string): Promise<Result<JobEquipment[]>> {
  const { data, error } = await supabase.from('job_assets')
    .select(`id, asset_id, status, notes, done_at, asset:asset_id(${EQUIPMENT_COLUMNS})`)
    .eq('company_id', companyId).eq('job_id', jobId).order('created_at')
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []) as unknown as JobEquipment[] }
}

export async function addJobEquipment(
  supabase: SupabaseClient, companyId: string, jobId: string, assetIds: string[],
): Promise<Result<number>> {
  const ids = [...new Set(assetIds)]
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.from('job_assets')
    .upsert(ids.map(asset_id => ({ company_id: companyId, job_id: jobId, asset_id })), { onConflict: 'job_id,asset_id', ignoreDuplicates: true })
    .select('id')
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: data?.length ?? 0 }
}

export async function setJobEquipment(
  supabase: SupabaseClient, companyId: string, id: string, patch: { status?: JobEquipmentStatus; notes?: string | null },
): Promise<Result<void>> {
  const update: Record<string, unknown> = {}
  if (patch.status) update.status = patch.status
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null
  const { error } = await supabase.from('job_assets').update(update).eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export async function removeJobEquipment(supabase: SupabaseClient, companyId: string, id: string): Promise<Result<void>> {
  const { error } = await supabase.from('job_assets').delete().eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

/** Every job a unit was on, newest first. */
export async function equipmentHistory(supabase: SupabaseClient, companyId: string, assetId: string): Promise<Result<EquipmentHistoryRow[]>> {
  const { data, error } = await supabase.from('job_assets')
    .select('id, status, notes, done_at, created_at, job:job_id(id, job_code, title, status, scheduled_start, service:service_id(name))')
    .eq('company_id', companyId).eq('asset_id', assetId)
    .order('created_at', { ascending: false }).limit(200)
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []) as unknown as EquipmentHistoryRow[] }
}

// ── Technician (code login) ───────────────────────────────────────────────────

export type WorkerEquipmentRow = {
  id: string
  asset_id: string
  label: string | null
  asset_type: string
  manufacturer: string | null
  model_number: string | null
  capacity: string | null
  quantity: number
  area_name: string | null
  status: JobEquipmentStatus
  notes: string | null
  done_at: string | null
}

export async function workerJobEquipment(
  supabase: SupabaseClient, companyId: string, employeeId: string, jobId: string, sessionToken: string | null,
): Promise<Result<WorkerEquipmentRow[]>> {
  const { data, error } = await supabase.rpc('employee_get_job_equipment', {
    p_company_id: companyId, p_employee_id: employeeId, p_job_id: jobId, p_session_token: sessionToken,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []) as WorkerEquipmentRow[] }
}

export async function workerSetEquipment(
  supabase: SupabaseClient, companyId: string, employeeId: string, jobAssetId: string,
  status: JobEquipmentStatus, notes: string | null, sessionToken: string | null,
): Promise<Result<void>> {
  const { error } = await supabase.rpc('employee_set_job_equipment_status', {
    p_company_id: companyId, p_employee_id: employeeId, p_job_asset_id: jobAssetId,
    p_status: status, p_notes: notes, p_session_token: sessionToken,
  })
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export type WorkerJobWhere = { area_path: string | null; service_name: string | null; service_description: string | null }

export async function workerJobWhere(
  supabase: SupabaseClient, companyId: string, employeeId: string, jobId: string, sessionToken: string | null,
): Promise<Result<WorkerJobWhere | null>> {
  const { data, error } = await supabase.rpc('employee_get_job_where', {
    p_company_id: companyId, p_employee_id: employeeId, p_job_id: jobId, p_session_token: sessionToken,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  const row = Array.isArray(data) ? data[0] : data
  return { ok: true, data: (row ?? null) as WorkerJobWhere | null }
}
