/**
 * Short-stay (B&B / guest house) booking helpers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  HousekeepingStatus,
  PropertyStay,
  StayDepositStatus,
  StayStatus,
} from '@/types/database'

export const STAY_STATUSES: { value: StayStatus; label: string }[] = [
  { value: 'reserved', label: 'Reserved' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'checked_out', label: 'Checked out' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No show' },
]

export const HOUSEKEEPING_STATUSES: { value: HousekeepingStatus; label: string }[] = [
  { value: 'clean', label: 'Clean' },
  { value: 'dirty', label: 'Dirty' },
  { value: 'inspected', label: 'Inspected' },
  { value: 'out_of_order', label: 'Out of order' },
]

export const STAY_DEPOSIT_STATUSES: { value: StayDepositStatus; label: string }[] = [
  { value: 'none', label: 'No deposit' },
  { value: 'due', label: 'Due' },
  { value: 'paid', label: 'Paid' },
  { value: 'held', label: 'Held' },
  { value: 'refunded', label: 'Refunded' },
]

export function stayStatusLabel(v: string | null | undefined): string {
  return STAY_STATUSES.find(s => s.value === v)?.label ?? (v || '—')
}

export function housekeepingLabel(v: string | null | undefined): string {
  return HOUSEKEEPING_STATUSES.find(s => s.value === v)?.label ?? (v || 'Clean')
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn + 'T00:00:00')
  const b = new Date(checkOut + 'T00:00:00')
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  return Math.max(days, 0)
}

export type StayCreateInput = {
  companyId: string
  siteId: string
  unitId: string
  employeeId?: string | null
  guestName: string
  guestSurname?: string
  guestPhone?: string | null
  guestEmail?: string | null
  idNumber?: string | null
  passportNumber?: string | null
  checkInDate: string
  checkOutDate: string
  adults?: number
  children?: number
  nightlyRate?: number | null
  depositAmount?: number | null
  depositStatus?: StayDepositStatus
  notes?: string | null
  /** If true, create as checked_in immediately */
  checkInNow?: boolean
}

export type StayResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

const ACTIVE_STATUSES: StayStatus[] = ['reserved', 'checked_in']

/** True if date ranges overlap (checkout day frees the room at start of day). */
export function datesOverlap(
  aIn: string,
  aOut: string,
  bIn: string,
  bOut: string,
): boolean {
  return aIn < bOut && bIn < aOut
}

export async function findConflictingStay(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    unitId: string
    checkInDate: string
    checkOutDate: string
    excludeStayId?: string
  },
): Promise<PropertyStay | null> {
  let q = supabase
    .from('property_stays')
    .select('*')
    .eq('company_id', opts.companyId)
    .eq('unit_id', opts.unitId)
    .in('status', ACTIVE_STATUSES)

  if (opts.excludeStayId) q = q.neq('id', opts.excludeStayId)

  const { data, error } = await q
  if (error || !data) return null

  for (const row of data as PropertyStay[]) {
    if (datesOverlap(opts.checkInDate, opts.checkOutDate, row.check_in_date, row.check_out_date)) {
      return row
    }
  }
  return null
}

