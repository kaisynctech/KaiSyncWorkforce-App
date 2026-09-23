/**
 * B&B / guest-house channel sync foundations (Wave G1).
 * Connections + room mappings + external booking identity helpers.
 * Live OTA / iCal pull is a later wave — this prepares the data model.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { findConflictingStay } from '@/lib/property-stays'
import type {
  ChannelProvider,
  PropertyChannelConnection,
  PropertyStay,
  PropertyUnitChannelMapping,
  StayBookingSource,
  StayStatus,
  StaySyncStatus,
} from '@/types/database'

export const CHANNEL_PROVIDERS: { value: ChannelProvider; label: string }[] = [
  { value: 'manual', label: 'Manual / placeholder' },
  { value: 'ical', label: 'iCal calendar' },
  { value: 'channex', label: 'Channex' },
  { value: 'siteminder', label: 'SiteMinder' },
  { value: 'cloudbeds', label: 'Cloudbeds' },
  { value: 'other', label: 'Other channel manager' },
]

export const BOOKING_SOURCES: { value: StayBookingSource; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'phone', label: 'Phone' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'ical', label: 'iCal' },
  { value: 'booking_com', label: 'Booking.com' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'expedia', label: 'Expedia' },
  { value: 'channel_manager', label: 'Channel manager' },
  { value: 'other', label: 'Other' },
]

export function channelProviderLabel(v: string | null | undefined): string {
  return CHANNEL_PROVIDERS.find(p => p.value === v)?.label ?? (v || '—')
}

export function bookingSourceLabel(v: string | null | undefined): string {
  return BOOKING_SOURCES.find(s => s.value === v)?.label ?? (v || 'Manual')
}

export type ChannelResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export async function listChannelConnections(
  supabase: SupabaseClient,
  opts: { companyId: string; siteId: string },
): Promise<ChannelResult<PropertyChannelConnection[]>> {
  const { data, error } = await supabase
    .from('property_channel_connections')
    .select('*')
    .eq('company_id', opts.companyId)
    .eq('site_id', opts.siteId)
    .order('display_name')
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data ?? []) as PropertyChannelConnection[] }
}

export async function createChannelConnection(
  supabase: SupabaseClient,
  input: {
    companyId: string
    siteId: string
    employeeId?: string | null
    provider: ChannelProvider
    displayName: string
    icalImportUrl?: string | null
    externalPropertyId?: string | null
  },
): Promise<ChannelResult<PropertyChannelConnection>> {
  const name = input.displayName.trim()
  if (!name) return { ok: false, message: 'Connection name is required.' }

  const { data, error } = await supabase
    .from('property_channel_connections')
    .insert({
      company_id: input.companyId,
      site_id: input.siteId,
      provider: input.provider,
      display_name: name,
      ical_import_url: input.icalImportUrl?.trim() || null,
      external_property_id: input.externalPropertyId?.trim() || null,
      created_by: input.employeeId ?? null,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Failed to create connection' }
  return { ok: true, data: data as PropertyChannelConnection }
}

export async function updateChannelConnection(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    connectionId: string
    patch: Partial<{
      display_name: string
      provider: ChannelProvider
      is_active: boolean
      ical_import_url: string | null
      external_property_id: string | null
    }>
  },
): Promise<ChannelResult<PropertyChannelConnection>> {
  const { data, error } = await supabase
    .from('property_channel_connections')
    .update({ ...opts.patch, updated_at: new Date().toISOString() })
    .eq('id', opts.connectionId)
    .eq('company_id', opts.companyId)
    .select('*')
    .single()
  if (error || !data) return { ok: false, message: error?.message ?? 'Failed to update connection' }
  return { ok: true, data: data as PropertyChannelConnection }
}

export async function listUnitChannelMappings(
  supabase: SupabaseClient,
  opts: { companyId: string; connectionId: string },
): Promise<ChannelResult<PropertyUnitChannelMapping[]>> {
  const { data, error } = await supabase
    .from('property_unit_channel_mappings')
    .select('*, units(id, unit_number)')
    .eq('company_id', opts.companyId)
    .eq('connection_id', opts.connectionId)
    .order('external_room_id')
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: (data ?? []) as PropertyUnitChannelMapping[] }
}

export async function upsertUnitChannelMapping(
  supabase: SupabaseClient,
  input: {
    companyId: string
    connectionId: string
    unitId: string
    externalRoomId: string
    externalRoomName?: string | null
  },
): Promise<ChannelResult<PropertyUnitChannelMapping>> {
  const roomId = input.externalRoomId.trim()
  if (!roomId) return { ok: false, message: 'External room id is required.' }

  const { data: existing } = await supabase
    .from('property_unit_channel_mappings')
    .select('id')
    .eq('connection_id', input.connectionId)
    .eq('unit_id', input.unitId)
    .maybeSingle()

  if (existing?.id) {
    const { data, error } = await supabase
      .from('property_unit_channel_mappings')
      .update({
        external_room_id: roomId,
        external_room_name: input.externalRoomName?.trim() || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('company_id', input.companyId)
      .select('*, units(id, unit_number)')
      .single()
    if (error || !data) return { ok: false, message: error?.message ?? 'Failed to update mapping' }
    return { ok: true, data: data as PropertyUnitChannelMapping }
  }

  const { data, error } = await supabase
    .from('property_unit_channel_mappings')
    .insert({
      company_id: input.companyId,
      connection_id: input.connectionId,
      unit_id: input.unitId,
      external_room_id: roomId,
      external_room_name: input.externalRoomName?.trim() || null,
    })
    .select('*, units(id, unit_number)')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Failed to create mapping' }
  return { ok: true, data: data as PropertyUnitChannelMapping }
}

export async function deleteUnitChannelMapping(
  supabase: SupabaseClient,
  opts: { companyId: string; mappingId: string },
): Promise<ChannelResult<true>> {
  const { error } = await supabase
    .from('property_unit_channel_mappings')
    .delete()
    .eq('id', opts.mappingId)
    .eq('company_id', opts.companyId)
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: true }
}

export type ExternalStayUpsertInput = {
  companyId: string
  siteId: string
  connectionId: string
  externalBookingId: string
  unitId: string
  guestName: string
  guestSurname?: string
  guestPhone?: string | null
  guestEmail?: string | null
  checkInDate: string
  checkOutDate: string
  bookingSource?: StayBookingSource
  externalStatus?: string | null
  nightlyRate?: number | null
  totalAmount?: number | null
  currency?: string
  notes?: string | null
  payload?: Record<string, unknown> | null
  status?: StayStatus
}

/**
 * Idempotent create/update of a stay from an external channel booking id.
 * Ready for iCal / channel-manager importers (G2+).
 */
