/**
 * Job services (what is done), client service lists and areas inside client sites (where it is done).
 * Tables: job_services, client_job_services, site_areas; jobs.service_id / jobs.area_id / jobs.site_id.
 * Built for Winterstech (SAB Rosslyn: Brewhouse > Service Room, Minor / Major service, Breakdown) and every company.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

export type JobService = {
  id: string
  company_id: string
  name: string
  category: string | null
  description: string | null
  default_duration_minutes: number | null
  default_price: number | null
  checklist: string[]
  is_active: boolean
  sort_order: number
}

/** A service as offered to one client: the client's agreed price wins over the company price. */
export type OfferedService = JobService & { agreed_price: number | null; price: number | null; forClient: boolean }

export type ClientServiceRow = {
  id: string
  client_id: string
  service_id: string
  agreed_price: number | null
  notes: string | null
}

export type SiteRow = { id: string; name: string; client_id: string | null; address: string | null }

export type SiteArea = {
  id: string
  site_id: string
  parent_area_id: string | null
  name: string
  priority: number | null
  notes: string | null
  is_active: boolean
  sort_order: number
}

/** An area with its full path, e.g. "Brewhouse › Service Room", for dropdowns and lists. */
export type AreaOption = SiteArea & { path: string; depth: number }

const SERVICE_COLUMNS =
  'id, company_id, name, category, description, default_duration_minutes, default_price, checklist, is_active, sort_order'

function friendly(message: string): string {
  if (/job_services_company_name_key/.test(message)) return 'A service with that name already exists.'
  if (/site_areas_name_key/.test(message)) return 'That area already exists here.'
  if (/client_job_services_client_id_service_id_key/.test(message)) return 'That service is already on this client.'
  if (/row-level security|permission denied/i.test(message)) return 'You do not have permission to change this.'
  return message
}

function asService(row: Record<string, unknown>): JobService {
  const checklist = Array.isArray(row.checklist) ? (row.checklist as unknown[]).map(String).filter(Boolean) : []
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    name: String(row.name ?? ''),
    category: (row.category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    default_duration_minutes: row.default_duration_minutes == null ? null : Number(row.default_duration_minutes),
    default_price: row.default_price == null ? null : Number(row.default_price),
    checklist,
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 0),
  }
}

function byOrderThenName(a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name)
}

// ── Company service list ─────────────────────────────────────────────────────

export async function listJobServices(
  supabase: SupabaseClient,
  companyId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Result<JobService[]>> {
  let q = supabase.from('job_services').select(SERVICE_COLUMNS).eq('company_id', companyId)
  if (!opts.includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q.order('sort_order').order('name').limit(1000)
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []).map(r => asService(r as Record<string, unknown>)) }
}

export type JobServiceInput = {
  name: string
  category?: string | null
  description?: string | null
  defaultDurationMinutes?: number | null
  defaultPrice?: number | null
  checklist?: string[]
  isActive?: boolean
  sortOrder?: number
}

function servicePayload(input: JobServiceInput) {
  const name = input.name.trim()
  if (!name) throw new Error('Service name is required.')
  return {
    name,
    category: input.category?.trim() || null,
    description: input.description?.trim() || null,
    default_duration_minutes: input.defaultDurationMinutes ?? null,
    default_price: input.defaultPrice ?? null,
    checklist: (input.checklist ?? []).map(s => s.trim()).filter(Boolean),
    ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
    ...(input.sortOrder === undefined ? {} : { sort_order: input.sortOrder }),
  }
}

export async function saveJobService(
  supabase: SupabaseClient,
  companyId: string,
  input: JobServiceInput,
  id?: string,
): Promise<Result<JobService>> {
  let payload
  try { payload = servicePayload(input) } catch (e) { return { ok: false, message: (e as Error).message } }
  const q = id
    ? supabase.from('job_services').update(payload).eq('id', id).eq('company_id', companyId)
    : supabase.from('job_services').insert({ ...payload, company_id: companyId })
  const { data, error } = await q.select(SERVICE_COLUMNS).single()
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: asService(data as Record<string, unknown>) }
}

