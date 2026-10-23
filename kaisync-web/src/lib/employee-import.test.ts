import { describe, expect, it } from 'vitest'
import {
  chunk, formatDuration, headerKey, isAlreadyInCompany, managerIsInFile, parseAmount, parseDate, parseImportRow, parseImportSheet, problemsCsv,
} from './employee-import'

describe('headers', () => {
  it('accepts the new template, the old template and common spellings', () => {
    expect(headerKey('First name *')).toBe('name')
    expect(headerKey('Name')).toBe('name')
    expect(headerKey('ID / Passport number')).toBe('id_number')
    expect(headerKey('ID Number')).toBe('id_number')
    expect(headerKey('Reports to')).toBe('manager')
    expect(headerKey('Manager')).toBe('manager')
    expect(headerKey('Daily Rate')).toBe('daily_rate')
    expect(headerKey('Bank Account')).toBe('bank_account')
    expect(headerKey('Worker Type')).toBeNull()
  })
})

describe('amounts and dates', () => {
  it('reads South African money formats', () => {
    expect(parseAmount('R 14 065,50')).toBe(14065.5)
    expect(parseAmount('14,065.50')).toBe(14065.5)
    expect(parseAmount('14065')).toBe(14065)
    expect(parseAmount(67.62)).toBe(67.62)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('abc')).toBeNull()
  })
  it('reads dates day first, ISO, Excel serials and Date objects', () => {
    expect(parseDate('2024-03-01')).toBe('2024-03-01')
    expect(parseDate('01/03/2024')).toBe('2024-03-01')
    expect(parseDate(45352)).toBe('2024-03-01')
    expect(parseDate(new Date(2024, 2, 1))).toBe('2024-03-01')
    expect(parseDate('31/02/2024')).toBeNull()
    expect(parseDate('next week')).toBeNull()
    expect(parseDate('')).toBeUndefined()
  })
})

describe('one row', () => {
  it('hourly worker: day rate follows from daily hours, rounded to cents', () => {
    const { row, errors } = parseImportRow({ 'First name *': 'Thabo', 'Surname *': 'Mokoena', 'Hourly rate': '67.62', 'Daily hours': 8.25 }, 2)
    expect(errors).toEqual([])
    expect(row).toMatchObject({ pay_by_hour: true, pay_basis: 'hourly', hourly_rate: 67.62, daily_rate: 557.87, daily_hours: 8.25 })
  })
  it('daily worker from an explicit pay basis', () => {
    const { row, errors } = parseImportRow({ Name: 'Sipho', Surname: 'Dube', 'Pay basis': 'Daily', 'Day rate': 380 }, 3)
    expect(errors).toEqual([])
    expect(row).toMatchObject({ pay_by_hour: true, pay_basis: 'daily', daily_rate: 380, hourly_rate: 47.5 })
  })
  it('salaried worker', () => {
    const { row, errors } = parseImportRow({ Name: 'Liezl', Surname: 'Kruger', 'Monthly salary': 'R 42 000', 'Start date': '01/02/2021' }, 4)
    expect(errors).toEqual([])
    expect(row).toMatchObject({ pay_by_hour: false, monthly_salary: 42000, employment_date: '2021-02-01' })
    expect(row.pay_basis).toBeUndefined()
  })
  it('hourly basis without a rate is an error', () => {
    const { errors } = parseImportRow({ Name: 'A', Surname: 'B', 'Pay basis': 'Hourly' }, 5)
    expect(errors).toContain('Enter the hourly rate.')
  })
  it('reports bad values in plain words', () => {
    const { errors } = parseImportRow({
      Name: '', 'Access level': 'Owner', 'Employment type': 'Seasonal', 'Start date': 'soon',
      'Work days per week': 9, 'UIF exempt': 'maybe', 'Account type': 'Gold', Email: 'not-an-email',
    }, 6)
    expect(errors).toEqual(expect.arrayContaining([
      'First name is missing.',
      expect.stringContaining('owner cannot be imported'),
      expect.stringContaining('Employment type "Seasonal"'),
      expect.stringContaining('Start date "soon"'),
      expect.stringContaining('Work days per week'),
      expect.stringContaining('UIF exempt'),
      expect.stringContaining('Account type "Gold"'),
      expect.stringContaining('Email "not-an-email"'),
    ]))
  })
  it('warns when no pay is given', () => {
    expect(parseImportRow({ Name: 'A', Surname: 'B' }, 2).warnings[0]).toContain('no pay')
  })
})

