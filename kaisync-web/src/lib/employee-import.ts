/**
 * Employee import: turns spreadsheet rows into rows for the hr_import_employees database function.
 * Everything here is pure (no network) so it can be unit tested. The page does the I/O.
 *
 * The server checks what needs the database (branch, time template, manager, duplicates of people
 * already in the company, role rules). This module checks the file itself: required names, numbers,
 * dates, pay basis and rates, and duplicates inside the file.
 */
import { normalizeAccessLevel, normalizeEmploymentType } from '@/lib/employee-taxonomy'
import { missingRateMessage, resolvePayRates } from '@/lib/pay-rates'

/** Column order of the downloadable template. `*` marks required columns. */
export const IMPORT_COLUMNS = [
  { key: 'name', header: 'First name *', help: 'Required.' },
  { key: 'surname', header: 'Surname *', help: 'Required.' },
  { key: 'employee_number', header: 'Employee number', help: 'Leave blank to number them automatically (e.g. IV-0012).' },
  { key: 'email', header: 'Email', help: 'Used for invites. Must be unique in your company.' },
  { key: 'phone', header: 'Phone', help: 'e.g. 082 123 4567' },
  { key: 'id_number', header: 'ID / Passport number', help: 'Workers can sign in with this and the company code. Must be unique.' },
  { key: 'position', header: 'Position', help: 'e.g. General Worker' },
  { key: 'department', header: 'Department', help: 'Any text, e.g. Site Labour' },
  { key: 'branch', header: 'Branch', help: 'Must match a branch in Settings (see the Lists sheet).' },
  { key: 'manager', header: 'Reports to', help: 'Manager\'s employee number, email or full name. They can be further down the file.' },
  { key: 'access_level', header: 'Access level', help: 'Employee (default), Manager, HR or Admin.' },
  { key: 'employment_type', header: 'Employment type', help: 'Permanent (default), Contract, Part-time or Student.' },
  { key: 'employment_date', header: 'Start date', help: 'e.g. 2024-03-01 or 01/03/2024 (day first).' },
  { key: 'time_template', header: 'Time template', help: 'Must match a time template (see the Lists sheet). The start of the name is enough if unique.' },
  { key: 'work_days_weekly', header: 'Work days per week', help: '1 to 7. Default 5.' },
  { key: 'daily_hours', header: 'Daily hours', help: 'e.g. 8 or 8.25. Default 8.' },
  { key: 'pay_basis', header: 'Pay basis', help: 'Monthly, Hourly or Daily. Blank = worked out from the rate you fill in.' },
  { key: 'monthly_salary', header: 'Monthly salary', help: 'For monthly pay.' },
  { key: 'hourly_rate', header: 'Hourly rate', help: 'For hourly pay.' },
  { key: 'daily_rate', header: 'Day rate', help: 'For daily pay.' },
  { key: 'paye_rate_percent', header: 'PAYE rate %', help: 'Blank = company default.' },
  { key: 'uif_exempt', header: 'UIF exempt', help: 'Yes or No (default No).' },
  { key: 'medical_aid', header: 'Medical aid', help: 'Monthly deduction in rand.' },
  { key: 'pension', header: 'Pension', help: 'Monthly deduction in rand.' },
  { key: 'union_fee', header: 'Union', help: 'Monthly deduction in rand.' },
  { key: 'bank_name', header: 'Bank name', help: 'e.g. Capitec' },
  { key: 'bank_account', header: 'Account number', help: '' },
  { key: 'bank_branch_code', header: 'Branch code', help: '' },
  { key: 'account_type', header: 'Account type', help: 'Cheque, Savings or Transmission.' },
] as const

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]['key']

