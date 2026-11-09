'use client'

import { useMemo, useState } from 'react'
import { getLetterhead } from '@/lib/contractor-portal/api'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import { buildContractorStatement, statementToCsv } from '@/lib/contractor-portal/statement'
import { moneyZAR, type ContractorPayout } from '@/lib/contractor-portal/types'
import { localISODate } from '@/lib/utils'
import { ResponsiveDataView } from '@/components/ui/ResponsiveDataView'
import { MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab, TAB_ALL } from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter,
  MoneyHeaderFilter,
  DateHeaderFilter,
  matchText,
  matchMoney,
  inDateRange,
  statusTab,
} from '@/components/ui/MoneyListFilters'
import { PortalEmpty, PortalPanel } from '@/components/portal/PortalChrome'
import { PortalListPager, PortalListToolbar, usePortalListPaging } from '@/components/portal/PortalListChrome'

const KIND_TABS = [
  TAB_ALL,
  statusTab('invoice', 'Invoices', ['invoice'], 'blue'),
  statusTab('payment', 'Payments', ['payment'], 'green'),
]

type Cols = {
  description: string
  reference: string
  dateFrom: string
  dateTo: string
  invoicedMin: string
  invoicedMax: string
  paidMin: string
  paidMax: string
}
const EMPTY_COLS: Cols = {
  description: '', reference: '', dateFrom: '', dateTo: '',
  invoicedMin: '', invoicedMax: '', paidMin: '', paidMax: '',
}
function colsActive(c: Cols) {
  return !!(c.description || c.reference || c.dateFrom || c.dateTo || c.invoicedMin || c.invoicedMax || c.paidMin || c.paidMax)
}

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
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)

  const rows = useMemo(
    () => st.lines.map((l, i) => ({
      ...l,
      id: String(i),
      lineStatus: l.status,
      status: l.kind,
    })),
    [st.lines],
  )

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(l => {
      if (!matchText(l.description, cols.description)) return false
      if (!matchText(l.reference, cols.reference)) return false
      if (!inDateRange(l.date, cols.dateFrom, cols.dateTo)) return false
      if (!matchMoney(l.charge, cols.invoicedMin, cols.invoicedMax)) return false
      if (!matchMoney(l.payment, cols.paidMin, cols.paidMax)) return false
      if (!q) return true
      return l.description.toLowerCase().includes(q)
        || l.reference.toLowerCase().includes(q)
        || l.lineStatus.toLowerCase().includes(q)
        || l.kind.toLowerCase().includes(q)
    })
  }, [rows, cols, search])

  const counts = useMemo(() => countByStatusTab(base, KIND_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, KIND_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  async function downloadPdf() {
    setPdfBusy(true)
    setPdfError(null)
    try {
      const [letterhead, { downloadStatementPdf }] = await Promise.all([
        getLetterhead(session.company_code, session.contractor_code),
        import('@/lib/statement-pdf'),
      ])
      downloadStatementPdf({
        letterhead,
        title: 'Payments statement',
        toName: session.contractor_name,
        toCode: session.contractor_code,
        summary: [
          ['Total invoiced', moneyZAR(st.totalInvoiced)],
          ['Total paid', moneyZAR(st.totalPaid)],
          ['Approved, not yet paid', moneyZAR(st.approvedUnpaid)],
          ['Awaiting approval', moneyZAR(st.awaitingApproval)],
        ],
        closing: ['Balance owed to you', moneyZAR(st.balance)],
        columns: [
          { label: 'Date', width: 24 },
          { label: 'Description', width: 64 },
          { label: 'Ref', width: 26 },
          { label: 'Invoiced', width: 20, align: 'right' },
          { label: 'Paid', width: 20, align: 'right' },
          { label: 'Balance', width: 20, align: 'right' },
        ],
        rows: st.lines.map(l => [
          fmtDate(l.date),
          l.kind === 'invoice' && l.status !== 'Paid' ? `${l.description} (${l.status})` : l.description,
          l.reference, l.charge ? moneyZAR(l.charge) : '', l.payment ? moneyZAR(l.payment) : '', moneyZAR(l.balance),
        ]),
        bank: false,
        fileName: `Statement-${session.contractor_code}-${localISODate()}.pdf`,
      })
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Could not create the PDF.')
    }
    setPdfBusy(false)
  }

  function download() {
    const title = `Statement — ${session.contractor_name} (${session.contractor_code}) — ${new Date().toLocaleDateString('en-ZA')}`
    const blob = new Blob([statementToCsv(st, title)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${session.contractor_code}-${localISODate()}.csv`
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
          <button type="button" onClick={() => void downloadPdf()} disabled={pdfBusy} className="btn-primary">
            {pdfBusy ? 'Preparing…' : 'Download PDF'}
          </button>
          <button type="button" onClick={download} className="btn-outlined">Download (CSV)</button>
          <button type="button" onClick={() => window.print()} className="btn-outlined">Print</button>
        </div>
      </div>

      {pdfError && <p className="text-[12px] text-error">{pdfError}</p>}
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
        <PortalEmpty icon="payments" title="No invoices or payments yet" body="Statement lines will appear here as you invoice and get paid." />
      ) : (
        <div className="space-y-3">
          <PortalListToolbar
            search={search}
            onSearch={v => { setSearch(v); paging.resetPage() }}
            placeholder="Search description, ref, or status…"
            resetDisabled={!colsActive(cols) && !search}
            onReset={() => { setCols(EMPTY_COLS); setSearch(''); paging.resetPage() }}
            tabs={KIND_TABS}
            statusTabId={statusTabId}
            counts={counts}
            onStatusChange={id => { setStatusTabId(id); paging.resetPage() }}
          />
          <PortalPanel>
            <ResponsiveDataView
              table={
                <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${MONEY_TH} text-left`}>
                        <DateHeaderFilter
                          label="Date"
                          from={cols.dateFrom}
                          to={cols.dateTo}
                          onChange={p => { setCols(c => ({ ...c, dateFrom: p.from, dateTo: p.to })); paging.resetPage() }}
                        />
                      </th>
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Description"
                          value={cols.description}
                          onChange={v => { setCols(c => ({ ...c, description: v })); paging.resetPage() }}
                          placeholder="Description…"
                        />
                      </th>
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Ref"
                          value={cols.reference}
                          onChange={v => { setCols(c => ({ ...c, reference: v })); paging.resetPage() }}
                          placeholder="Ref…"
                        />
                      </th>
                      <th className={`${MONEY_TH} text-right`}>
                        <MoneyHeaderFilter
                          label="Invoiced"
                          min={cols.invoicedMin}
                          max={cols.invoicedMax}
                          onChange={p => { setCols(c => ({ ...c, invoicedMin: p.min, invoicedMax: p.max })); paging.resetPage() }}
                        />
                      </th>
                      <th className={`${MONEY_TH} text-right`}>
                        <MoneyHeaderFilter
                          label="Paid"
                          min={cols.paidMin}
                          max={cols.paidMax}
                          onChange={p => { setCols(c => ({ ...c, paidMin: p.min, paidMax: p.max })); paging.resetPage() }}
                        />
                      </th>
                      <th className={`${MONEY_TH} text-right`}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paging.pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-[13px] text-text-secondary">No lines match your filters.</td>
                      </tr>
                    ) : paging.pageRows.map(l => (
                      <tr key={l.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(l.date)}</td>
                        <td className={`${MONEY_TD} text-text-primary`}>
                          {l.description}
                          {l.kind === 'invoice' && l.lineStatus !== 'Paid' && (
                            <span className="ml-2 text-[10px] text-text-secondary">({l.lineStatus})</span>
                          )}
                        </td>
                        <td className={`${MONEY_TD} text-text-secondary`}>{l.reference}</td>
                        <td className={`${MONEY_TD} text-right text-text-primary`}>{l.charge ? moneyZAR(l.charge) : ''}</td>
                        <td className={`${MONEY_TD} text-right text-success`}>{l.payment ? moneyZAR(l.payment) : ''}</td>
                        <td className={`${MONEY_TD} text-right font-semibold text-text-primary`}>{moneyZAR(l.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
            <PortalListPager
              page={paging.page}
              pageSize={paging.pageSize}
              total={paging.total}
              onPage={paging.setPage}
              onPageSize={paging.setPageSize}
            />
          </PortalPanel>
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
