import { describe, expect, it } from 'vitest'
import { billToLines, buildInvoicePdf, invoiceShowsVat, type InvoicePdfInput } from './invoice-pdf'
import { letterheadFromRow } from './letterhead'

const base: InvoicePdfInput = {
  invoice_number: 'INV-2026-0001', status: 'sent', issue_date: '2026-11-04', due_date: null, notes: null,
  client_name: 'Bluewater', client_email: 'accounts@bluewater.test', company_name: 'Winterstech',
  lines: [{ description: 'Service', qty: 1, unit_price: 1500, vat_amount: 0, total: 1500 }],
  subtotal: 1500, vat: 0, total: 1500, amount_paid: 0, balance_due: 1500,
}

function text(input: InvoicePdfInput): string {
  const doc = buildInvoicePdf(input)
  return (doc.output() as string).replace(/\s+/g, ' ')
}

describe('VAT on invoices', () => {
  it('shows VAT only for a registered company that charges it', () => {
    expect(invoiceShowsVat({ vatRegistered: true }, 225)).toBe(true)
    expect(invoiceShowsVat({ vatRegistered: true }, 0)).toBe(false)
    expect(invoiceShowsVat({ vatRegistered: false }, 225)).toBe(false)
  })

  it('new letterheads follow the company VAT setting', () => {
    expect(letterheadFromRow({ name: 'A', is_vat_registered: false, vat_number: '4123456789' }).vatRegistered).toBe(false)
    expect(letterheadFromRow({ name: 'A', is_vat_registered: false, vat_number: '4123456789' }).vatNumber).toBeNull()
    expect(letterheadFromRow({ name: 'A', is_vat_registered: true, vat_number: '4123456789' }).vatRegistered).toBe(true)
  })

  it('a non-registered company gets a plain Invoice with no VAT wording', () => {
    const t = text({ ...base, letterhead: letterheadFromRow({ name: 'Winterstech', is_vat_registered: false }) })
    expect(t).toContain('INVOICE')
    expect(t).not.toMatch(/TAX INVOICE|Tax invoice/)
    expect(t).not.toContain('VAT')
  })

  it('a registered company charging VAT gets a Tax invoice with excl./VAT/incl. totals', () => {
    const t = text({
      ...base, vat: 225, total: 1725, balance_due: 1725,
      client_vat_number: '4999999999', client_address: '1 Main Road\nPretoria',
      letterhead: letterheadFromRow({ name: 'Winterstech', is_vat_registered: true, vat_number: '4123456789' }),
    })
    expect(t).toMatch(/TAX INVOICE|Tax invoice/)
    expect(t).toContain('Total excl. VAT')
    expect(t).toContain('VAT \\(15%\\)')
    expect(t).toContain('Total incl. VAT')
    expect(t).toContain('VAT no. 4999999999')
    expect(t).toContain('1 Main Road')
  })

  it('bill-to lists registered name, address lines, VAT number (tax invoices only) and email', () => {
    const c = { client_name: 'Bluewater', client_legal_name: 'Bluewater Developments (Pty) Ltd', client_address: 'Unit 4\n12 Long St\nCape Town', client_vat_number: '4999999999', client_email: 'a@b.test' }
    expect(billToLines(c, true)).toEqual(['Bluewater Developments (Pty) Ltd', 'Unit 4', '12 Long St', 'Cape Town', 'VAT no. 4999999999', 'a@b.test'])
    expect(billToLines(c, false)).not.toContain('VAT no. 4999999999')
    expect(billToLines({ ...c, client_legal_name: 'bluewater' }, false)[0]).toBe('Unit 4')
  })
})