/** Other header spellings we accept (older template, common exports). Compared without case/spaces/punctuation. */
const HEADER_ALIASES: Record<string, ImportColumnKey> = {
  name: 'name', firstname: 'name', firstnames: 'name', givenname: 'name',
  surname: 'surname', lastname: 'surname', familyname: 'surname',
  employeenumber: 'employee_number', employeeno: 'employee_number', empno: 'employee_number', staffnumber: 'employee_number', staffno: 'employee_number',
  email: 'email', emailaddress: 'email',
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', cell: 'phone', cellphone: 'phone',
  idnumber: 'id_number', idpassportnumber: 'id_number', id: 'id_number', passport: 'id_number', passportnumber: 'id_number', idorpassport: 'id_number',
  position: 'position', jobtitle: 'position', role: 'position', title: 'position',
  department: 'department', dept: 'department',
  branch: 'branch', branchname: 'branch', site: 'branch',
  reportsto: 'manager', manager: 'manager', linemanager: 'manager',
  accesslevel: 'access_level',
  employmenttype: 'employment_type', type: 'employment_type',
  startdate: 'employment_date', employmentdate: 'employment_date', datestarted: 'employment_date', datejoined: 'employment_date',
  timetemplate: 'time_template', shift: 'time_template', shifttemplate: 'time_template', template: 'time_template',
  workdaysperweek: 'work_days_weekly', workdays: 'work_days_weekly', daysperweek: 'work_days_weekly',
  dailyhours: 'daily_hours', hoursperday: 'daily_hours',
  paybasis: 'pay_basis', paytype: 'pay_basis', paidby: 'pay_basis',
  monthlysalary: 'monthly_salary', salary: 'monthly_salary',
  hourlyrate: 'hourly_rate', rateperhour: 'hourly_rate',
  dayrate: 'daily_rate', dailyrate: 'daily_rate', rateperday: 'daily_rate',
  payerate: 'paye_rate_percent', payeratepercent: 'paye_rate_percent', paye: 'paye_rate_percent',
  uifexempt: 'uif_exempt',
  medicalaid: 'medical_aid', medical: 'medical_aid',
  pension: 'pension', providentfund: 'pension',
  union: 'union_fee', unionfee: 'union_fee',
  bankname: 'bank_name', bank: 'bank_name',
  accountnumber: 'bank_account', bankaccount: 'bank_account', accountno: 'bank_account',
  branchcode: 'bank_branch_code', bankbranchcode: 'bank_branch_code',
  accounttype: 'account_type',
}

/** Columns from the old template that are no longer used. Ignored without a warning. */
const RETIRED_HEADERS = new Set(['workertype'])

