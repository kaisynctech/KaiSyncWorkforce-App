/**
 * Contractor statement, built from the contractor's payout records (each invoice the
 * contractor submits, or HR raises, is one payout record).
 *
 * - An invoice adds its total to what is owed to the contractor.
 * - A payment (payout marked paid) takes off the amount actually paid: total minus retention.
 * - Retention stays in the balance until it is released.
 * - Rejected or cancelled invoices are left out.
 */

import { payoutInvoiceReference, payoutIsRejected, payoutJobDisplay, payoutNetPayable, type ContractorPayout } from './types'

export type StatementLine = {
  date: string
  kind: 'invoice' | 'payment'
  reference: string
  description: string
  status: string
  charge: number
  payment: number
  balance: number
}

export type ContractorStatement = {
  lines: StatementLine[]
  totalInvoiced: number
  totalPaid: number
  retentionHeld: number
  awaitingApproval: number
  approvedUnpaid: number
  balance: number
}

function counts(p: ContractorPayout): boolean {
  if (payoutIsRejected(p)) return false
  return (p.payout_status || '').toLowerCase() !== 'cancelled'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildContractorStatement(payouts: ContractorPayout[]): ContractorStatement {
  type Entry = Omit<StatementLine, 'balance'> & { order: number }
  const entries: Entry[] = []
  let totalInvoiced = 0
  let totalPaid = 0
  let retentionHeld = 0
  let awaitingApproval = 0
  let approvedUnpaid = 0

  for (const p of payouts) {
    if (!counts(p)) continue
    const status = (p.payout_status || '').toLowerCase()
    const ref = payoutInvoiceReference(p)
    const job = payoutJobDisplay(p)
    const total = p.total_amount || 0
    totalInvoiced += total
    entries.push({
      date: p.created_at || '',
      kind: 'invoice',
      reference: ref,
      description: job === '—' ? 'Invoice' : `Invoice · ${job}`,
      status: status === 'paid' ? 'Paid' : status === 'approved' ? 'Approved' : 'Awaiting approval',
      charge: total,
      payment: 0,
      order: 0,
    })
    if (status === 'paid') {
      const net = payoutNetPayable(p)
      totalPaid += net
      retentionHeld += p.retention_amount || 0
      entries.push({
        date: p.paid_at || p.payout_date || p.created_at || '',
        kind: 'payment',
        reference: ref,
        description: (p.retention_amount || 0) > 0
          ? `Payment · ${job} (retention held)`
          : `Payment · ${job}`,
        status: 'Paid',
        charge: 0,
        payment: net,
        order: 1,
      })
    } else if (status === 'approved') {
      approvedUnpaid += payoutNetPayable(p)
    } else {
      awaitingApproval += payoutNetPayable(p)
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order))
  let running = 0
  const lines: StatementLine[] = entries.map(e => {
    running = round2(running + e.charge - e.payment)
    return {
      date: e.date, kind: e.kind, reference: e.reference, description: e.description,
      status: e.status, charge: e.charge, payment: e.payment, balance: running,
    }
  })

  return {
    lines,
    totalInvoiced: round2(totalInvoiced),
    totalPaid: round2(totalPaid),
    retentionHeld: round2(retentionHeld),
    awaitingApproval: round2(awaitingApproval),
    approvedUnpaid: round2(approvedUnpaid),
    balance: round2(totalInvoiced - totalPaid),
  }
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function statementToCsv(st: ContractorStatement, title: string): string {
  const rows: (string | number)[][] = [
    [title],
    [],
    ['Date', 'Type', 'Reference', 'Description', 'Status', 'Invoiced', 'Paid', 'Balance'],
    ...st.lines.map(l => [
      l.date ? l.date.slice(0, 10) : '',
      l.kind === 'invoice' ? 'Invoice' : 'Payment',
      l.reference,
      l.description,
      l.status,
      l.charge ? l.charge.toFixed(2) : '',
      l.payment ? l.payment.toFixed(2) : '',
      l.balance.toFixed(2),
    ]),
    [],
    ['Total invoiced', st.totalInvoiced.toFixed(2)],
    ['Total paid', st.totalPaid.toFixed(2)],
    ['Retention held', st.retentionHeld.toFixed(2)],
    ['Balance', st.balance.toFixed(2)],
  ]
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}