describe('whole file', () => {
  const headers = ['First name *', 'Surname *', 'Email', 'ID / Passport number', 'Reports to', 'Hourly rate']
  const sheet = [
    { 'First name *': 'Ann', 'Surname *': 'One', Email: 'ann@x.test', 'ID / Passport number': '1', 'Reports to': 'Ben Two', 'Hourly rate': 50 },
    { 'First name *': 'Ben', 'Surname *': 'Two', Email: 'ANN@x.test', 'ID / Passport number': '2', 'Hourly rate': 60 },
    { 'First name *': 'Cat', 'Surname *': 'Three', 'ID / Passport number': '1', 'Reports to': 'Cat Three', 'Hourly rate': 60 },
    { 'First name *': '', 'Surname *': '' },
  ]
  it('finds duplicates inside the file, self-reporting, and skips blank lines', () => {
    const res = parseImportSheet(sheet, headers)
    expect(res.rows).toHaveLength(3)
    expect(res.rows[1].errors).toContain('Email ann@x.test is also on row 2.')
    expect(res.rows[2].errors).toContain('ID number 1 is also on row 2.')
    expect(res.rows[2].errors).toContain('A person cannot report to themselves.')
    expect(res.rows[0].errors).toEqual([])
  })
  it('knows a manager further down the file', () => {
    const rows = parseImportSheet(sheet, headers).rows.map(p => p.row)
    expect(managerIsInFile('ben two', rows)).toBe(true)
    expect(managerIsInFile('Zed Nobody', rows)).toBe(false)
  })
  it('reports missing required columns and unknown headers', () => {
    const res = parseImportSheet([{ Email: 'a@b.co', Colour: 'red' }], ['Email', 'Colour'])
    expect(res.missingColumns).toEqual(['First name', 'Surname'])
    expect(res.unknownHeaders).toEqual(['Colour'])
  })
  it('uses the real sheet row number when SheetJS skipped blank rows', () => {
    const cells = { 'First name *': 'Dee', 'Surname *': 'Four' }
    Object.defineProperty(cells, '__rowNum__', { value: 9, enumerable: false })
    expect(parseImportSheet([cells], headers).rows[0].row.row).toBe(10)
  })
})

describe('helpers', () => {
  it('ignores the old Worker Type column without a warning', () => {
    expect(parseImportSheet([{ Name: 'A', Surname: 'B', 'Worker Type': 'employee' }], ['Name', 'Surname', 'Worker Type']).unknownHeaders).toEqual([])
  })
  it('spots rows that are only "already in the company"', () => {
    expect(isAlreadyInCompany(['Someone with email a@b.co already exists.'])).toBe(true)
    expect(isAlreadyInCompany(['Employee number IV-1 is already used.', 'Branch "X" was not found.'])).toBe(false)
    expect(isAlreadyInCompany([])).toBe(false)
  })
  it('formats durations', () => {
    expect(formatDuration(0.4)).toBe('under a second')
    expect(formatDuration(1.2)).toBe('1 second')
    expect(formatDuration(14)).toBe('14 seconds')
    expect(formatDuration(125)).toBe('2 min 5 s')
  })
  it('chunks', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]))
  it('writes a problems CSV', () => {
    expect(problemsCsv([{ row: 3, name: 'A "B"', problem: 'Bad, very' }])).toBe('Row,Name,Problem\r\n3,"A ""B""","Bad, very"')
  })
})
