/**
 * Property / unit maintenance — jobs linked to sites & units,
 * with optional light (trade) contractors.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createContractor } from '@/lib/contractors'
import { createJob } from '@/lib/jobs'
import type { JobStatus } from '@/types/database'

export type MaintenanceJobRow = {
  id: string
  title: string
  description: string | null
  status: string
  job_code: string | null
  site_id: string | null
  unit_id: string | null
  contractor_id: string | null
  actual_cost: number | null
  contractor_cost: number | null
  estimated_cost: number | null
  created_at: string
  closed_at: string | null
  contractors?: { id: string; name: string; phone: string | null; profile_tier?: string | null } | null
  units?: { id: string; unit_number: string } | null
}

export type LightContractorInput = {
  companyId: string
  name: string
  phone?: string | null
  /** e.g. glass, plumbing — stored in notes */
  trade?: string | null
}

export async function createLightContractor(
  supabase: SupabaseClient,
  input: LightContractorInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, message: 'Contractor name is required.' }

  const trade = input.trade?.trim()
  const notes = trade ? `Trade: ${trade}` : 'Light trade contact (property maintenance)'

  const created = await createContractor(supabase, {
    companyId: input.companyId,
    name,
    phone: input.phone?.trim() || null,
    notes,
    partnerKind: 'contractor',
    profileTier: 'light',
    preferredPaymentMethod: 'cash',
    paymentTerms: 'immediate',
    isVatRegistered: false,
  })

  if (!created.ok) return created
  return { ok: true, id: created.data.id }
}

export type LogPropertyWorkInput = {
  companyId: string
  employeeId: string | null
  siteId: string
  unitId?: string | null
  title: string
  description?: string | null
  /** Cost paid / agreed */
  cost?: number | null
  /** Existing contractor */
  contractorId?: string | null
  /** Or create light contractor inline */
  newContractor?: { name: string; phone?: string; trade?: string } | null
  /** done = completed today; open = scheduled/open work */
  done?: boolean
}

export async function logPropertyWork(
  supabase: SupabaseClient,
  input: LogPropertyWorkInput,
): Promise<{ ok: true; jobId: string; contractorId: string | null } | { ok: false; message: string }> {
  const title = input.title.trim()
  if (!title) return { ok: false, message: 'Describe the work (title) first.' }

  let contractorId = input.contractorId || null
  if (!contractorId && input.newContractor?.name.trim()) {
    const light = await createLightContractor(supabase, {
      companyId: input.companyId,
      name: input.newContractor.name,
      phone: input.newContractor.phone,
      trade: input.newContractor.trade,
    })
    if (!light.ok) return light
    contractorId = light.id
  }

  const cost = input.cost != null && Number.isFinite(input.cost) ? input.cost : null
  const done = input.done !== false
  const status: JobStatus = done ? 'completed' : 'open'
  const now = new Date().toISOString()

  const created = await createJob(supabase, {
    companyId: input.companyId,
    title,
    description: input.description?.trim() || null,
    siteId: input.siteId,
    unitId: input.unitId || null,
    contractorId,
    actualCost: cost,
    contractorCost: contractorId ? cost : null,
    estimatedCost: cost,
    createdByEmployeeId: input.employeeId,
    status,
    priority: 'medium',
    assignCode: true,
  })

  if (!created.ok) return created

  // Stamp closed_at when marked done (create payload may not set it)
  if (done) {
    await supabase
      .from('jobs')
      .update({ closed_at: now, status: 'completed' })
      .eq('id', created.data.id)
      .eq('company_id', input.companyId)
  }

  return { ok: true, jobId: created.data.id, contractorId }
}

export async function listPropertyMaintenanceJobs(
  supabase: SupabaseClient,
  opts: { companyId: string; siteId: string; unitId?: string | null; limit?: number },
): Promise<{ ok: true; data: MaintenanceJobRow[] } | { ok: false; message: string }> {
  let q = supabase
    .from('jobs')
    .select('id, title, description, status, job_code, site_id, unit_id, contractor_id, actual_cost, contractor_cost, estimated_cost, created_at, closed_at, contractors(id, name, phone, profile_tier), units(id, unit_number)')
    .eq('company_id', opts.companyId)
    .eq('site_id', opts.siteId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)

  if (opts.unitId) {
    q = q.eq('unit_id', opts.unitId)
  }

  const { data, error } = await q
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data ?? []) as unknown as MaintenanceJobRow[] }
}