export async function setJobServiceActive(
  supabase: SupabaseClient, companyId: string, id: string, isActive: boolean,
): Promise<Result<void>> {
  const { error } = await supabase.from('job_services').update({ is_active: isActive }).eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

/** Removes a service. Jobs that used it keep their history but lose the link (the job title stays). */
export async function deleteJobService(supabase: SupabaseClient, companyId: string, id: string): Promise<Result<void>> {
  const { error } = await supabase.from('job_services').delete().eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

// ── Client service list ──────────────────────────────────────────────────────

export async function listClientServices(
  supabase: SupabaseClient, companyId: string, clientId: string,
): Promise<Result<ClientServiceRow[]>> {
  const { data, error } = await supabase
    .from('client_job_services')
    .select('id, client_id, service_id, agreed_price, notes')
    .eq('company_id', companyId)
    .eq('client_id', clientId)
  if (error) return { ok: false, message: friendly(error.message) }
  return {
    ok: true,
    data: (data ?? []).map(r => ({
      ...(r as ClientServiceRow),
      agreed_price: (r as { agreed_price: number | null }).agreed_price == null ? null : Number((r as { agreed_price: number }).agreed_price),
    })),
  }
}

export async function addClientService(
  supabase: SupabaseClient, companyId: string, clientId: string, serviceId: string, agreedPrice: number | null,
): Promise<Result<void>> {
  const { error } = await supabase.from('client_job_services').insert({
    company_id: companyId, client_id: clientId, service_id: serviceId, agreed_price: agreedPrice,
  })
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export async function updateClientServicePrice(
  supabase: SupabaseClient, companyId: string, rowId: string, agreedPrice: number | null,
): Promise<Result<void>> {
  const { error } = await supabase.from('client_job_services').update({ agreed_price: agreedPrice }).eq('id', rowId).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export async function removeClientService(supabase: SupabaseClient, companyId: string, rowId: string): Promise<Result<void>> {
  const { error } = await supabase.from('client_job_services').delete().eq('id', rowId).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

/**
 * The services to offer for a job. A client with its own list sees only those (with their agreed
 * price); a client without one, or no client, sees the company's whole active list.
 */
export function servicesOffered(all: JobService[], clientRows: ClientServiceRow[]): OfferedService[] {
  const active = all.filter(s => s.is_active)
  if (clientRows.length === 0) {
    return active.sort(byOrderThenName).map(s => ({ ...s, agreed_price: null, price: s.default_price, forClient: false }))
  }
  const byService = new Map(clientRows.map(r => [r.service_id, r]))
  return active
    .filter(s => byService.has(s.id))
    .sort(byOrderThenName)
    .map(s => {
      const agreed = byService.get(s.id)?.agreed_price ?? null
      return { ...s, agreed_price: agreed, price: agreed ?? s.default_price, forClient: true }
    })
}

// ── Sites and areas ──────────────────────────────────────────────────────────

export async function listClientSites(
  supabase: SupabaseClient, companyId: string, clientId: string,
): Promise<Result<SiteRow[]>> {
  const { data, error } = await supabase
    .from('sites').select('id, name, client_id, address')
    .eq('company_id', companyId).eq('client_id', clientId).order('name')
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: (data ?? []) as SiteRow[] }
}

export async function addClientSite(
  supabase: SupabaseClient, companyId: string, clientId: string, name: string,
): Promise<Result<SiteRow>> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, message: 'Site name is required.' }
  const { data, error } = await supabase
    .from('sites').insert({ company_id: companyId, client_id: clientId, name: trimmed })
    .select('id, name, client_id, address').single()
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: data as SiteRow }
}

export async function listSiteAreas(
  supabase: SupabaseClient, companyId: string, siteIds: string[], opts: { includeInactive?: boolean } = {},
): Promise<Result<SiteArea[]>> {
  if (siteIds.length === 0) return { ok: true, data: [] }
  const rows: SiteArea[] = []
  for (let i = 0; i < siteIds.length; i += 100) {
    let q = supabase
      .from('site_areas')
      .select('id, site_id, parent_area_id, name, priority, notes, is_active, sort_order')
      .eq('company_id', companyId)
      .in('site_id', siteIds.slice(i, i + 100))
    if (!opts.includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q.order('sort_order').order('name').limit(5000)
    if (error) return { ok: false, message: friendly(error.message) }
    rows.push(...((data ?? []) as SiteArea[]))
  }
  return { ok: true, data: rows }
}

/** Areas in tree order with their full path ("Brewhouse › Service Room"). */
export function areaOptions(areas: SiteArea[]): AreaOption[] {
  const children = new Map<string | null, SiteArea[]>()
  const ids = new Set(areas.map(a => a.id))
  for (const a of areas) {
    const parent = a.parent_area_id && ids.has(a.parent_area_id) ? a.parent_area_id : null
    const list = children.get(parent) ?? []
    list.push(a)
    children.set(parent, list)
  }
  for (const list of children.values()) list.sort(byOrderThenName)
  const out: AreaOption[] = []
  const walk = (parent: string | null, prefix: string, depth: number, seen: Set<string>) => {
    for (const a of children.get(parent) ?? []) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      const path = prefix ? `${prefix} › ${a.name}` : a.name
      out.push({ ...a, path, depth })
      walk(a.id, path, depth + 1, seen)
    }
  }
  walk(null, '', 0, new Set())
  return out
}

export async function addSiteArea(
  supabase: SupabaseClient,
  companyId: string,
  input: { siteId: string; name: string; parentAreaId?: string | null; priority?: number | null; notes?: string | null },
): Promise<Result<SiteArea>> {
  const name = input.name.trim()
  if (!name) return { ok: false, message: 'Area name is required.' }
  const { data, error } = await supabase
    .from('site_areas')
    .insert({
      company_id: companyId,
      site_id: input.siteId,
      parent_area_id: input.parentAreaId || null,
      name,
      priority: input.priority ?? null,
      notes: input.notes?.trim() || null,
    })
    .select('id, site_id, parent_area_id, name, priority, notes, is_active, sort_order')
    .single()
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: data as SiteArea }
}

