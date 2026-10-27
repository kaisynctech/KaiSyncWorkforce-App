'use client'

import { useEffect, useMemo, useState } from 'react'
import { getLetterhead, getStatement } from '@/lib/client-portal/api'
import { fmtDate } from '@/lib/client-portal/format'
import { moneyZAR } from '@/lib/client-portal/quotation'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import { buildClientStatement, clientStatementToCsv, type ClientStatementEntry } from '@/lib/client-portal/statement'
import { localISODate } from '@/lib/utils'

const KIND_LABEL: Record<ClientStatementEntry['kind'], string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  credit_note: 'Credit note',
  refund: 'Refund',
}

/** Payments tab: full statement with running balance, download and print. */
export function ClientPortalStatement({ session }: { session: ClientPortalSession }) {
  const [entries, setEntries] = useState<ClientStatementEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getStatement(session.company_code, session.client_code)
      .then(e => { if (!cancelled) setEntries(e) })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load your statement.'); setEntries([]) } })
    return () => { cancelled = true }
  }, [session.company_code, session.client_code])

  const st = useMemo(() => buildClientStatement(entries ?? []), [entries])

  function download() {
    const title = `Statement — ${session.client_name} (${session.client_code}) — ${new Date().toLocaleDateString('en-ZA')}`
    const blob = new Blob([clientStatementToCsv(st, title)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${session.client_code}-${localISODate()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function downloadPdf() {
    setPdfBusy(true)
    setError(null)
    try {
      const [letterhead, { downloadStatementPdf }] = await Promise.all([
        getLetterhead(session.company_code, session.client_code),
        import('@/lib/statement-pdf'),
      ])
      downloadStatementPdf({
        letterhead,
        title: 'Statement of account',
        toName: session.client_name,
        toCode: session.client_code,
        summary: [
          ['Total invoiced', moneyZAR(st.totalInvoiced)],
          ['Total paid', moneyZAR(st.totalPaid)],
          ['Credit notes', moneyZAR(st.totalCredited)],
          ['Overdue', moneyZAR(st.overdue)],
        ],
        closing: [st.balance < 0 ? 'In credit' : 'Balance owing', moneyZAR(Math.abs(st.balance))],
        columns: [
          { label: 'Date', width: 22 },
          { label: 'Type', width: 22 },
          { label: 'Reference', width: 24 },
          { label: 'Description', width: 46 },
          { label: 'Debit', width: 20, align: 'right' },
          { label: 'Credit', width: 20, align: 'right' },
          { label: 'Balance', width: 20, align: 'right' },
        ],
        rows: st.lines.map(l => [
          fmtDate(l.entry_date), KIND_LABEL[l.kind] ?? l.kind, l.reference || '—', l.description,
          l.debit ? moneyZAR(l.debit) : '', l.credit ? moneyZAR(l.credit) : '', moneyZAR(l.balance),
        ]),
        bank: st.balance > 0,
        fileName: `Statement-${session.client_code}-${localISODate()}.pdf`,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the PDF.')
    }
    setPdfBusy(false)
  }

  if (entries === null) return <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-text-secondary">Everything we have invoiced, what you have paid, and any credits or refunds.</p>
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={() => void downloadPdf()} disabled={pdfBusy} className="h-9 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-60">{pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
          <button type="button" onClick={download} className="h-9 px-3 rounded-lg border border-divider text-[12px] font-semibold text-text-primary">Download (CSV)</button>
          <button type="button" onClick={() => window.print()} className="h-9 px-3 rounded-lg border border-divider text-[12px] font-semibold text-text-primary">Print</button>
        </div>
      </div>
      {error && <div className="bg-error/10 border border-error/25 rounded-xl px-4 py-3 text-[13px] text-error font-semibold">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label="Total invoiced" value={moneyZAR(st.totalInvoiced)} />
        <Tile label="Total paid" value={moneyZAR(st.totalPaid)} />
        <Tile label="Credit notes" value={moneyZAR(st.totalCredited)} />
        <Tile label="Overdue" value={moneyZAR(st.overdue)} tone={st.overdue > 0 ? 'error' : undefined} />
      </div>
      <div className="border-divider bg-surface rounded-xl border px-4 py-3 flex justify-between gap-3 text-[13px]">
        <span className="text-text-secondary">{st.balance < 0 ? 'You are in credit' : 'Balance owing'}</span>
        <span className="font-bold text-text-primary">{moneyZAR(Math.abs(st.balance))}</span>
      </div>

      {st.lines.length === 0 ? (
        <div className="py-16 text-center text-text-secondary text-[13px]">No invoices or payments yet.</div>
      ) : (
        <div className="border-divider bg-surface rounded-xl border overflow-x-auto">
          <table className="w-full text-[12px] min-w-[600px]">
            <thead>
              <tr className="text-left text-text-secondary border-b border-divider">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold text-right">Debit</th>
                <th className="px-3 py-2 font-semibold text-right">Credit</th>
                <th className="px-3 py-2 font-semibold text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l, i) => (
                <tr key={i} className="border-b border-divider last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-text-secondary">{fmtDate(l.entry_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-primary">{KIND_LABEL[l.kind] ?? l.kind}</td>
                  <td className="px-3 py-2 text-text-secondary">{l.reference || '—'}</td>
                  <td className="px-3 py-2 text-text-primary">{l.description}</td>
                  <td className="px-3 py-2 text-right text-text-primary">{l.debit ? moneyZAR(l.debit) : ''}</td>
                  <td className="px-3 py-2 text-right text-success">{l.credit ? moneyZAR(l.credit) : ''}</td>
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

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <div className="border-divider bg-surface rounded-xl border px-3 py-2.5">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-[15px] font-bold mt-0.5 ${tone === 'error' ? 'text-error' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}
