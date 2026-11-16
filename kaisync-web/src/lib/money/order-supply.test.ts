import { describe, expect, it } from 'vitest'
import { isServiceOnly, lineSupply, parseQty, readyToSend, supplyError } from '@/lib/money/order-supply'

const pos = [{ id: 'p1', po_number: 'PO0141', status: 'partially_received' }, { id: 'p2', po_number: 'PO0142', status: 'cancelled' }]
const pl = (id: string, po: string, q: string, o: number, r: number) => ({ id, po_id: po, quote_line_id: q, description: 'x', unit: 'each', quantity_ordered: o, quantity_received: r, unit_price: 1, vat_rate: 15 })

describe('order supply', () => {
  it('shows where each line stands', () => {
    const lines = [pl('a', 'p1', 'q1', 6, 2), pl('b', 'p2', 'q2', 2, 0), pl('c', 'p1', 'q3', 4, 4), pl('d', 'p1', 'q4', 3, 0)]
    expect(lineSupply({ id: 'q1', supply_mode: 'outsource', quantity: 6 }, lines, pos).label).toBe('Part received 2/6')
    // On a cancelled PO only: back to "to source", or ready for a PO when a supplier is chosen.
    expect(lineSupply({ id: 'q2', supply_mode: 'outsource', quantity: 2 }, lines, pos).key).toBe('to_source')
    expect(lineSupply({ id: 'q2', supply_mode: 'outsource', quantity: 2, supplier_id: 's' }, lines, pos).key).toBe('ready')
    expect(lineSupply({ id: 'q3', supply_mode: 'outsource', quantity: 4 }, lines, pos).key).toBe('received')
    expect(lineSupply({ id: 'q4', supply_mode: 'outsource', quantity: 3 }, lines, pos).po?.po_number).toBe('PO0141')
    expect(lineSupply({ id: 'q5', supply_mode: 'service', quantity: 8 }, lines, pos).label).toBe('Service')
    expect(lineSupply({ id: 'q6', supply_mode: 'stock', quantity: 1 }, lines, pos).label).toBe('From stock')
  })

  it('knows a service-only order and the POs waiting to be sent', () => {
    expect(isServiceOnly([{ id: '1', supply_mode: 'service', quantity: 1 }, { id: '2', supply_mode: 'outsource', quantity: 1, is_excluded: true }], [])).toBe(true)
    expect(isServiceOnly([{ id: '1', supply_mode: 'stock', quantity: 1 }], [])).toBe(false)
    expect(readyToSend([{ id: 'a', po_number: null, status: 'approved', sent_at: null }, { id: 'b', po_number: null, status: 'sent', sent_at: 'x' }]).map(p => p.id)).toEqual(['a'])
  })

  it('reads numbers and explains refusals', () => {
    expect(parseQty('1,5')).toBe(1.5)
    expect(parseQty('1 200')).toBe(1200)
    expect(parseQty('')).toBe(0)
    expect(Number.isNaN(parseQty('abc'))).toBe(true)
    expect(supplyError('ERROR: MORE_THAN_ORDERED')).toMatch(/more than was ordered/)
  })
})
