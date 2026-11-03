/**
 * One table description drives the screen table, the CSV file and the PDF, so the three always agree.
 * Pure (apart from downloadCsv), tested.
 */

import { count, csvNumber, dayShort, days, hours, money, pct, words } from './format'

/** 'amount' is money that shows blank when it is zero (salary schedules). */
export type ColKind = 'text' | 'money' | 'amount' | 'count' | 'pct' | 'hours' | 'days' | 'day' | 'yesno' | 'minutes' | 'words'

export type Column<Row> = {
  key: string
  label: string
  kind?: ColKind
  /** Value used for sorting, CSV and the default display. Defaults to row[key]. */
  get?: (row: Row) => unknown
  /** Relative width in the PDF (default 1). */
  width?: number
}

export type TableSpec<Row = Record<string, unknown>> = {
  title: string
  columns: Column<Row>[]
  rows: Row[]
  /** Optional totals row: key → value. */
  totals?: Record<string, unknown>
  note?: string
}

export function cellValue<Row>(col: Column<Row>, row: Row): unknown {
  return col.get ? col.get(row) : (row as Record<string, unknown>)[col.key]
}

export function isNumericKind(kind: ColKind | undefined): boolean {
  return kind === 'money' || kind === 'amount' || kind === 'count' || kind === 'pct' || kind === 'hours' || kind === 'days' || kind === 'minutes'
}

/** How a cell reads on screen and in the PDF. */
export function displayCell(kind: ColKind | undefined, v: unknown): string {
  if (v == null || v === '') return '—'
  switch (kind) {
    case 'money': return money(v)
    case 'amount': return Number(v) === 0 ? '' : money(v)
    case 'count': return count(v)
    case 'pct': return pct(v)
    case 'hours': return hours(v)
    case 'days': return days(v)
    case 'minutes': return `${count(v)} min`
    case 'day': return dayShort(v)
    case 'yesno': return v === true ? 'Yes' : v === false ? 'No' : '—'
    case 'words': return words(v)
    default: return String(v)
  }
}

/** How a cell is written to CSV: plain numbers so a spreadsheet can add them up. */
export function csvCell(kind: ColKind | undefined, v: unknown): string {
  if (v == null) return ''
  switch (kind) {
    case 'money': case 'amount': return csvNumber(v, 2)
    case 'count': case 'minutes': return csvNumber(v)
    case 'pct': case 'hours': case 'days': return csvNumber(v)
    case 'yesno': return v === true ? 'Yes' : v === false ? 'No' : ''
    case 'day': return typeof v === 'string' ? v.slice(0, 10) : ''
    case 'words': return words(v)
    default: return String(v)
  }
}

function csvEscape(s: string): string {
  // Stop spreadsheet formulas sneaking in through names typed by users.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV text for one or more tables (a blank line and the title between tables). */
export function tablesToCsv(tables: TableSpec<any>[], header?: string[]): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const lines: string[] = []
  for (const h of header ?? []) lines.push(csvEscape(h))
  if (header?.length) lines.push('')
  tables.forEach((t, i) => {
    if (tables.length > 1 || header?.length) {
      if (i > 0) lines.push('')
      lines.push(csvEscape(t.title))
    }
    lines.push(t.columns.map(c => csvEscape(c.label)).join(','))
    for (const r of t.rows) lines.push(t.columns.map(c => csvEscape(csvCell(c.kind, cellValue(c, r)))).join(','))
    if (t.totals) lines.push(t.columns.map((c, ci) => csvEscape(ci === 0 && t.totals![c.key] == null ? 'Total' : csvCell(c.kind, t.totals![c.key]))).join(','))
  })
  return lines.join('\r\n')
}

export function downloadCsv(csv: string, filename: string) {
  // The byte-order mark makes Excel read accented names correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function fileSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report'
}

export function sortRows<Row>(rows: Row[], col: Column<Row> | undefined, dir: 'asc' | 'desc'): Row[] {
  if (!col) return rows
  const numeric = isNumericKind(col.kind)
  const out = [...rows]
  out.sort((a, b) => {
    const va = cellValue(col, a), vb = cellValue(col, b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const c = numeric ? Number(va) - Number(vb) : String(va).localeCompare(String(vb), 'en-ZA', { numeric: true })
    return dir === 'asc' ? c : -c
  })
  return out
}
