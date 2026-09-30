import { describe, expect, it } from 'vitest'
import { buildOwnerStatements, leaseCoversNight, statementTotals } from '@/lib/owner-statement'
import { monthNightDates } from '@/lib/stay-calendar'

const nights = monthNightDates(2026, 9)

describe('owner statement', () => {
  it('counts a stay night once even when a lease covers the same night', () => {
    const rows = buildOwnerStatements({
      sites: [{ id: 'site', name: 'Main', property_kind: 'guest_house', is_active: true }],
      units: [{ id: 'u1', site_id: 'site' }],
      stays: [{
        site_id: 'site',
        unit_id: 'u1',
        status: 'checked_out',
        check_in_date: '2026-10-01',
        check_out_date: '2026-10-04',
      }],
      leases: [{
        site_id: 'site',
        unit_id: 'u1',
        status: 'active',
        start_date: '2026-10-01',
        end_date: '2026-10-03',
      }],
      invoices: [],
      nights,
    })
    expect(rows[0].occupiedNights).toBe(3)
    expect(rows[0].availableNights).toBe(31)
    expect(leaseCoversNight({
      unit_id: 'u1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-03',
    }, '2026-10-03')).toBe(true)
    expect(leaseCoversNight({
      unit_id: 'u1',
      status: 'cancelled',
      start_date: '2026-10-01',
      end_date: null,
    }, '2026-10-02')).toBe(false)
  })

  it('splits rent and stay money issued in the month and skips voided invoices', () => {
    const rows = buildOwnerStatements({
      sites: [{ id: 'site', name: 'Main', property_kind: 'residential', is_active: true }],
      units: [{ id: 'u1', site_id: 'site' }],
      stays: [],
      leases: [],
      invoices: [
        { site_id: 'site', invoice_type: 'rent', status: 'sent', total_amount: 1000, amount_paid: 400, balance_due: 600 },
        { site_id: 'site', invoice_type: 'stay', status: 'paid', total_amount: 800, amount_paid: 800, balance_due: 0 },
        { site_id: 'site', invoice_type: 'rent', status: 'voided', total_amount: 5000, amount_paid: 0, balance_due: 5000 },
        { site_id: 'site', invoice_type: 'standard', status: 'sent', total_amount: 50, amount_paid: 50, balance_due: 0 },
      ],
      nights,
    })
    expect(rows[0].rentBilled).toBe(1000)
    expect(rows[0].rentCollected).toBe(400)
    expect(rows[0].stayBilled).toBe(800)
    expect(rows[0].stayCollected).toBe(800)
    expect(rows[0].outstanding).toBe(600)
    expect(rows[0].occupiedNights).toBe(0)
  })

  it('hides an inactive property with nothing in the month', () => {
    const rows = buildOwnerStatements({
      sites: [{ id: 'old', name: 'Old', property_kind: 'other', is_active: false }],
      units: [],
      stays: [],
      leases: [],
      invoices: [],
      nights,
    })
    expect(rows).toHaveLength(0)
    expect(statementTotals(rows).occupancyRatio).toBeNull()
  })
})