export function headerKey(header: string): ImportColumnKey | null {
  const k = header.replace(/\*/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return HEADER_ALIASES[k] ?? null
}

/** Row sent to hr_import_employees. Keys match the database function. */
export type ImportRow = {
  row: number
  name: string
  surname: string
  employee_number?: string
  email?: string
  phone?: string
  id_number?: string
  position?: string
  department?: string
  branch?: string
  manager?: string
  access_level: string
  employment_type: string
  employment_date?: string
  time_template?: string
  work_days_weekly: number
  daily_hours: number
  pay_by_hour: boolean
  pay_basis?: 'hourly' | 'daily'
  monthly_salary: number
  hourly_rate: number
  daily_rate: number
  paye_rate_percent?: number
  uif_exempt: boolean
  medical_aid: number
  pension: number
  union_fee: number
  bank_name?: string
  bank_account?: string
  bank_branch_code?: string
  account_type?: string
}

export type ParsedRow = { row: ImportRow; errors: string[]; warnings: string[] }

export type ParseResult = {
  rows: ParsedRow[]
  /** Headers in the file that we did not recognise (ignored). */
  unknownHeaders: string[]
  /** Required columns missing from the file. */
  missingColumns: string[]
}

function text(v: unknown): string | undefined {
  if (v == null) return undefined
  if (v instanceof Date) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

/** "R 14 065,50", "14,065.50", "14065" → number. Returns null when it is not a number. */
export function parseAmount(v: unknown): number | null {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim().replace(/^R\s*/i, '').replace(/[\s ']/g, '')
  if (!s) return 0
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Dates as Excel gives them (Date, serial number) or typed (2024-03-01, 01/03/2024 day first). */
export function parseDate(v: unknown): string | null | undefined {
  if (v == null || v === '') return undefined
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    // SheetJS dates are local midnight; read local parts so the day does not shift.
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate())
  }
  if (typeof v === 'number') {
    if (v < 1 || v > 80000) return null
    const ms = Math.round((v - 25569) * 86400000)
    const d = new Date(ms)
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const s = String(v).trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return iso(+m[3], +m[2], +m[1])
  return null
}

function yesNo(v: unknown): boolean | null {
  const s = text(v)?.toLowerCase()
  if (!s) return false
  if (['yes', 'y', 'true', '1', 'ja'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'nee'].includes(s)) return false
  return null
}

function payBasisOf(v: unknown): 'monthly' | 'hourly' | 'daily' | null | undefined {
  const s = text(v)?.toLowerCase()
  if (!s) return undefined
  if (['monthly', 'month', 'salary', 'salaried'].includes(s)) return 'monthly'
  if (['hourly', 'hour', 'per hour'].includes(s)) return 'hourly'
  if (['daily', 'day', 'per day', 'day rate'].includes(s)) return 'daily'
  return null
}

function accountTypeOf(v: unknown): string | null | undefined {
  const s = text(v)?.toLowerCase()
  if (!s) return undefined
  if (s.startsWith('cheque') || s.startsWith('check') || s === 'current') return 'cheque'
  if (s.startsWith('saving')) return 'savings'
  if (s.startsWith('transmission')) return 'transmission'
  return null
}

const ACCESS_WORDS = new Set(['employee', 'manager', 'hr', 'hradmin', 'hr_admin', 'admin', 'worker', 'staff'])
const EMPLOYMENT_WORDS = new Set(['permanent', 'contract', 'part-time', 'student'])

/** One spreadsheet row (header → cell) to an ImportRow plus its problems. `rowNumber` is the sheet row. */
export function parseImportRow(cells: Record<string, unknown>, rowNumber: number): ParsedRow {
  const v: Partial<Record<ImportColumnKey, unknown>> = {}
  for (const [header, value] of Object.entries(cells)) {
    const key = headerKey(header)
    if (key && v[key] == null) v[key] = value
  }
  const errors: string[] = []
  const warnings: string[] = []

  const amount = (key: ImportColumnKey, label: string): number => {
    const n = parseAmount(v[key])
    if (n == null || n < 0) { errors.push(`${label} "${text(v[key])}" is not a valid amount.`); return 0 }
    return n
  }

  const name = text(v.name) ?? ''
  const surname = text(v.surname) ?? ''
  if (!name) errors.push('First name is missing.')

  const accessRaw = text(v.access_level)
  let access = 'employee'
  if (accessRaw) {
    const key = accessRaw.toLowerCase().replace(/[\s-]+/g, '_')
    if (key === 'owner') errors.push('The owner cannot be imported. Leave Access level blank or use Employee, Manager, HR or Admin.')
    else if (!ACCESS_WORDS.has(key.replace(/_/g, '')) && !ACCESS_WORDS.has(key)) errors.push(`Access level "${accessRaw}" is not recognised. Use Employee, Manager, HR or Admin.`)
    else access = ['worker', 'staff'].includes(key) ? 'employee' : normalizeAccessLevel(accessRaw)
  }

  const employmentRaw = text(v.employment_type)
  const employment = normalizeEmploymentType(employmentRaw)
  if (employmentRaw && !EMPLOYMENT_WORDS.has(employment)) {
    errors.push(`Employment type "${employmentRaw}" is not recognised. Use Permanent, Contract, Part-time or Student.`)
  }

  const start = parseDate(v.employment_date)
  if (start === null) errors.push(`Start date "${text(v.employment_date) ?? String(v.employment_date)}" is not a date. Use 2024-03-01 or 01/03/2024.`)

  let days = 5
  if (text(v.work_days_weekly) ?? (typeof v.work_days_weekly === 'number')) {
    const n = parseAmount(v.work_days_weekly)
    if (n == null || n < 1 || n > 7) errors.push(`Work days per week "${text(v.work_days_weekly)}" must be 1 to 7.`)
    else days = n
  }
  let hours = 8
  if (text(v.daily_hours) ?? (typeof v.daily_hours === 'number')) {
    const n = parseAmount(v.daily_hours)
    if (n == null || n <= 0 || n > 24) errors.push(`Daily hours "${text(v.daily_hours)}" must be more than 0 and at most 24.`)
    else hours = n
  }

  const monthly = amount('monthly_salary', 'Monthly salary')
  const hourly = amount('hourly_rate', 'Hourly rate')
  const daily = amount('daily_rate', 'Day rate')

  let basis = payBasisOf(v.pay_basis)
  if (basis === null) {
    errors.push(`Pay basis "${text(v.pay_basis)}" is not recognised. Use Monthly, Hourly or Daily.`)
    basis = undefined
  }
  if (basis === undefined) {
    if (monthly > 0) basis = 'monthly'
    else if (hourly > 0) basis = 'hourly'
    else if (daily > 0) basis = 'daily'
    else { basis = 'monthly'; warnings.push('No salary or rate entered. They will be added with no pay.') }
  }
  const payByHour = basis !== 'monthly'
  const payBasis = basis === 'daily' ? 'daily' as const : basis === 'hourly' ? 'hourly' as const : undefined
  const rateInput = {
    monthlySalary: monthly, payByHour, payBasis: payBasis ?? null,
    hourlyRate: hourly, dailyRate: daily, workDaysWeekly: days, dailyHours: hours,
  }
  if (payByHour) {
    const missing = missingRateMessage(rateInput)
    if (missing && monthly <= 0) errors.push(missing)
  }
  const rates = resolvePayRates(rateInput)

  let paye: number | undefined
  if (text(v.paye_rate_percent) ?? (typeof v.paye_rate_percent === 'number')) {
    const n = parseAmount(String(v.paye_rate_percent).replace('%', ''))
    if (n == null || n < 0 || n > 100) errors.push(`PAYE rate "${text(v.paye_rate_percent)}" must be 0 to 100.`)
    else paye = n
  }
  const uif = yesNo(v.uif_exempt)
  if (uif === null) errors.push(`UIF exempt "${text(v.uif_exempt)}" should be Yes or No.`)

  const account = accountTypeOf(v.account_type)
  if (account === null) errors.push(`Account type "${text(v.account_type)}" is not recognised. Use Cheque, Savings or Transmission.`)

  const email = text(v.email)?.toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Email "${email}" does not look like an email address.`)

  const row: ImportRow = {
    row: rowNumber,
    name,
    surname,
    employee_number: text(v.employee_number),
    email,
    phone: text(v.phone),
    id_number: text(v.id_number)?.replace(/\s+/g, ''),
    position: text(v.position),
    department: text(v.department),
    branch: text(v.branch),
    manager: text(v.manager),
    access_level: access,
    employment_type: EMPLOYMENT_WORDS.has(employment) ? employment : 'permanent',
    employment_date: start ?? undefined,
    time_template: text(v.time_template),
    work_days_weekly: days,
    daily_hours: hours,
    pay_by_hour: payByHour,
    pay_basis: payBasis,
    monthly_salary: Math.round(monthly * 100) / 100,
    hourly_rate: rates.hourlyRate,
    daily_rate: rates.dailyRate,
    paye_rate_percent: paye,
    uif_exempt: uif === true,
    medical_aid: amount('medical_aid', 'Medical aid'),
    pension: amount('pension', 'Pension'),
    union_fee: amount('union_fee', 'Union'),
    bank_name: text(v.bank_name),
    bank_account: text(v.bank_account)?.replace(/\s+/g, ''),
    bank_branch_code: text(v.bank_branch_code)?.replace(/\s+/g, ''),
    account_type: account ?? undefined,
  }
  return { row, errors, warnings }
}

const fullName = (r: ImportRow) => `${r.name} ${r.surname}`.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Parses all rows (as SheetJS gives them: header → cell) and adds the checks that need the whole
 * file: duplicates inside the file, and managers that appear further down the file.
 * `firstDataRow` is the sheet row number of the first data row (2 when row 1 is the header).
 */
export function parseImportSheet(sheetRows: Record<string, unknown>[], headers: string[], firstDataRow = 2): ParseResult {
  const known = new Set(headers.map(h => headerKey(h)).filter(Boolean) as ImportColumnKey[])
  const unknownHeaders = headers.filter(h => h.trim() && !headerKey(h) && !/^__EMPTY/.test(h)
    && !RETIRED_HEADERS.has(h.toLowerCase().replace(/[^a-z0-9]/g, '')))
  const missingColumns = ['name', 'surname'].filter(k => !known.has(k as ImportColumnKey))
    .map(k => IMPORT_COLUMNS.find(c => c.key === k)!.header.replace(' *', ''))

  const rows = sheetRows
    // SheetJS records each row's real position (0-based) in a hidden __rowNum__ property.
    .map((cells, i) => {
      const at = (cells as { __rowNum__?: unknown }).__rowNum__
      return { cells, rowNumber: typeof at === 'number' ? at + 1 : firstDataRow + i }
    })
    // Ignore fully blank lines (Excel often keeps a few at the end).
    .filter(({ cells }) => Object.values(cells).some(c => c instanceof Date || typeof c === 'number' || (c != null && String(c).trim() !== '')))
    .map(({ cells, rowNumber }) => parseImportRow(cells, rowNumber))

  const seen = new Map<string, Map<string, number>>()
  const note = (kind: string, value: string | undefined, p: ParsedRow, label: string) => {
    if (!value) return
    const map = seen.get(kind) ?? new Map<string, number>()
    seen.set(kind, map)
    const key = value.toLowerCase()
    const first = map.get(key)
    if (first != null) p.errors.push(`${label} ${value} is also on row ${first}.`)
    else map.set(key, p.row.row)
  }
  for (const p of rows) {
    note('id', p.row.id_number, p, 'ID number')
    note('email', p.row.email, p, 'Email')
    note('number', p.row.employee_number, p, 'Employee number')
  }

  // Managers named in the file: number, email or full name of another row.
  const byKey = new Map<string, number[]>()
  for (const p of rows) {
    for (const k of [p.row.employee_number?.toLowerCase(), p.row.email, fullName(p.row)]) {
      if (!k) continue
      byKey.set(k, [...(byKey.get(k) ?? []), p.row.row])
    }
  }
  for (const p of rows) {
    const m = p.row.manager?.toLowerCase().replace(/\s+/g, ' ')
    if (!m) continue
    const hits = byKey.get(m)
    if (hits && hits.length === 1 && hits[0] === p.row.row) p.errors.push('A person cannot report to themselves.')
    else if (hits && new Set(hits).size > 1) p.errors.push(`Reports to "${p.row.manager}" matches more than one row in the file. Use their employee number or email.`)
  }

  return { rows, unknownHeaders, missingColumns }
}

/** True when the manager label is someone else in the file (so "not in the company yet" is fine). */
export function managerIsInFile(label: string, rows: ImportRow[]): boolean {
  const m = label.toLowerCase().replace(/\s+/g, ' ')
  return rows.some(r => r.employee_number?.toLowerCase() === m || r.email === m || fullName(r) === m)
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** True when every problem on the row is "this person is already in the company". */
export function isAlreadyInCompany(errors: string[]): boolean {
  return errors.length > 0 && errors.every(e => /already exists|is already used/.test(e))
}

/** "under a second", "1 second", "14 seconds", "2 min 5 s". */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return 'under a second'
  const s = Math.round(seconds)
  if (s < 60) return s === 1 ? '1 second' : `${s} seconds`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

/** CSV of problems for download (opens in Excel). */
export function problemsCsv(problems: { row: number; name: string; problem: string }[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  return ['Row,Name,Problem', ...problems.map(p => `${p.row},${q(p.name)},${q(p.problem)}`)].join('\r\n')
}
