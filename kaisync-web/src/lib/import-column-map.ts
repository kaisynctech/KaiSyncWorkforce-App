/**
 * Matches a spreadsheet's own headings to the client and employee import columns.
 * Cell values are copied onto the column the importer already understands.
 * Nothing here rewrites a name, ID number, or bank account.
 */
import { IMPORT_COLUMNS, headerKey } from '@/lib/employee-import'

export type ImportKind = 'clients' | 'employees'

export type ColumnCopy = { from: string; to: string }

export type ProposedColumn = { header: string; field: string; confident: boolean }

type FieldDef = { id: string; header: string; aliases: string[] }

const CLIENT_FIELDS: FieldDef[] = [
  { id: 'name', header: 'Name', aliases: ['Name', 'Client Name', 'Company Name', 'Customer', 'Customer Name', 'Client', 'Company'] },
  { id: 'type', header: 'Type', aliases: ['Type', 'Client Type', 'ClientType'] },
  { id: 'contact_person', header: 'Contact Person', aliases: ['Contact Person', 'ContactPerson', 'Contact'] },
  { id: 'phone', header: 'Phone', aliases: ['Phone', 'Telephone', 'Phone Number', 'Tel'] },
  { id: 'mobile', header: 'Mobile', aliases: ['Mobile', 'Mobile Number', 'MobileNumber', 'Cell', 'Cellphone'] },
  { id: 'direct_line', header: 'Direct Line', aliases: ['Direct Line', 'DirectLine', 'DDI', 'DDINumber'] },
  { id: 'fax', header: 'Fax', aliases: ['Fax', 'Fax Number', 'FaxNumber'] },
  { id: 'email', header: 'Email', aliases: ['Email', 'Email Address', 'EmailAddress'] },
  { id: 'address', header: 'Address', aliases: ['Address', 'Street', 'Physical Address', 'Postal Address'] },
  { id: 'notes', header: 'Notes', aliases: ['Notes', 'Note', 'Comments'] },
  { id: 'account_number', header: 'Account Number', aliases: ['Account Number', 'AccountNumber', 'Account No'] },
  { id: 'legal_name', header: 'Legal Name', aliases: ['Legal Name', 'LegalName'] },
  { id: 'company_number', header: 'Company Number', aliases: ['Company Number', 'CompanyNumber', 'Registration Number', 'Reg No'] },
  { id: 'website', header: 'Website', aliases: ['Website', 'Web'] },
  { id: 'bank_account_holder', header: 'Bank Account Holder', aliases: ['Bank Account Holder', 'BankAccountName', 'Account Holder', 'Account Name'] },
  { id: 'bank_name', header: 'Bank Name', aliases: ['Bank Name', 'BankName', 'Bank'] },
  { id: 'bank_account_number', header: 'Bank Account Number', aliases: ['Bank Account Number', 'BankAccountNumber'] },
  { id: 'branch_code', header: 'Branch Code', aliases: ['Branch Code', 'Bank Branch Code', 'BranchCode'] },
]

function compact(header: string): string {
  return header.replace(/\*/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function fieldsForKind(kind: ImportKind): { id: string; header: string }[] {
  if (kind === 'clients') return CLIENT_FIELDS.map(field => ({ id: field.id, header: field.header }))
  return IMPORT_COLUMNS.map(column => ({ id: column.key, header: column.header.replace(' *', '') }))
}

export function knownCanonicalHeader(kind: ImportKind, header: string): string | null {
  const key = compact(header)
  if (!key) return null
  if (kind === 'clients') {
    const field = CLIENT_FIELDS.find(item => item.aliases.some(alias => compact(alias) === key))
    return field?.header ?? null
  }
  const columnKey = headerKey(header)
  if (!columnKey) return null
  return IMPORT_COLUMNS.find(column => column.key === columnKey)?.header.replace(' *', '') ?? null
}

/** Headings the importer does not already understand. Blank and repeated headings are dropped. */
export function unknownHeaders(kind: ImportKind, headers: string[]): string[] {
  const seen = new Set<string>()
  const unknown: string[] = []
  for (const header of headers) {
    const trimmed = header.trim()
    if (!trimmed || trimmed.startsWith('__EMPTY')) continue
    if (knownCanonicalHeader(kind, trimmed)) continue
    const key = compact(trimmed)
    if (kind === 'employees' && key === 'workertype') continue
    if (!key || seen.has(key)) continue
    seen.add(key)
    unknown.push(header)
  }
  return unknown
}

/** Up to three real cell values for each heading, so a column can be recognised. */
export function columnSamples(
  headers: string[],
  rows: Record<string, unknown>[],
  perColumn = 3,
): { header: string; samples: string[] }[] {
  return headers.map(header => {
    const samples: string[] = []
    for (const row of rows) {
      const raw = row[header]
      if (raw == null) continue
      const text = raw instanceof Date
        ? (Number.isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10))
        : String(raw).trim()
      if (!text) continue
      samples.push(text.slice(0, 200))
      if (samples.length >= perColumn) break
    }
    return { header, samples }
  })
}

/** Keeps only confident matches to a real field. One field is used once. Values are not touched. */
export function acceptColumnMap(kind: ImportKind, unknown: string[], proposed: ProposedColumn[]): ColumnCopy[] {
  const allowed = new Set(unknown)
  const fields = new Map(fieldsForKind(kind).map(field => [field.id, field.header]))
  const usedFields = new Set<string>()
  const usedHeaders = new Set<string>()
  const copies: ColumnCopy[] = []
  for (const item of proposed) {
    if (!item.confident || item.field === 'ignore') continue
    if (!allowed.has(item.header) || usedFields.has(item.field) || usedHeaders.has(item.header)) continue
    const to = fields.get(item.field)
    if (!to) continue
    usedFields.add(item.field)
    usedHeaders.add(item.header)
    copies.push({ from: item.header, to })
  }
  return copies
}

/** Copies each matched cell onto the heading the importer already reads. Existing values stay. */
export function applyColumnCopies<T extends Record<string, unknown>>(rows: T[], copies: ColumnCopy[]): T[] {
  if (copies.length === 0) return rows
  return rows.map(row => {
    const next: Record<string, unknown> = { ...row }
    for (const copy of copies) {
      const current = next[copy.to]
      if (current != null && String(current).trim() !== '') continue
      const value = row[copy.from]
      if (value == null || String(value).trim() === '') continue
      next[copy.to] = value
    }
    return next as T
  })
}
