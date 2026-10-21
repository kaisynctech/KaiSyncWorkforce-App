import { describe, expect, it } from 'vitest'
import { buildClientStatement, clientStatementToCsv, parseStatementEntries } from './statement'

// Same shape as client_portal_get_statement returned for a test invoice (verified on the DB, rolled back).
const rows = [
  { entry_date: '2026-10-01', kind: 'invoice', invoice_id: 'a', reference: 'T-INV-1', description: 'Invoice T-INV-1', debit: 1150, credit: 0, due_date: '2026-10-31', status: 'partially_paid' },
  { entry_date: '2026-10-01', kind: 'payment', invoice_id: 'a', reference: 'T-INV-1', description: 'Payment received', debit: 0, credit: 200 },
  { entry_date: '2026-10-05', kind: 'payment', invoice_id: 'a', reference: 'EFT-1', description: 'Payment received (eft)', debit: 0, credit: 500 },
  { entry_date: '2026-10-10', kind: 'credit_note', invoice_id: 'a', reference: 'T-CN-1', description: 'Credit note', debit: 0, credit: 100 },
  { entry_date: '2026-10-10', kind: 'refund', invoice_id: 'a', reference: 'T-CN-1', description: 'Refund paid to you', debit: 40, credit: 0 },
]

describe('client statement', () => {
  it('running balance and totals', () => {
    const st = buildClientStatement(parseStatementEntries(rows), '2026-10-20')
    expect(st.lines.map(l => l.balance)).toEqual([1150, 950, 450, 350, 390])
    expect(st.totalInvoiced).toBe(1150)
    expect(st.totalPaid).toBe(700)
    expect(st.totalCredited).toBe(100)
    expect(st.totalRefunded).toBe(40)
    expect(st.balance).toBe(390)
    expect(st.overdue).toBe(0)
  })
  it('overdue after the due date', () => {
    expect(buildClientStatement(parseStatementEntries(rows), '2026-11-05').overdue).toBe(390)
  })
  it('bad input gives an empty statement; csv has the balance', () => {
    expect(buildClientStatement(parseStatementEntries(null)).lines).toEqual([])
    expect(clientStatementToCsv(buildClientStatement(parseStatementEntries(rows)), 'S')).toContain('Balance,390.00')
  })
})
