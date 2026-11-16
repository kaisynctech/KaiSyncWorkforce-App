/**
 * Supplier bill check against its purchase order and what was delivered (po_three_way_match, per PO line).
 * Amounts are for the whole PO: every bill on it, every delivery for it.
 */
import type { ThreeWayMatchLine } from '@/types/commercial'

export type BillCheck = {
  state: 'matched' | 'over' | 'waiting' | 'none'
  /** Billed more than was delivered (value). */
  overBy: number
  /** Ordered but not delivered yet (value). */
  notDelivered: number
  label: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function billCheck(lines: Pick<ThreeWayMatchLine, 'value_ordered' | 'value_received' | 'value_invoiced'>[], fmt: (n: number) => string): BillCheck {
  if (lines.length === 0) return { state: 'none', overBy: 0, notDelivered: 0, label: 'No order lines to check against' }
  let overBy = 0
  let notDelivered = 0
  for (const l of lines) {
    const ordered = Number(l.value_ordered ?? 0)
    const received = Number(l.value_received ?? 0)
    const invoiced = Number(l.value_invoiced ?? 0)
    overBy += Math.max(0, invoiced - received)
    notDelivered += Math.max(0, ordered - received)
  }
  overBy = r2(overBy)
  notDelivered = r2(notDelivered)
  if (overBy > 0.004) return { state: 'over', overBy, notDelivered, label: `Billed ${fmt(overBy)} more than was delivered` }
  if (notDelivered > 0.004) return { state: 'waiting', overBy, notDelivered, label: `Not all delivered yet (${fmt(notDelivered)} still to come)` }
  return { state: 'matched', overBy, notDelivered, label: 'Matches the PO and what was delivered' }
}
