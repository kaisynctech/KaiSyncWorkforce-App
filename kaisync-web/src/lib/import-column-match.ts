import { acceptColumnMap, columnSamples, unknownHeaders, type ColumnCopy, type ImportKind, type ProposedColumn } from '@/lib/import-column-map'

export type ImportColumnMatch = {
  copies: ColumnCopy[]
  unsure: string[]
  unavailable: boolean
}

/** Asks the server to name columns this importer does not already know. A failure leaves those columns unmatched. */
export async function matchImportColumns(
  kind: ImportKind,
  headers: string[],
  rows: Record<string, unknown>[],
): Promise<ImportColumnMatch> {
  const unknown = unknownHeaders(kind, headers).slice(0, 40)
  if (unknown.length === 0) return { copies: [], unsure: [], unavailable: false }
  try {
    const response = await fetch('/api/ai/import-column-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, columns: columnSamples(unknown, rows) }),
    })
    if (!response.ok) return { copies: [], unsure: unknown, unavailable: true }
    const body = await response.json() as { columns?: ProposedColumn[] }
    const copies = acceptColumnMap(kind, unknown, Array.isArray(body.columns) ? body.columns : [])
    const used = new Set(copies.map(copy => copy.from))
    return { copies, unsure: unknown.filter(header => !used.has(header)), unavailable: false }
  } catch {
    return { copies: [], unsure: unknown, unavailable: true }
  }
}

export function columnMatchNotes(match: ImportColumnMatch): string[] {
  const notes: string[] = []
  if (match.copies.length > 0) {
    notes.push(`Matched ${match.copies.map(copy => `${copy.from} to ${copy.to}`).join(', ')}. The cell values are copied as they appear in the file.`)
  }
  if (match.unavailable) {
    notes.push('Column matching is unavailable, so only headings this import already knows are used.')
  } else if (match.unsure.length > 0) {
    notes.push(`These columns were not matched and are not imported: ${match.unsure.join(', ')}.`)
  }
  return notes
}
