/**
 * Monthly owner statement.
 * Occupancy is unit-nights in the month covered by a stay or a lease (a night counts once).
 * Money is rent and stay invoices issued in that month. Collected is amount already paid on those invoices.
 */

import { roundFinancial } from '@/lib/finance-calc'
import { stayCoversNight } from '@/lib/stay-calendar'
import type { PropertyLease, PropertyStay } from '@/types/database'

export type StatementSite = {
  id: string
  name: string
  property_kind: string | null
  is_active?: boolean | null
}

export type StatementUnit = { id: string; site_id: string }

export type StatementStay = Pick<PropertyStay, 'site_id' | 'unit_id' | 'status' | 'check_in_date' | 'check_out_date'>

export type StatementLease = Pick<PropertyLease, 'site_id' | 'unit_id' | 'status' | 'start_date' | 'end_date'>

export type StatementInvoice = {
  site_id: string | null
  invoice_type: string | null
  status: string
  total_amount: number | null
  amount_paid: number | null
  balance_due: number | null
}

export type OwnerStatementRow = {
  siteId: string
  name: string
  kind: string | null
  rooms: number
  availableNights: number
  occupiedNights: number
  occupancyRatio: number | null
  rentBilled: number
  rentCollected: number
  stayBilled: number
  stayCollected: number
  outstanding: number
}

const IGNORED_INVOICE = new Set(['draft', 'cancelled', 'voided'])

export function leaseCoversNight(
  lease: Pick<StatementLease, 'status' | 'start_date' | 'end_date' | 'unit_id'>,
  night: string,
): boolean {
  if (!lease.unit_id) return false
  if (lease.status === 'draft' || lease.status === 'cancelled') return false
  if (lease.start_date > night) return false
  if (lease.end_date && lease.end_date < night) return false
  return true
}

function money(n: number | null | undefined): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

export function buildOwnerStatements(input: {
  sites: StatementSite[]
  units: StatementUnit[]
  stays: StatementStay[]
  leases: StatementLease[]
  invoices: StatementInvoice[]
  nights: string[]
}): OwnerStatementRow[] {
  const unitsBySite = new Map<string, string[]>()
  for (const unit of input.units) {
    const list = unitsBySite.get(unit.site_id) ?? []
    list.push(unit.id)
    unitsBySite.set(unit.site_id, list)
  }

  const rows: OwnerStatementRow[] = []
  for (const site of input.sites) {
    const unitIds = unitsBySite.get(site.id) ?? []
    let occupiedNights = 0
    for (const unitId of unitIds) {
      for (const night of input.nights) {
        const stayed = input.stays.some(s =>
          s.site_id === site.id && s.unit_id === unitId && stayCoversNight(s, night),
        )
        const leased = input.leases.some(l =>
          l.site_id === site.id && l.unit_id === unitId && leaseCoversNight(l, night),
        )
        if (stayed || leased) occupiedNights += 1
      }
    }

    const availableNights = unitIds.length * input.nights.length
    let rentBilled = 0
    let rentCollected = 0
    let stayBilled = 0
    let stayCollected = 0
    let outstanding = 0

    for (const inv of input.invoices) {
      if (inv.site_id !== site.id) continue
      if (IGNORED_INVOICE.has(inv.status)) continue
      const billed = money(inv.total_amount)
      const collected = money(inv.amount_paid)
      const due = money(inv.balance_due)
      if (inv.invoice_type === 'rent') {
        rentBilled += billed
        rentCollected += collected
        outstanding += due
      } else if (inv.invoice_type === 'stay') {
        stayBilled += billed
        stayCollected += collected
        outstanding += due
      }
    }

    const row: OwnerStatementRow = {
      siteId: site.id,
      name: site.name,
      kind: site.property_kind,
      rooms: unitIds.length,
      availableNights,
      occupiedNights,
      occupancyRatio: availableNights > 0 ? occupiedNights / availableNights : null,
      rentBilled: roundFinancial(rentBilled),
      rentCollected: roundFinancial(rentCollected),
      stayBilled: roundFinancial(stayBilled),
      stayCollected: roundFinancial(stayCollected),
      outstanding: roundFinancial(outstanding),
    }

    const inactive = site.is_active === false
    const empty = row.occupiedNights === 0
      && row.rentBilled === 0
      && row.stayBilled === 0
      && row.outstanding === 0
    if (inactive && empty) continue
    rows.push(row)
  }

  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

export function statementTotals(rows: OwnerStatementRow[]): {
  occupiedNights: number
  availableNights: number
  occupancyRatio: number | null
  rentBilled: number
  rentCollected: number
  stayBilled: number
  stayCollected: number
  outstanding: number
} {
  const occupiedNights = rows.reduce((s, r) => s + r.occupiedNights, 0)
  const availableNights = rows.reduce((s, r) => s + r.availableNights, 0)
  return {
    occupiedNights,
    availableNights,
    occupancyRatio: availableNights > 0 ? occupiedNights / availableNights : null,
    rentBilled: roundFinancial(rows.reduce((s, r) => s + r.rentBilled, 0)),
    rentCollected: roundFinancial(rows.reduce((s, r) => s + r.rentCollected, 0)),
    stayBilled: roundFinancial(rows.reduce((s, r) => s + r.stayBilled, 0)),
    stayCollected: roundFinancial(rows.reduce((s, r) => s + r.stayCollected, 0)),
    outstanding: roundFinancial(rows.reduce((s, r) => s + r.outstanding, 0)),
  }
}