export async function upsertStayFromExternalBooking(
  supabase: SupabaseClient,
  input: ExternalStayUpsertInput,
): Promise<ChannelResult<{ stay: PropertyStay; created: boolean }>> {
  const externalId = input.externalBookingId.trim()
  if (!externalId) return { ok: false, message: 'external_booking_id is required.' }
  if (!input.guestName.trim()) return { ok: false, message: 'Guest name is required.' }
  if (input.checkOutDate <= input.checkInDate) {
    return { ok: false, message: 'Check-out must be after check-in.' }
  }

  const { data: existing } = await supabase
    .from('property_stays')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('channel_connection_id', input.connectionId)
    .eq('external_booking_id', externalId)
    .maybeSingle()

  const syncFields = {
    booking_source: input.bookingSource ?? 'channel_manager',
    channel_connection_id: input.connectionId,
    external_booking_id: externalId,
    external_status: input.externalStatus ?? null,
    sync_status: 'synced' as StaySyncStatus,
    last_synced_at: new Date().toISOString(),
    external_payload: input.payload ?? null,
  }

  if (existing) {
    const conflict = await findConflictingStay(supabase, {
      companyId: input.companyId,
      unitId: input.unitId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      excludeStayId: existing.id,
    })
    if (conflict) {
      return { ok: false, message: `Room conflict with stay ${conflict.id.slice(0, 8)}` }
    }

    const { data, error } = await supabase
      .from('property_stays')
      .update({
        unit_id: input.unitId,
        guest_name: input.guestName.trim(),
        guest_surname: (input.guestSurname ?? '').trim(),
        guest_phone: input.guestPhone?.trim() || null,
        guest_email: input.guestEmail?.trim() || null,
        check_in_date: input.checkInDate,
        check_out_date: input.checkOutDate,
        status: input.status ?? (existing as PropertyStay).status,
        nightly_rate: input.nightlyRate ?? null,
        total_amount: input.totalAmount ?? null,
        currency: input.currency ?? 'ZAR',
        notes: input.notes?.trim() || null,
        ...syncFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('company_id', input.companyId)
      .select('*')
      .single()

    if (error || !data) return { ok: false, message: error?.message ?? 'Failed to update external stay' }
    return { ok: true, data: { stay: data as PropertyStay, created: false } }
  }

  const conflict = await findConflictingStay(supabase, {
    companyId: input.companyId,
    unitId: input.unitId,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
  })
  if (conflict) {
    return { ok: false, message: `Room conflict with stay ${conflict.id.slice(0, 8)}` }
  }

  const { data, error } = await supabase
    .from('property_stays')
    .insert({
      company_id: input.companyId,
      site_id: input.siteId,
      unit_id: input.unitId,
      guest_name: input.guestName.trim(),
      guest_surname: (input.guestSurname ?? '').trim(),
      guest_phone: input.guestPhone?.trim() || null,
      guest_email: input.guestEmail?.trim() || null,
      check_in_date: input.checkInDate,
      check_out_date: input.checkOutDate,
      status: input.status ?? 'reserved',
      adults: 1,
      children: 0,
      nightly_rate: input.nightlyRate ?? null,
      total_amount: input.totalAmount ?? null,
      currency: input.currency ?? 'ZAR',
      notes: input.notes?.trim() || null,
      ...syncFields,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? 'Failed to create external stay' }
  return { ok: true, data: { stay: data as PropertyStay, created: true } }
}
