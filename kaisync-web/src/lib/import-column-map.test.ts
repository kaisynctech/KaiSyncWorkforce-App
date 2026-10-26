import { describe, expect, it } from 'vitest'
import { acceptColumnMap, applyColumnCopies, columnSamples, knownCanonicalHeader, unknownHeaders } from './import-column-map'

describe('import column map', () => {
  it('recognises headings the client importer already accepts', () => {
    expect(knownCanonicalHeader('clients', 'Customer Name')).toBe('Name')
    expect(knownCanonicalHeader('clients', 'Email Address')).toBe('Email')
    expect(unknownHeaders('clients', ['Customer Name', 'ContactName', ''])).toEqual(['ContactName'])
  })

  it('recognises employee template headings and leaves an unknown bank column', () => {
    expect(knownCanonicalHeader('employees', 'First name *')).toBe('First name')
    expect(knownCanonicalHeader('employees', 'ID Number')).toBe('ID / Passport number')
    expect(unknownHeaders('employees', ['First name', 'Surname', 'Worker Type', 'BankAcc'])).toEqual(['BankAcc'])
  })

  it('copies the cell as it is and ignores an unsure match', () => {
    const copies = acceptColumnMap('clients', ['ContactName', 'BankAcc'], [
      { header: 'ContactName', field: 'name', confident: true },
      { header: 'BankAcc', field: 'bank_account_number', confident: false },
      { header: 'ContactName', field: 'email', confident: true },
      { header: 'Other', field: 'name', confident: true },
    ])
    expect(copies).toEqual([{ from: 'ContactName', to: 'Name' }])
    const [row] = applyColumnCopies(
      [{ ContactName: 'North Plant', Name: '', BankAcc: '1234567890' }],
      copies,
    )
    expect(row.Name).toBe('North Plant')
    expect(row.BankAcc).toBe('1234567890')
  })

  it('does not replace a value already in the destination column', () => {
    const [row] = applyColumnCopies(
      [{ ContactName: 'From file', Name: 'Already there' }],
      [{ from: 'ContactName', to: 'Name' }],
    )
    expect(row.Name).toBe('Already there')
  })

  it('shows a date sample without changing the cell', () => {
    const hired = new Date('2024-03-01T00:00:00.000Z')
    expect(columnSamples(['Hired'], [{ Hired: hired }])).toEqual([
      { header: 'Hired', samples: ['2024-03-01'] },
    ])
    const [row] = applyColumnCopies([{ Hired: hired }] as Record<string, unknown>[], [{ from: 'Hired', to: 'Start date' }])
    expect(row.Hired).toBe(hired)
    expect(row['Start date']).toBe(hired)
  })
})
