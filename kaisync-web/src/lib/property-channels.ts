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
    icalImportUrl?: string | null
  },
): Promise<ChannelResult<PropertyUnitChannelMapping>> {
  const roomId = input.externalRoomId.trim()
  if (!roomId) return { ok: false, message: 'External room id is required.' }

  const icalUrl = input.icalImportUrl !== undefined
    ? (input.icalImportUrl?.trim() || null)
    : undefined

  const { data: existing } = await supabase
    .from('property_unit_channel_mappings')
    .select('id')
    .eq('connection_id', input.connectionId)
    .eq('unit_id', input.unitId)
    .maybeSingle()

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      external_room_id: roomId,
      external_room_name: input.externalRoomName?.trim() || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }
    if (icalUrl !== undefined) patch.ical_import_url = icalUrl

    const { data, error } = await supabase
      .from('property_unit_channel_mappings')
      .update(patch)
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
      ical_import_url: icalUrl ?? null,
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
    const current = existing as PropertyStay
    const conflict = await findConflictingStay(supabase, {
      companyId: input.companyId,
      unitId: input.unitId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      excludeStayId: current.id,
    })
    if (conflict) {
      return { ok: false, message: `Room conflict with stay ${conflict.id.slice(0, 8)}` }
    }

    // Front desk progress must survive a later calendar pull. A cancelled stay can
    // return to reserved when the event is still on the feed.
    const keepProgress = current.status === 'checked_in' || current.status === 'checked_out'
    const nextStatus = keepProgress ? current.status : (input.status ?? current.status)

    const { data, error } = await supabase
      .from('property_stays')
      .update({
        unit_id: input.unitId,
        guest_name: input.guestName.trim(),
        guest_surname: (input.guestSurname ?? '').trim(),
        guest_phone: input.guestPhone !== undefined
          ? (input.guestPhone?.trim() || null)
          : current.guest_phone,
        guest_email: input.guestEmail !== undefined
          ? (input.guestEmail?.trim() || null)
          : current.guest_email,
        check_in_date: input.checkInDate,
        check_out_date: input.checkOutDate,
        status: nextStatus,
        nightly_rate: input.nightlyRate !== undefined ? input.nightlyRate : current.nightly_rate,
        total_amount: input.totalAmount !== undefined ? input.totalAmount : current.total_amount,
        currency: input.currency ?? current.currency,
        notes: input.notes !== undefined ? (input.notes?.trim() || null) : current.notes,
        ...syncFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
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

export type IcalSyncResult = {
  connectionId: string
  roomsSynced: number
  created: number
  updated: number
  cancelled: number
  skipped: number
  errors: string[]
}

/**
 * Pull iCal feeds for a connection and upsert/cancel stays.
 * Per-room mapping URL wins; else connection.ical_import_url is used when exactly one active mapping exists,
 * or applied to each mapping that has no URL only if connection URL is set and there is one mapping.
 */
export async function syncIcalForConnection(
  supabase: SupabaseClient,
  opts: { companyId: string; connectionId: string },
): Promise<ChannelResult<IcalSyncResult>> {
  const { fetchIcalText, guestNameFromIcalSummary, parseIcalEvents } = await import('@/lib/ical')

  const { data: conn, error: cErr } = await supabase
    .from('property_channel_connections')
    .select('*')
    .eq('id', opts.connectionId)
    .eq('company_id', opts.companyId)
    .maybeSingle()

  if (cErr || !conn) {
    return { ok: false, message: cErr?.message ?? 'Connection not found' }
  }

  const connection = conn as PropertyChannelConnection
  await supabase
    .from('property_channel_connections')
    .update({ sync_status: 'syncing', last_sync_error: null, updated_at: new Date().toISOString() })
    .eq('id', connection.id)

  const mapRes = await listUnitChannelMappings(supabase, {
    companyId: opts.companyId,
    connectionId: connection.id,
  })
  if (!mapRes.ok) {
    await markConnectionError(supabase, connection.id, mapRes.message)
    return { ok: false, message: mapRes.message }
  }

  const activeMaps = mapRes.data.filter(m => m.is_active)
  const result: IcalSyncResult = {
    connectionId: connection.id,
    roomsSynced: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    skipped: 0,
    errors: [],
  }

  if (activeMaps.length === 0) {
    const msg = 'Add at least one room mapping before syncing iCal.'
    await markConnectionError(supabase, connection.id, msg)
    return { ok: false, message: msg }
  }

  const today = new Date().toISOString().slice(0, 10)
  const seenUidsByUnit = new Map<string, Set<string>>()

  for (const mapping of activeMaps) {
    const url = (mapping.ical_import_url?.trim()
      || (activeMaps.length === 1 ? connection.ical_import_url?.trim() : '')
      || '')
    if (!url) {
      result.skipped += 1
      result.errors.push(
        `Room ${mapping.units?.unit_number ?? mapping.unit_id.slice(0, 8)}: no iCal URL (set per-room or connection URL).`,
      )
      continue
    }

    const fetched = await fetchIcalText(url)
    if (!fetched.ok) {
      result.errors.push(`Room ${mapping.units?.unit_number ?? mapping.external_room_id}: ${fetched.message}`)
      continue
    }

    const events = parseIcalEvents(fetched.text)
    const uids = new Set<string>()
    seenUidsByUnit.set(mapping.unit_id, uids)
    result.roomsSynced += 1

    for (const ev of events) {
      // Skip past stays that already ended before today (keep history; don't churn)
      if (ev.endDate < today) {
        uids.add(ev.uid)
        continue
      }
      uids.add(ev.uid)
      const guest = guestNameFromIcalSummary(ev.summary)
      const upsert = await upsertStayFromExternalBooking(supabase, {
        companyId: opts.companyId,
        siteId: connection.site_id,
        connectionId: connection.id,
        externalBookingId: ev.uid,
        unitId: mapping.unit_id,
        guestName: guest.name,
        guestSurname: guest.surname,
        checkInDate: ev.startDate,
        checkOutDate: ev.endDate,
        bookingSource: 'ical',
        externalStatus: ev.summary,
        notes: ev.summary ? `iCal: ${ev.summary}` : 'Imported from iCal',
        payload: { uid: ev.uid, summary: ev.summary, source: 'ical' },
        status: 'reserved',
      })
      if (!upsert.ok) {
        // Conflict with a non-matching local booking — record and continue
        result.errors.push(`${ev.uid.slice(0, 12)}…: ${upsert.message}`)
        continue
      }
      if (upsert.data.created) result.created += 1
      else result.updated += 1
    }
  }

  // Cancel iCal stays that disappeared from feeds (still active / future)
  const { data: icalStays } = await supabase
    .from('property_stays')
    .select('id, unit_id, external_booking_id, check_out_date, status')
    .eq('company_id', opts.companyId)
    .eq('channel_connection_id', connection.id)
    .eq('booking_source', 'ical')
    .in('status', ['reserved', 'checked_in'])
    .gte('check_out_date', today)

  for (const stay of icalStays ?? []) {
    const uid = stay.external_booking_id
    if (!uid) continue
    const unitSeen = seenUidsByUnit.get(stay.unit_id)
    // Only cancel if we successfully synced that unit's feed
    if (!unitSeen) continue
    if (unitSeen.has(uid)) continue

    const { error: cancelErr } = await supabase
      .from('property_stays')
      .update({
        status: 'cancelled',
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        external_status: 'removed_from_ical',
        updated_at: new Date().toISOString(),
      })
      .eq('id', stay.id)
      .eq('company_id', opts.companyId)

    if (cancelErr) result.errors.push(`Cancel ${uid.slice(0, 12)}: ${cancelErr.message}`)
    else result.cancelled += 1
  }

  const syncOk = result.errors.length === 0 || result.created + result.updated + result.cancelled > 0
  await supabase
    .from('property_channel_connections')
    .update({
      sync_status: result.errors.length > 0 && result.created + result.updated === 0 ? 'error' : 'ok',
      last_sync_at: new Date().toISOString(),
      last_sync_error: result.errors.length > 0 ? result.errors.slice(0, 5).join(' · ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id)

  if (!syncOk && result.created === 0 && result.updated === 0 && result.roomsSynced === 0) {
    return { ok: false, message: result.errors[0] ?? 'iCal sync failed' }
  }

  return { ok: true, data: result }
}

async function markConnectionError(
  supabase: SupabaseClient,
  connectionId: string,
  message: string,
) {
  await supabase
    .from('property_channel_connections')
    .update({
      sync_status: 'error',
      last_sync_error: message,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)
}