export async function updateSiteArea(
  supabase: SupabaseClient,
  companyId: string,
  id: string,
  patch: { name?: string; priority?: number | null; notes?: string | null; isActive?: boolean },
): Promise<Result<void>> {
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { ok: false, message: 'Area name is required.' }
    update.name = patch.name.trim()
  }
  if (patch.priority !== undefined) update.priority = patch.priority
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null
  if (patch.isActive !== undefined) update.is_active = patch.isActive
  const { error } = await supabase.from('site_areas').update(update).eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

/** Removes an area and the areas inside it. Jobs keep their history but lose the area link. */
export async function deleteSiteArea(supabase: SupabaseClient, companyId: string, id: string): Promise<Result<void>> {
  const { error } = await supabase.from('site_areas').delete().eq('id', id).eq('company_id', companyId)
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

// ── Import areas from a sheet ────────────────────────────────────────────────

export type AreaImportRow = { area: string; subArea: string; priority: number | null }

const SKIP_ROW = /^(client signature|client name|technician|month of service|service completed|next service due|incomplete|total|summary)\b/i
const AREA_HEADER = /^(area|areas|location|locations|building|department)$/
const SUB_HEADER = /^(sub[- ]?areas?|rooms?|sub[- ]?locations?|spaces?|offices?)$/

function cleanCell(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** "a) Service Room" -> "Service Room" */
function stripListMarker(name: string): string {
  return name.replace(/^[a-z0-9]{1,3}[).]\s+/i, '').trim()
}

function priorityOf(raw: string): number | null {
  const v = raw.toLowerCase()
  const m = v.match(/\d+/)
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }
  const p = m ? Number(m[0]) : (Object.entries(words).find(([w]) => v.startsWith(w))?.[1] ?? null)
  return p != null && p >= 1 && p <= 9 ? p : null
}

/**
 * Reads areas from a sheet. Two layouts work:
 *  - columns "Area", optional "Sub-area" (or "Room"), optional "Priority" (1, 2, 3 or "First");
 *  - a schedule like the SAB one: an "Areas" column where a row with only a name in capitals
 *    (BREWHOUSE) starts a group and the rows under it ("a) Service Room") are areas inside it.
 * Repeated header rows and sign-off rows (Client signature, Technician) are ignored.
 */