export async function createStay(
  supabase: SupabaseClient,
  input: StayCreateInput,
): Promise<StayResult<PropertyStay>> {
  const guestName = input.guestName.trim()
  if (!guestName) return { ok: false, message: 'Guest first name is required.' }
  if (!input.checkInDate || !input.checkOutDate) {
    return { ok: false, message: 'Check-in and check-out dates are required.' }
  }
  if (input.checkOutDate < input.checkInDate) {
    return { ok: false, message: 'Check-out must be on or after check-in.' }
  }

  const conflict = await findConflictingStay(supabase, {
    companyId: input.companyId,
    unitId: input.unitId,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
  })
  if (conflict) {
    return {
      ok: false,
      message: `Room already has a ${conflict.status.replace(/_/g, ' ')} stay overlapping these dates (${conflict.guest_name} ${conflict.guest_surname}).`,
    }
  }

  const nights = nightsBetween(input.checkInDate, input.checkOutDate)
  const rate = input.nightlyRate != null && Number.isFinite(input.nightlyRate) ? input.nightlyRate : null
  const total = rate != null ? rate * Math.max(nights, 1) : null
  const deposit = input.depositAmount != null && Number.isFinite(input.depositAmount) ? input.depositAmount : null
  let depositStatus: StayDepositStatus = input.depositStatus ?? 'none'
  if (deposit != null && deposit > 0 && depositStatus === 'none') depositStatus = 'due'

  const checkInNow = !!input.checkInNow
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('property_stays')
    .insert({
      company_id: input.companyId,
      site_id: input.siteId,
      unit_id: input.unitId,
      guest_name: guestName,
      guest_surname: (input.guestSurname ?? '').trim(),
      guest_phone: input.guestPhone?.trim() || null,
      guest_email: input.guestEmail?.trim() || null,
      id_number: input.idNumber?.trim() || null,
      passport_number: input.passportNumber?.trim() || null,
      check_in_date: input.checkInDate,
      check_out_date: input.checkOutDate,
      check_in_at: checkInNow ? now : null,
      status: checkInNow ? 'checked_in' : 'reserved',
      adults: Math.min(20, Math.max(1, input.adults ?? 1)),
      children: Math.min(20, Math.max(0, input.children ?? 0)),
      nightly_rate: rate,
      total_amount: total,
      deposit_amount: deposit,
      deposit_status: depositStatus,
      currency: 'ZAR',
      notes: input.notes?.trim() || null,
      created_by: input.employeeId || null,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Failed to create stay' }

  if (checkInNow) {
    await supabase
      .from('units')
      .update({ is_occupied: true, housekeeping_status: 'dirty' })
      .eq('id', input.unitId)
      .eq('company_id', input.companyId)
  }

  return { ok: true, data: data as PropertyStay }
}

export async function checkInStay(
  supabase: SupabaseClient,
  opts: { companyId: string; stayId: string },
): Promise<StayResult<PropertyStay>> {
  const { data: stay, error: loadErr } = await supabase
    .from('property_stays')
    .select('*')
    .eq('id', opts.stayId)
    .eq('company_id', opts.companyId)
    .maybeSingle()

  if (loadErr || !stay) return { ok: false, message: loadErr?.message ?? 'Stay not found' }
  const row = stay as PropertyStay
  if (row.status !== 'reserved') {
    return { ok: false, message: `Cannot check in a stay that is ${row.status.replace(/_/g, ' ')}.` }
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('property_stays')
    .update({
      status: 'checked_in',
      check_in_at: now,
      updated_at: now,
    })
    .eq('id', opts.stayId)
    .eq('company_id', opts.companyId)
    .select('*')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Check-in failed' }

  await supabase
    .from('units')
    .update({ is_occupied: true, housekeeping_status: 'dirty' })
    .eq('id', row.unit_id)
    .eq('company_id', opts.companyId)

  return { ok: true, data: data as PropertyStay }
}

export async function checkOutStay(
  supabase: SupabaseClient,
  opts: { companyId: string; stayId: string },
): Promise<StayResult<PropertyStay>> {
  const { data: stay, error: loadErr } = await supabase
    .from('property_stays')
    .select('*')
    .eq('id', opts.stayId)
    .eq('company_id', opts.companyId)
    .maybeSingle()

  if (loadErr || !stay) return { ok: false, message: loadErr?.message ?? 'Stay not found' }
  const row = stay as PropertyStay
  if (row.status !== 'checked_in') {
    return { ok: false, message: `Cannot check out a stay that is ${row.status.replace(/_/g, ' ')}.` }
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('property_stays')
    .update({
      status: 'checked_out',
      check_out_at: now,
      updated_at: now,
    })
    .eq('id', opts.stayId)
    .eq('company_id', opts.companyId)
    .select('*')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Check-out failed' }

  // Room needs cleaning; free for new bookings after checkout date logic
  const { count } = await supabase
    .from('property_stays')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', row.unit_id)
    .eq('company_id', opts.companyId)
    .eq('status', 'checked_in')

  await supabase
    .from('units')
    .update({
      is_occupied: (count ?? 0) > 0,
      housekeeping_status: 'dirty',
    })
    .eq('id', row.unit_id)
    .eq('company_id', opts.companyId)

  return { ok: true, data: data as PropertyStay }
}

export async function setHousekeepingStatus(
  supabase: SupabaseClient,
  opts: { companyId: string; unitId: string; status: HousekeepingStatus },
): Promise<StayResult<void>> {
  const { error } = await supabase
    .from('units')
    .update({ housekeeping_status: opts.status })
    .eq('id', opts.unitId)
    .eq('company_id', opts.companyId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

export async function cancelStay(
  supabase: SupabaseClient,
  opts: { companyId: string; stayId: string; asNoShow?: boolean },
): Promise<StayResult<PropertyStay>> {
  const status: StayStatus = opts.asNoShow ? 'no_show' : 'cancelled'
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('property_stays')
    .update({ status, updated_at: now })
    .eq('id', opts.stayId)
    .eq('company_id', opts.companyId)
    .in('status', ['reserved', 'checked_in'])
    .select('*')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Cancel failed' }
  const row = data as PropertyStay

  if (row.status === 'cancelled' || row.status === 'no_show') {
    const { count } = await supabase
      .from('property_stays')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', row.unit_id)
      .eq('company_id', opts.companyId)
      .eq('status', 'checked_in')

    await supabase
      .from('units')
      .update({ is_occupied: (count ?? 0) > 0 })
      .eq('id', row.unit_id)
      .eq('company_id', opts.companyId)
  }

  return { ok: true, data: row }
}

export type RoomBoardRow = {
  unit: {
    id: string
    unit_number: string
    unit_type: string | null
    housekeeping_status: HousekeepingStatus
    is_occupied: boolean | null
    default_rent_amount?: number | null
  }
  currentStay: PropertyStay | null
  upcomingStay: PropertyStay | null
}

export function buildRoomBoard(
  units: RoomBoardRow['unit'][],
  stays: PropertyStay[],
  today = new Date().toISOString().slice(0, 10),
): RoomBoardRow[] {
  return units.map(unit => {
    const unitStays = stays.filter(s => s.unit_id === unit.id)
    const currentStay =
      unitStays.find(s => s.status === 'checked_in')
      ?? unitStays.find(s =>
        s.status === 'reserved'
        && s.check_in_date <= today
        && s.check_out_date > today,
      )
      ?? null
    const upcomingStay =
      unitStays
        .filter(s => s.status === 'reserved' && s.check_in_date > today && s.id !== currentStay?.id)
        .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))[0]
      ?? null
    return { unit, currentStay, upcomingStay }
  })
}
