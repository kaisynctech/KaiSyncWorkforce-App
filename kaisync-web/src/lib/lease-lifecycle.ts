/**
 * Lease notice, move-out, and deposit refund lifecycle.
 * Uses existing property_leases + residents + syncUnitOccupancy — no parallel tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { syncUnitOccupancy } from '@/lib/properties'
import type { LeaseDepositStatus, PropertyLease } from '@/types/database'

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

/** Planned vacate date from notice (notice_given_at + notice_days), else lease.end_date. */
export function plannedVacateDate(
  lease: Pick<PropertyLease, 'notice_given_at' | 'notice_days' | 'end_date'>,
): string | null {
  if (lease.notice_given_at) {
    return addDaysIso(lease.notice_given_at, lease.notice_days ?? 30)
  }
  return lease.end_date ?? null
}

export type LeaseNoticeStatus =
  | { kind: 'none'; label: string }
  | { kind: 'notice_given'; label: string; vacateOn: string; daysRemaining: number }
  | { kind: 'vacating_soon'; label: string; vacateOn: string; daysRemaining: number }
  | { kind: 'overdue'; label: string; vacateOn: string; daysOverdue: number }
  | { kind: 'ended'; label: string }

export function summarizeLeaseNotice(
  lease: Pick<PropertyLease, 'status' | 'notice_given_at' | 'notice_days' | 'end_date'>,
  today = todayIso(),
): LeaseNoticeStatus {
  if (lease.status === 'ended' || lease.status === 'cancelled') {
    return { kind: 'ended', label: lease.status === 'ended' ? 'Ended' : 'Cancelled' }
  }
  const vacate = plannedVacateDate(lease)
  if (!lease.notice_given_at || !vacate) {
    return { kind: 'none', label: `Notice ${lease.notice_days ?? 30}d (not given)` }
  }
  const vacateMs = new Date(vacate + 'T00:00:00').getTime()
  const todayMs = new Date(today + 'T00:00:00').getTime()
  const days = Math.round((vacateMs - todayMs) / 86_400_000)
  if (days < 0) {
    return { kind: 'overdue', label: `Vacate overdue ${Math.abs(days)}d`, vacateOn: vacate, daysOverdue: Math.abs(days) }
  }
  if (days <= 14) {
    return { kind: 'vacating_soon', label: `Vacate in ${days}d`, vacateOn: vacate, daysRemaining: days }
  }
  return { kind: 'notice_given', label: `Notice given · vacate ${vacate}`, vacateOn: vacate, daysRemaining: days }
}

export type GiveNoticeInput = {
  companyId: string
  lease: PropertyLease
  noticeGivenAt: string
  /** When true (default), set end_date to notice + notice_days */
  setEndDate?: boolean
}

export type GiveNoticeResult =
  | { ok: true; vacateOn: string }
  | { ok: false; message: string }

export async function giveLeaseNotice(
  supabase: SupabaseClient,
  input: GiveNoticeInput,
): Promise<GiveNoticeResult> {
  if (input.lease.status !== 'active' && input.lease.status !== 'draft') {
    return { ok: false, message: 'Notice can only be given on draft or active leases.' }
  }
  const noticeDays = input.lease.notice_days ?? 30
  const vacateOn = addDaysIso(input.noticeGivenAt, noticeDays)
  const setEnd = input.setEndDate !== false

  const { error } = await supabase
    .from('property_leases')
    .update({
      notice_given_at: input.noticeGivenAt,
      end_date: setEnd ? vacateOn : input.lease.end_date,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.lease.id)
    .eq('company_id', input.companyId)

  if (error) return { ok: false, message: error.message }
  return { ok: true, vacateOn }
}

export type MoveOutDepositAction =
  | { kind: 'unchanged' }
  | { kind: 'refunded'; amount: number; refundedAt: string }
  | { kind: 'partially_held'; refundAmount: number; refundedAt: string }
  | { kind: 'paid' }

export type CompleteMoveOutInput = {
  companyId: string
  lease: PropertyLease
  vacateDate: string
  deposit: MoveOutDepositAction
  /** Move out residents currently on the lease unit (default true) */
  moveOutUnitOccupants?: boolean
  /** Also set move_out on lease.resident_id if set (default true) */
  moveOutLinkedResident?: boolean
}

export type CompleteMoveOutResult =
  | { ok: true; residentsMovedOut: number }
  | { ok: false; message: string }

export async function completeLeaseMoveOut(
  supabase: SupabaseClient,
  input: CompleteMoveOutInput,
): Promise<CompleteMoveOutResult> {
  if (input.lease.status === 'ended' || input.lease.status === 'cancelled') {
    return { ok: false, message: 'Lease is already closed.' }
  }

  let depositStatus: LeaseDepositStatus = input.lease.deposit_status ?? 'none'
  let depositRefundedAt: string | null = input.lease.deposit_refunded_at ?? null
  let depositRefundAmount: number | null = input.lease.deposit_refund_amount ?? null

  switch (input.deposit.kind) {
    case 'unchanged':
      break
    case 'paid':
      depositStatus = 'paid'
      break
    case 'refunded':
      depositStatus = 'refunded'
      depositRefundedAt = input.deposit.refundedAt
      depositRefundAmount = input.deposit.amount
      break
    case 'partially_held':
      depositStatus = 'partially_held'
      depositRefundedAt = input.deposit.refundedAt
      depositRefundAmount = input.deposit.refundAmount
      break
  }

  const { error: leaseErr } = await supabase
    .from('property_leases')
    .update({
      status: 'ended',
      end_date: input.vacateDate,
      deposit_status: depositStatus,
      deposit_refunded_at: depositRefundedAt,
      deposit_refund_amount: depositRefundAmount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.lease.id)
    .eq('company_id', input.companyId)

  if (leaseErr) return { ok: false, message: leaseErr.message }

  const residentIds = new Set<string>()
  if (input.moveOutLinkedResident !== false && input.lease.resident_id) {
    residentIds.add(input.lease.resident_id)
  }

  if (input.moveOutUnitOccupants !== false && input.lease.unit_id) {
    const { data: occupants, error: occErr } = await supabase
      .from('residents')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('unit_id', input.lease.unit_id)
      .is('move_out_date', null)
    if (occErr) return { ok: false, message: occErr.message }
    for (const r of occupants ?? []) residentIds.add(r.id)
  }

  let moved = 0
  if (residentIds.size > 0) {
    const ids = [...residentIds]
    const { data: updated, error: resErr } = await supabase
      .from('residents')
      .update({ move_out_date: input.vacateDate })
      .eq('company_id', input.companyId)
      .in('id', ids)
      .is('move_out_date', null)
      .select('id')

    if (resErr) return { ok: false, message: resErr.message }
    moved = updated?.length ?? 0
  }

  await syncUnitOccupancy(supabase, input.companyId, input.lease.unit_id)

  return { ok: true, residentsMovedOut: moved }
}
