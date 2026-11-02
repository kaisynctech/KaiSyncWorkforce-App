import { describe, expect, it } from 'vitest'
import {
  addDays, deltaPct, describeRange, eachDay, grainFor, presetRange, previousRange, rangeDays, rangeProblem, todaySA, weekStart,
} from './period'
import { countShort, money, moneyShort, pct, signedPct } from './format'
import { csvCell, displayCell, sortRows, tablesToCsv, type TableSpec } from './table'
import { buildInsightsPdf, pdfText } from './pdf'
import { letterheadFromRow } from '@/lib/letterhead'

// 2 Nov 2026, 10:00 in Johannesburg
const NOW = new Date('2026-11-02T08:00:00Z')

describe('periods', () => {
  it('uses the South African date', () => {
    expect(todaySA(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11-01')
  })
  it('works out presets from today', () => {
    expect(presetRange('this_month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-02' })
    expect(presetRange('last_month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(presetRange('last_30', NOW)).toEqual({ from: '2026-10-04', to: '2026-11-02' })
    expect(presetRange('this_quarter', NOW)).toEqual({ from: '2026-10-01', to: '2026-11-02' })
    expect(presetRange('tax_year', NOW)).toEqual({ from: '2026-03-01', to: '2026-11-02' })
    expect(presetRange('tax_year', new Date('2027-02-10T08:00:00Z'))).toEqual({ from: '2026-03-01', to: '2027-02-10' })
    expect(presetRange('last_month', new Date('2027-01-15T08:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(rangeDays(presetRange('last_12m', NOW))).toBeLessThanOrEqual(400)
  })
  it('compares whole months with the months before, other ranges with the same number of days', () => {
    expect(previousRange({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(previousRange({ from: '2026-05-01', to: '2026-10-31' })).toEqual({ from: '2025-11-01', to: '2026-04-30' })
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(previousRange({ from: '2026-10-04', to: '2026-11-02' })).toEqual({ from: '2026-09-04', to: '2026-10-03' })
  })
  it('checks custom ranges', () => {
    expect(rangeProblem({ from: '2026-10-10', to: '2026-10-01' })).toMatch(/before/)
    expect(rangeProblem({ from: '2025-01-01', to: '2026-10-01' })).toMatch(/400/)
    expect(rangeProblem({ from: '2026-02-30', to: '2026-03-01' })).toMatch(/Pick/)
    expect(rangeProblem({ from: '2026-10-01', to: '2026-10-01' })).toBeNull()
  })
  it('picks a grain and labels ranges', () => {
    expect(grainFor({ from: '2026-10-01', to: '2026-10-31' })).toBe('day')
    expect(grainFor({ from: '2026-08-01', to: '2026-10-31' })).toBe('week')
    expect(grainFor({ from: '2026-05-01', to: '2026-10-31' })).toBe('month')
    expect(describeRange({ from: '2026-10-01', to: '2026-10-31' })).toBe('1–31 Oct 2026')
    expect(describeRange({ from: '2026-10-04', to: '2026-11-02' })).toBe('4 Oct – 2 Nov 2026')
    expect(describeRange({ from: '2025-12-01', to: '2026-01-31' })).toBe('1 Dec 2025 – 31 Jan 2026')
  })
  it('does calendar arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(weekStart('2026-11-01')).toBe('2026-10-26') // Sunday → Monday before
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
    expect(eachDay({ from: '2026-10-30', to: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('works out change against the previous period', () => {
    expect(deltaPct(110, 100)).toBeCloseTo(10)
    expect(deltaPct(0, 0)).toBe(0)
    expect(deltaPct(5, 0)).toBeNull()
    expect(deltaPct(null, 3)).toBeNull()
  })
})

describe('formats', () => {
  it('formats money the South African way', () => {
    expect(money(1120143.2).replace(/\s/g, ' ')).toBe('R 1 120 143,20')
    expect(moneyShort(4260000)).toBe('R 4,26m')
    expect(moneyShort(535710)).toBe('R 536k')
    expect(moneyShort(9410).replace(/\s/g, ' ')).toBe('R 9 410')
    expect(moneyShort(null)).toBe('—')
    expect(countShort(57414.8)).toBe('57,4k')
    expect(pct(93.2)).toBe('93,2%')
  })
  it('signs changes', () => {
    expect(signedPct(4.24)).toBe('+4,2%')
    expect(signedPct(-12.4)).toBe('−12%')
    expect(signedPct(0.01)).toBe('0%')
    expect(signedPct(null)).toBe('')
  })
})

type Row = { name: string; amount: number; when: string; ok: boolean | null }
const table: TableSpec<Row> = {
  title: 'Test',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount', kind: 'money' },
    { key: 'when', label: 'When', kind: 'day' },
    { key: 'ok', label: 'OK', kind: 'yesno' },
  ],
  rows: [
    { name: 'Bravo, "B"', amount: 10.5, when: '2026-10-02', ok: true },
    { name: '=HYPERLINK("x")', amount: 2, when: '2026-10-01', ok: null },
  ],
  totals: { amount: 12.5 },
}

describe('tables', () => {
  it('writes CSV with plain numbers, quotes and no formulas', () => {
    const csv = tablesToCsv([table])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Name,Amount,When,OK')
    expect(lines[1]).toBe('"Bravo, ""B""",10.50,2026-10-02,Yes')
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",2.00,2026-10-01,`)
    expect(lines[3]).toBe('Total,12.50,,')
  })
  it('shows cells for people', () => {
    expect(displayCell('day', '2026-10-02')).toBe('2 Oct 2026')
    expect(displayCell('yesno', false)).toBe('No')
    expect(displayCell('money', null)).toBe('—')
    expect(csvCell('words', 'partially_paid')).toBe('Partially paid')
  })
  it('sorts numbers as numbers', () => {
    const sorted = sortRows(table.rows, table.columns[1], 'asc')
    expect(sorted.map(r => r.amount)).toEqual([2, 10.5])
  })
})

describe('pdf', () => {
  it('keeps text the PDF font can draw', () => {
    expect(pdfText('R 1 000 · −5% “ok” 🙂')).toBe('R 1 000 · -5% "ok" ')
  })
  it('builds a multi-page report', () => {
    const many: TableSpec<Row> = { ...table, rows: Array.from({ length: 120 }, (_, i) => ({ name: `Person ${i}`, amount: i, when: '2026-10-01', ok: i % 2 === 0 })) }
    const doc = buildInsightsPdf({
      letterhead: letterheadFromRow({ name: 'Ironvale' }),
      title: 'People and attendance',
      period: '1–31 Oct 2026',
      context: ['Compared with 1–30 Sep 2026'],
      sections: [
        { kind: 'kpis', items: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }, { label: 'C', value: '3' }, { label: 'D', value: '4' }, { label: 'E', value: '5' }] },
        { kind: 'columns', title: 'Trend', labels: ['a', 'b', 'c'], series: [{ name: 'X', color: '#2a78d6', values: [1, 2, 3] }], format: v => String(Math.round(v)) },
        { kind: 'bars', title: 'Bars', items: [{ label: 'One', value: 3, display: '3' }] },
        { kind: 'table', table: many },
      ],
      fileName: 'x.pdf',
    })
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
  })
})
