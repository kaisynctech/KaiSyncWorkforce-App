import { describe, expect, it } from 'vitest'
import { buildContractorStatement, statementToCsv } from './statement'
import type { ContractorPayout } from './types'

function payout(p: Partial<ContractorPayout>): ContractorPayout {
  return {
    id: p.id ?? 'x', company_id: 'c', contractor_id: 'k', job_id: 'j', job_contractor_id: null,
    subtotal: 0, vat_amount: 0, total_amount: 0, retention_amount: 0,
    payout_status: 'pending', approval_status: 'pending', rejection_reason: null, notes: null,
    payout_date: null, approved_at: null, paid_at: null, created_at: '2026-06-01T10:00:00Z',
    job_title: 'Job', job_code: 'J1', ...p,
  }
}

describe('buildContractorStatement', () => {
  it('invoices add, payments subtract net of retention, rejected left out', () => {
    const st = buildContractorStatement([
      payout({ id: 'a', total_amount: 1000, retention_amount: 100, payout_status: 'paid', paid_at: '2026-06-10T00:00:00Z', notes: 'INV-1' }),
      payout({ id: 'b', total_amount: 500, payout_status: 'approved', created_at: '2026-06-05T00:00:00Z' }),
      payout({ id: 'c', total_amount: 300, created_at: '2026-06-07T00:00:00Z' }),
      payout({ id: 'd', total_amount: 999, approval_status: 'rejected', payout_status: 'cancelled' }),
    ])
    expect(st.totalInvoiced).toBe(1800)
    expect(st.totalPaid).toBe(900)
    expect(st.retentionHeld).toBe(100)
    expect(st.approvedUnpaid).toBe(500)
    expect(st.awaitingApproval).toBe(300)
    expect(st.balance).toBe(900)
    expect(st.lines.map(l => [l.kind, l.balance])).toEqual([
      ['invoice', 1000], ['invoice', 1500], ['invoice', 1800], ['payment', 900],
    ])
    expect(st.lines[0].reference).toBe('INV-1')
  })

  it('empty list gives a zero statement', () => {
    const st = buildContractorStatement([])
    expect(st.lines).toEqual([])
    expect(st.balance).toBe(0)
  })

  it('csv quotes commas', () => {
    const csv = statementToCsv(buildContractorStatement([payout({ total_amount: 10, job_title: 'A, B' })]), 'Statement')
    expect(csv).toContain('"Invoice · J1 · A, B"')
  })
})
