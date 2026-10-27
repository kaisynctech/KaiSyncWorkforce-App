import { describe, expect, it } from 'vitest'
import { bankLines, letterheadDetailLines, letterheadFromRow, showsBank } from './letterhead'

const row = {
  name: 'Ironvale',
  legal_name: 'Ironvale Holdings (Pty) Ltd',
  registration_number: '2020/123456/07',
  is_vat_registered: true,
  vat_number: '4123456789',
  address: '1 Main Rd\nClaremont',
  contact_phone: '021 000 0000',
  contact_email: 'hello@ironvale.test',
  website: 'ironvale.test',
  brand_logo_path: 'abc/logo.png',
  bank_name: 'FNB',
  bank_account_number: '62000000000',
  bank_branch_code: '250655',
  bank_account_holder: 'Ironvale Holdings',
  show_bank_on_invoices: true,
  show_bank_on_quotes: false,
  document_footer: 'Thank you for your business.',
}

describe('letterheadFromRow', () => {
  it('reads a companies row', () => {
    const lh = letterheadFromRow(row)
    expect(lh.name).toBe('Ironvale')
    expect(lh.vatNumber).toBe('4123456789')
    expect(lh.logoPath).toBe('abc/logo.png')
    expect(lh.bank?.bankName).toBe('FNB')
    expect(lh.footer).toBe('Thank you for your business.')
  })

  it('hides the VAT number when not VAT registered', () => {
    expect(letterheadFromRow({ ...row, is_vat_registered: false }).vatNumber).toBeNull()
  })

  it('reads the portal shape (bank nested, logo_path)', () => {
    const lh = letterheadFromRow({ name: 'X', logo_path: 'p.png', show_bank_on_invoices: true, bank: { bank_name: 'ABSA', bank_account_number: '1' } })
    expect(lh.logoPath).toBe('p.png')
    expect(lh.bank?.bankName).toBe('ABSA')
  })

  it('has no bank when the portal sends none, and falls back to the name', () => {
    const lh = letterheadFromRow({ bank: null }, 'Fallback Co')
    expect(lh.bank).toBeNull()
    expect(lh.name).toBe('Fallback Co')
  })
})

describe('letterheadDetailLines', () => {
  it('lists registered name, numbers, address and contacts', () => {
    expect(letterheadDetailLines(letterheadFromRow(row))).toEqual([
      'Ironvale Holdings (Pty) Ltd',
      'Reg. no. 2020/123456/07  ·  VAT no. 4123456789',
      '1 Main Rd, Claremont',
      '021 000 0000  ·  hello@ironvale.test  ·  ironvale.test',
    ])
  })

  it('skips a registered name equal to the trading name', () => {
    expect(letterheadDetailLines(letterheadFromRow({ name: 'A', legal_name: 'a' }))).toEqual([])
  })
})

describe('banking', () => {
  it('lists only filled bank fields', () => {
    expect(bankLines(letterheadFromRow(row).bank)).toEqual([
      ['Account name', 'Ironvale Holdings'],
      ['Bank', 'FNB'],
      ['Account number', '62000000000'],
      ['Branch code', '250655'],
    ])
  })

  it('follows the invoice and quote switches', () => {
    const lh = letterheadFromRow(row)
    expect(showsBank(lh, 'invoice')).toBe(true)
    expect(showsBank(lh, 'statement')).toBe(true)
    expect(showsBank(lh, 'quote')).toBe(false)
    expect(showsBank(lh, 'none')).toBe(false)
    expect(showsBank(letterheadFromRow({ ...row, show_bank_on_quotes: true }), 'quote')).toBe(true)
    expect(showsBank(letterheadFromRow({ ...row, bank_name: null, bank_account_number: null }), 'invoice')).toBe(false)
  })
})
