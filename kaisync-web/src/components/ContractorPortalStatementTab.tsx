'use client'

import { useMemo } from 'react'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import { buildContractorStatement, statementToCsv } from '@/lib/contractor-portal/statement'
import { moneyZAR, type ContractorPayout } from '@/lib/contractor-portal/types'

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Payments tab: what has been paid, what is still owed, and a full statement. */
export function ContractorPortalStatementTab({
  session,
  payouts,
}: {
  session: ContractorPortalSession
  payouts: ContractorPayout[]
}) {
  const st = useMemo(() => buildContractorStatement(payouts), [payouts])

  function download() {
    const title = `Statement — ${session.contractor_name} (${session.contractor_code}) — ${new Date().toLocaleDateString('en-ZA')}`
    const blob = new Blob([statementToCsv(st, title)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${session.contractor_code}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-text-primary text-[18px] font-bold">Payments &amp; statement</h2>
          <p className="text-[12px] text-text-secondary mt-0.5">Everything you have invoiced and been paid.</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={download} className="h-9 px-3 rounded-lg border border-divider text-[12px] font-semibold text-text-primary">
            Download (CSV)
          </button>
          <button type="button" onClick={() => window.print()} className="h-9 px-3 rounded-lg border border-divider text-[12px] font-semibold text-text-primary">
            Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label="Total invoiced" value={moneyZAR(st.totalInvoiced)} />
        <Tile label="Total paid" value={moneyZAR(st.totalPaid)} />
        <Tile label="Approved, not yet paid" value={moneyZAR(st.approvedUnpaid)} />
        <Tile label="Awaiting approval" value={moneyZAR(st.awaitingApproval)} />
      </div>
      <div className="border-divider bg-surface rounded-xl border px-4 py-3 flex justify-between gap-3 text-[13px]">
        <span className="text-text-secondary">
          Balance owed to you{st.retentionHeld > 0 ? ` (includes ${moneyZAR(st.retentionHeld)} retention held)` : ''}
        </span>
        <span className="font-bold text-text-primary">{moneyZAR(st.balance)}</span>
      </div>

      {st.lines.length === 0 ? (
        <div className="py-16 text-center text-text-secondary text-[13px]">No invoices or payments yet.</div>
      ) : (
        <div className="border-divider bg-surface rounded-xl border overflow-x-auto">
          <table className="w-full text-[12px] min-w-[560px]">
            <thead>
              <tr className="text-left text-text-secondary border-b border-divider">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold">Ref</th>
                <th className="px-3 py-2 font-semibold text-right">Invoiced</th>
                <th className="px-3 py-2 font-semibold text-right">Paid</th>
                <th className="px-3 py-2 font-semibold text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l, i) => (
                <tr key={i} className="border-b border-divider last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-text-secondary">{fmtDate(l.date)}</td>
                  <td className="px-3 py-2 text-text-primary">
                    {l.description}
                    {l.kind === 'invoice' && l.status !== 'Paid' && (
                      <span className="ml-2 text-[10px] text-text-secondary">({l.status})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{l.reference}</td>
                  <td className="px-3 py-2 text-right text-text-primary">{l.charge ? moneyZAR(l.charge) : ''}</td>
                  <td className="px-3 py-2 text-right text-success">{l.payment ? moneyZAR(l.payment) : ''}</td>
                  <td className="px-3 py-2 text-right font-semibold text-text-primary">{moneyZAR(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-divider bg-surface rounded-xl border px-3 py-2.5">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-[15px] font-bold text-text-primary mt-0.5">{value}</p>
    </div>
  )
}
