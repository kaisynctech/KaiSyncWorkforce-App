import { describe, expect, it } from 'vitest'
import { buildQuotePdf } from '@/lib/quote-pdf'

describe('template quotation PDF', () => {
  it('prints the template columns, top fields, options, deposit and terms, never cost or margin', () => {
    const doc = buildQuotePdf({
      quote_number: 'QU0214', title: 'Fleet service parts', status: 'draft', valid_until: '2026-11-27', notes: null,
      client_name: 'ABC Logistics', client_email: null, company_name: 'Test Co', currency: 'ZAR',
      columns: [{ key: 'item', label: 'Product' }, { key: 'part_no', label: 'Part no.' }, { key: 'brand', label: 'Brand' }, { key: 'qty', label: 'Qty' }, { key: 'price', label: 'Unit price' }, { key: 'total', label: 'Total' }, { key: 'cost', label: 'Cost' }],
      header_fields: [{ label: 'Vehicle / machine', value: 'Mercedes Actros 2645' }],
      lines: [
        { description: 'Alternator 24V 80A', qty: 2, unit: 'each', unit_price: 2500, total: 5000, extra: { part_no: '0 124 525 045', brand: 'Bosch' } },
        { description: 'Alternator, remanufactured', qty: 2, unit: 'each', unit_price: 1650, total: 3300, is_option: true, extra: { brand: 'Bosch' } },
        { description: 'Service plan', qty: 1, unit: 'each', unit_price: 900, total: 900, recurring: 'month' },
      ],
      subtotal: 5900, vat: 885, total: 6785, vatRate: 0.15,
      deposit: { pct: 50, amount: 3392.5 }, recurring: [{ period: 'month', amount: 900 }], terms: '50% deposit secures the order.',
    })
    const text = (doc.internal.pages as unknown as string[][]).flat().join('\n').replace(/\\([()])/g, '$1')
    expect(text).toContain('Part no.')
    expect(text).toContain('0 124 525 045')
    expect(text).toContain('Vehicle / machine: Mercedes Actros 2645')
    expect(text).toContain('Option: Alternator, remanufactured')
    expect(text).toContain('Deposit to accept (50%)')
    expect(text).toContain('Then every month')
    expect(text).toContain('50% deposit secures the order.')
    // Team-only columns are never printed.
    expect(text).not.toMatch(/\(Cost\) Tj/)
  })
})
