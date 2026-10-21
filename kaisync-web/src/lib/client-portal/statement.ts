/**
 * Client statement: invoices we issued, payments received, credit notes and refunds,
 * with a running balance (positive = the client owes us; negative = in credit).
 * Rows come from client_portal_get_statement, already in date order.
 */

export type ClientStatementEntry = {
  entry_date: string
  kind: 'invoice' | 'payment' | 'credit_note' | 'refund'
  invoice_id: string | null
  reference: string | null
  description: string
  debit: number
  credit: number
  due_date: string | null
  status: string | null
}

export type ClientStatementLine = ClientStatementEntry & { balance: number }

export type ClientStatement = {
  lines: ClientStatementLine[]
  totalInvoiced: number
  totalPaid: number
  totalCredited: number
  totalRefunded: number
  balance: number
  overdue: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function parseStatementEntries(raw: unknown): ClientStatementEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(r => {
    const row = r as Record<string, unknown>
    const kind = String(row.kind ?? 'invoice') as ClientStatementEntry['kind']
    return {
      entry_date: String(row.entry_date ?? ''),
      kind,
      invoice_id: row.invoice_id ? String(row.invoice_id) : null,
      reference: row.reference ? String(row.reference) : null,
      description: String(row.description ?? ''),
      debit: Number(row.debit ?? 0) || 0,
      credit: Number(row.credit ?? 0) || 0,
      due_date: row.due_date ? String(row.due_date) : null,
      status: row.status ? String(row.status) : null,
    }
  })
}

export function buildClientStatement(entries: ClientStatementEntry[], today = new Date().toISOString().slice(0, 10)): ClientStatement {
  let running = 0
  let totalInvoiced = 0
  let totalPaid = 0
  let totalCredited = 0
  let totalRefunded = 0
  const lines = entries.map(e => {
    running = round2(running + e.debit - e.credit)
    if (e.kind === 'invoice') totalInvoiced += e.debit
    if (e.kind === 'payment') totalPaid += e.credit
    if (e.kind === 'credit_note') totalCredited += e.credit
    if (e.kind === 'refund') totalRefunded += e.debit
    return { ...e, balance: running }
  })
  // Overdue: invoices past due, less what was paid or credited against each.
  const perInvoice = new Map<string, { due: string | null; open: number }>()
  for (const e of entries) {
    if (!e.invoice_id) continue
    const cur = perInvoice.get(e.invoice_id) ?? { due: null, open: 0 }
    if (e.kind === 'invoice') cur.due = e.due_date
    if (e.kind === 'invoice' || e.kind === 'refund') cur.open += e.debit
    else cur.open -= e.credit
    perInvoice.set(e.invoice_id, cur)
  }
  let overdue = 0
  for (const v of perInvoice.values()) if (v.due && v.due < today && v.open > 0.009) overdue += v.open
  return {
    lines,
    totalInvoiced: round2(totalInvoiced),
    totalPaid: round2(totalPaid),
    totalCredited: round2(totalCredited),
    totalRefunded: round2(totalRefunded),
    balance: running,
    overdue: round2(overdue),
  }
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function clientStatementToCsv(st: ClientStatement, title: string): string {
  const rows: (string | number)[][] = [
    [title], [],
    ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
    ...st.lines.map(l => [
      l.entry_date, l.kind.replace('_', ' '), l.reference ?? '', l.description,
      l.debit ? l.debit.toFixed(2) : '', l.credit ? l.credit.toFixed(2) : '', l.balance.toFixed(2),
    ]),
    [],
    ['Total invoiced', st.totalInvoiced.toFixed(2)],
    ['Total paid', st.totalPaid.toFixed(2)],
    ['Credit notes', st.totalCredited.toFixed(2)],
    ['Refunds', st.totalRefunded.toFixed(2)],
    ['Balance', st.balance.toFixed(2)],
  ]
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}
