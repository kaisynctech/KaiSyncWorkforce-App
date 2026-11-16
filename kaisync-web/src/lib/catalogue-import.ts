/**
 * Import a price list (Excel / CSV) into the catalogue (quote_catalogue_items).
 * Pure helpers: guess which column is which, read each row, and decide new / update / skip.
 * Existing items are found by part no. (sku) first, then by exact name, so re-importing updates instead of
 * duplicating. Stock on hand is only set for new items: existing stock changes through stock movements.
 */

export type ImportField =
  | 'name' | 'sku' | 'oem' | 'kind' | 'brand' | 'condition' | 'description' | 'unit'
  | 'cost' | 'price' | 'qty' | 'reorder' | 'bin'

export const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'sku', label: 'Part no. / code' },
  { key: 'oem', label: 'OEM no.' },
  { key: 'kind', label: 'Kind (part, service, material, labour)' },
  { key: 'brand', label: 'Brand' },
  { key: 'condition', label: 'Condition' },
  { key: 'description', label: 'Description' },
  { key: 'unit', label: 'Unit' },
  { key: 'cost', label: 'Cost price' },
  { key: 'price', label: 'Selling price' },
  { key: 'qty', label: 'Stock on hand (new items)' },
  { key: 'reorder', label: 'Reorder at' },
  { key: 'bin', label: 'Bin / location' },
]

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'item', 'item name', 'product', 'product name', 'description short', 'title'],
  sku: ['sku', 'code', 'item code', 'part no', 'part number', 'partno', 'part #', 'stock code', 'product code'],
  oem: ['oem', 'oem no', 'oem number', 'oem part', 'manufacturer code'],
  kind: ['kind', 'type', 'item type', 'category'],
  brand: ['brand', 'make', 'manufacturer'],
  condition: ['condition', 'state', 'new/used'],
  description: ['description', 'details', 'notes', 'long description'],
  unit: ['unit', 'uom', 'unit of measure', 'units'],
  cost: ['cost', 'cost price', 'buy price', 'purchase price', 'unit cost', 'cost excl', 'cost ex vat'],
  price: ['price', 'sell', 'sell price', 'selling price', 'retail', 'retail price', 'price excl', 'price ex vat', 'unit price'],
  qty: ['qty', 'quantity', 'on hand', 'stock', 'qty on hand', 'soh', 'stock on hand'],
  reorder: ['reorder', 'reorder at', 'reorder point', 'reorder level', 'min', 'minimum'],
  bin: ['bin', 'bin location', 'location', 'shelf'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#/]+/g, ' ').trim()

/** Best guess of which file column holds each field (each column used once). */
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {}
  const used = new Set<string>()
  for (const field of IMPORT_FIELDS.map(f => f.key)) {
    const syn = SYNONYMS[field]
    const exact = headers.find(h => !used.has(h) && syn.includes(norm(h)))
    const loose = exact ?? headers.find(h => !used.has(h) && syn.some(s => s.length > 3 && norm(h).includes(s)))
    if (loose) { out[field] = loose; used.add(loose) }
  }
  return out
}

export type CatalogueKind = 'part' | 'service' | 'material' | 'labour' | 'package' | 'fee' | 'hire'

export function readKind(raw: string, fallback: CatalogueKind): CatalogueKind | null {
  const v = norm(raw)
  if (!v) return fallback
  if (/^(part|parts|product|products|stock|spare|spares|goods)$/.test(v)) return 'part'
  if (/^(service|services)$/.test(v)) return 'service'
  if (/^(material|materials|consumable|consumables)$/.test(v)) return 'material'
  if (/^(labour|labor|hours|hourly)$/.test(v)) return 'labour'
  if (/^(package|packages|bundle|bundles|kit|kits)$/.test(v)) return 'package'
  if (/^(fee|fees|charge|charges|call ?out)$/.test(v)) return 'fee'
  if (/^(hire|rental|rentals|rent)$/.test(v)) return 'hire'
  return null
}

/** "R 1 234,50", "1,234.50", "1234.5" → 1234.5; blank → null; not a number → NaN. */
export function readMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/[R$€£\s ]/g, '')
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')        // 1,234.50
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')                // 1234,50
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,50
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

export type Existing = { id: string; name: string; sku: string | null }

export type PlannedRow = {
  line: number
  action: 'new' | 'update' | 'skip'
  problems: string[]
  name: string
  sku: string | null
  oem: string | null
  kind: CatalogueKind
  brand: string | null
  condition: string | null
  description: string | null
  unit: string | null
  cost: number | null
  price: number | null
  qty: number | null
  reorder: number | null
  bin: string | null
  existingId: string | null
}

const cell = (row: Record<string, unknown>, col: string | undefined) =>
  col === undefined ? '' : String(row[col] ?? '').trim()

export function planImport(
  rows: Record<string, unknown>[],
  mapping: Partial<Record<ImportField, string>>,
  existing: Existing[],
  defaultKind: CatalogueKind,
): PlannedRow[] {
  const bySku = new Map<string, Existing>()
  const byName = new Map<string, Existing>()
  for (const e of existing) {
    if (e.sku) bySku.set(e.sku.trim().toLowerCase(), e)
    byName.set(e.name.trim().toLowerCase(), e)
  }
  const seen = new Set<string>()
  return rows.map((row, i) => {
    const problems: string[] = []
    const name = cell(row, mapping.name)
    const sku = cell(row, mapping.sku) || null
    const kind = readKind(cell(row, mapping.kind), defaultKind)
    const num = (f: ImportField, label: string) => {
      const v = mapping[f] === undefined ? null : readMoney(row[mapping[f] as string])
      if (v !== null && Number.isNaN(v)) { problems.push(`${label} isn't a number`); return null }
      if (v !== null && v < 0) { problems.push(`${label} can't be below zero`); return null }
      return v
    }
    const cost = num('cost', 'Cost price')
    const price = num('price', 'Selling price')
    const qty = num('qty', 'Stock on hand')
    const reorder = num('reorder', 'Reorder at')
    if (!name) problems.push('No name')
    if (kind === null) problems.push(`Kind "${cell(row, mapping.kind)}" isn't part, service, material or labour`)
    const key = (sku ?? name).toLowerCase()
    if (key && seen.has(key)) problems.push('Appears twice in the file')
    if (key) seen.add(key)
    const match = (sku && bySku.get(sku.toLowerCase())) || (name ? byName.get(name.toLowerCase()) : undefined) || null
    const blocking = problems.length > 0
    return {
      line: i + 2, // header is line 1
      action: blocking ? 'skip' : match ? 'update' : 'new',
      problems,
      name, sku,
      oem: cell(row, mapping.oem) || null,
      kind: kind ?? defaultKind,
      brand: cell(row, mapping.brand) || null,
      condition: cell(row, mapping.condition) || null,
      description: cell(row, mapping.description) || null,
      unit: cell(row, mapping.unit) || null,
      cost, price, qty, reorder,
      bin: cell(row, mapping.bin) || null,
      existingId: match?.id ?? null,
    }
  })
}
