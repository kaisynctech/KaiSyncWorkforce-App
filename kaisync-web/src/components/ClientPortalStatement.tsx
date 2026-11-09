'use client'

import { useEffect, useMemo, useState } from 'react'
import { getLetterhead, getStatement } from '@/lib/client-portal/api'
import { fmtDate } from '@/lib/client-portal/format'
import { moneyZAR } from '@/lib/client-portal/quotation'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import { buildClientStatement, clientStatementToCsv, type ClientStatementEntry } from '@/lib/client-portal/statement'
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

const KIND_LABEL: Record<ClientStatementEntry['kind'], string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  credit_note: 'Credit note',
  refund: 'Refund',
}

const KIND_TABS = [
  TAB_ALL,
  statusTab('invoice', 'Invoices', ['invoice'], 'blue'),
  statusTab('payment', 'Payments', ['payment'], 'green'),
  statusTab('credit_note', 'Credits', ['credit_note'], 'amber'),
  statusTab('refund', 'Refunds', ['refund'], 'slate'),
]

type Cols = {
  reference: string
  description: string
  dateFrom: string
  dateTo: string
  debitMin: string
  debitMax: string
  creditMin: string
  creditMax: string
}
const EMPTY_COLS: Cols = {
  reference: '', description: '', dateFrom: '', dateTo: '',
  debitMin: '', debitMax: '', creditMin: '', creditMax: '',
}
function colsActive(c: Cols) {
  return !!(c.reference || c.description || c.dateFrom || c.dateTo || c.debitMin || c.debitMax || c.creditMin || c.creditMax)
}

/** Payments tab: full statement with running balance, download and print. */
export function ClientPortalStatement({ session }: { session: ClientPortalSession }) {
  const [entries, setEntries] = useState<ClientStatementEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)

  useEffect(() => {
    let cancelled = false
    getStatement(session.company_code, session.client_code)
      .then(e => { if (!cancelled) setEntries(e) })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load your statement.'); setEntries([]) } })
    return () => { cancelled = true }
  }, [session.company_code, session.client_code])

  const st = useMemo(() => buildClientStatement(entries ?? []), [entries])

  const rows = useMemo(
    () => st.lines.map((l, i) => ({ ...l, id: String(i), status: l.kind })),
    [st.lines],
  )

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(l => {
      if (!matchText(l.reference, cols.reference)) return false
      if (!matchText(l.description, cols.description)) return false
      if (!inDateRange(l.entry_date, cols.dateFrom, cols.dateTo)) return false
      if (!matchMoney(l.debit, cols.debitMin, cols.debitMax)) return false
      if (!matchMoney(l.credit, cols.creditMin, cols.creditMax)) return false
      if (!q) return true
      return (l.reference ?? '').toLowerCase().includes(q)
        || l.description.toLowerCase().includes(q)
        || (KIND_LABEL[l.kind] ?? l.kind).toLowerCase().includes(q)
    })
  }, [rows, cols, search])

  const counts = useMemo(() => countByStatusTab(base, KIND_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, KIND_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  function download() {
    const title = `Statement — ${session.client_name}${session.client_code ? ` (${session.client_code})` : ''} — ${new Date().toLocaleDateString('en-ZA')}`
    const blob = new Blob([clientStatementToCsv(st, title)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${session.client_code || 'account'}-${localISODate()}.csv`
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
        fileName: `Statement-${session.client_code || 'account'}-${localISODate()}.pdf`,
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
          <button type="button" onClick={() => void downloadPdf()} disabled={pdfBusy} className="btn-primary">{pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
          <button type="button" onClick={download} className="btn-outlined">Download (CSV)</button>
          <button type="button" onClick={() => window.print()} className="btn-outlined">Print</button>
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
        <PortalEmpty icon="receipt_long" title="No invoices or payments yet" body="Statement lines will appear here as invoices and payments are posted." />
      ) : (
        <div className="space-y-3">
          <PortalListToolbar
            search={search}
            onSearch={v => { setSearch(v); paging.resetPage() }}
            placeholder="Search reference, description, or type…"
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
                <table className="w-full text-[13px]" style={{ minWidth: 720 }}>
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
                      <th className={`${MONEY_TH} text-left`}>Type</th>
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter
                          label="Reference"
                          value={cols.reference}
                          onChange={v => { setCols(c => ({ ...c, reference: v })); paging.resetPage() }}
                          placeholder="Reference…"
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
                      <th className={`${MONEY_TH} text-right`}>
                        <MoneyHeaderFilter
                          label="Debit"
                          min={cols.debitMin}
                          max={cols.debitMax}
                          onChange={p => { setCols(c => ({ ...c, debitMin: p.min, debitMax: p.max })); paging.resetPage() }}
                        />
                      </th>
                      <th className={`${MONEY_TH} text-right`}>
                        <MoneyHeaderFilter
                          label="Credit"
                          min={cols.creditMin}
                          max={cols.creditMax}
                          onChange={p => { setCols(c => ({ ...c, creditMin: p.min, creditMax: p.max })); paging.resetPage() }}
                        />
                      </th>
                      <th className={`${MONEY_TH} text-right`}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paging.pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-[13px] text-text-secondary">No lines match your filters.</td>
                      </tr>
                    ) : paging.pageRows.map(l => (
                      <tr key={l.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} text-text-secondary`}>{fmtDate(l.entry_date)}</td>
                        <td className={`${MONEY_TD} text-text-primary`}>{KIND_LABEL[l.kind] ?? l.kind}</td>
                        <td className={`${MONEY_TD} text-text-secondary`}>{l.reference || '—'}</td>
                        <td className={`${MONEY_TD} text-text-primary`}>{l.description}</td>
                        <td className={`${MONEY_TD} text-right text-text-primary`}>{l.debit ? moneyZAR(l.debit) : ''}</td>
                        <td className={`${MONEY_TD} text-right text-success`}>{l.credit ? moneyZAR(l.credit) : ''}</td>
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

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <div className="border-divider bg-surface rounded-xl border px-3 py-2.5">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-[15px] font-bold mt-0.5 ${tone === 'error' ? 'text-error' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}