export function parseAreaRows(rows: unknown[][]): { rows: AreaImportRow[]; problems: string[] } {
  const problems: string[] = []
  const headerIndex = rows.findIndex(r => r.some(c => AREA_HEADER.test(cleanCell(c).toLowerCase())))
  if (headerIndex < 0) return { rows: [], problems: ['Add a header row with an "Area" column.'] }
  const header = rows[headerIndex].map(c => cleanCell(c).toLowerCase())
  const areaCol = header.findIndex(h => AREA_HEADER.test(h))
  const subCol = header.findIndex(h => SUB_HEADER.test(h))
  const prioCol = header.findIndex(h => h === 'priority')
  const out: AreaImportRow[] = []
  const seen = new Set<string>()
  const push = (row: AreaImportRow) => {
    const k = `${row.area.toLowerCase()}|${row.subArea.toLowerCase()}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(row)
  }
  let group = ''
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const cells = r.map(cleanCell)
    const first = cells[areaCol] ?? ''
    if (cells.every(c => !c)) return
    if (AREA_HEADER.test(first.toLowerCase())) return // header repeated on the next page
    if (SKIP_ROW.test(first) || (!first && cells.some(c => SKIP_ROW.test(c)))) return
    const priority = prioCol >= 0 ? priorityOf(cells[prioCol] ?? '') : null
    if (subCol >= 0) {
      const area = stripListMarker(first)
      const subArea = stripListMarker(cells[subCol] ?? '')
      if (!area && !subArea) return
      if (!area) { problems.push(`Row ${headerIndex + i + 2}: "${subArea}" has no area.`); return }
      push({ area, subArea, priority })
      return
    }
    if (!first) return
    const others = cells.filter((c, j) => j !== areaCol && c)
    const isGroup = others.length === 0 && first === first.toUpperCase() && /[A-Z]/.test(first)
    if (isGroup) {
      group = stripListMarker(first)
      push({ area: group, subArea: '', priority })
      return
    }
    const name = stripListMarker(first)
    if (group) push({ area: group, subArea: name, priority })
    else push({ area: name, subArea: '', priority })
  })
  if (out.length === 0) problems.push('No areas found under the header row.')
  return { rows: out, problems }
}

/**
 * Adds the areas that are not there yet (names match ignoring case and spaces), in two batches:
 * the top-level areas first, then the areas inside them. Returns how many were added and skipped.
 */
export async function importSiteAreas(
  supabase: SupabaseClient,
  companyId: string,
  siteId: string,
  rows: AreaImportRow[],
  existing: SiteArea[],
): Promise<Result<{ added: number; skipped: number }>> {
  const key = (parent: string | null, name: string) => `${parent ?? ''}|${name.trim().toLowerCase()}`
  const known = new Map(existing.filter(a => a.site_id === siteId).map(a => [key(a.parent_area_id, a.name), a.id]))
  const columns = 'id, site_id, parent_area_id, name, priority, notes, is_active, sort_order'
  let added = 0
  let skipped = 0

  // Top-level areas (each area name once; its priority from an area-only row).
  const topPriority = new Map<string, number | null>()
  const topNames = new Map<string, string>()
  for (const r of rows) {
    const k = key(null, r.area)
    if (!topNames.has(k)) topNames.set(k, r.area.trim())
    if (!r.subArea && r.priority != null) topPriority.set(k, r.priority)
  }
  const newTop = [...topNames.entries()].filter(([k]) => !known.has(k))
  skipped += rows.filter(r => !r.subArea && known.has(key(null, r.area))).length
  for (let i = 0; i < newTop.length; i += 500) {
    const part = newTop.slice(i, i + 500)
    const { data, error } = await supabase.from('site_areas').insert(part.map(([k, name], j) => ({
      company_id: companyId, site_id: siteId, name, priority: topPriority.get(k) ?? null, sort_order: i + j,
    }))).select(columns)
    if (error) return { ok: false, message: friendly(error.message) }
    for (const a of (data ?? []) as SiteArea[]) known.set(key(null, a.name), a.id)
    added += data?.length ?? 0
  }

  // Areas inside them.
  const inner: Record<string, unknown>[] = []
  const queued = new Set<string>()
  for (const r of rows) {
    if (!r.subArea) continue
    const parentId = known.get(key(null, r.area))
    if (!parentId) continue
    const k = key(parentId, r.subArea)
    if (known.has(k) || queued.has(k)) { skipped++; continue }
    queued.add(k)
    inner.push({ company_id: companyId, site_id: siteId, parent_area_id: parentId, name: r.subArea.trim(), priority: r.priority, sort_order: inner.length })
  }
  for (let i = 0; i < inner.length; i += 500) {
    const { data, error } = await supabase.from('site_areas').insert(inner.slice(i, i + 500)).select('id')
    if (error) return { ok: false, message: friendly(error.message) }
    added += data?.length ?? 0
  }
  return { ok: true, data: { added, skipped } }
}

/** Checklist steps for a new job from its service (one step per line). */
export async function addServiceChecklistToJob(
  supabase: SupabaseClient, companyId: string, jobId: string, steps: string[],
): Promise<Result<void>> {
  const items = steps.map(s => s.trim()).filter(Boolean)
  if (items.length === 0) return { ok: true, data: undefined }
  const { error } = await supabase.from('job_checklist_items').insert(
    items.map((description, i) => ({ company_id: companyId, job_id: jobId, description, is_checked: false, sort_order: i })),
  )
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null) return ''
  return `R ${value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
