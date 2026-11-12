'use client'

/**
 * Quotes in the client portal and a linked company's view of its provider:
 *  - PortalQuotesWaiting: the "waiting for your answer" cards on the dashboard,
 *  - PortalQuotesTable: every quote (waiting first) on the Quotes tab.
 * Each quote opens the same secure quote page the email links to (/d/<token>): the client sees it, downloads the
 * PDF, and accepts or declines there. "Download PDF" opens that page with ?pdf=1, which downloads straight away.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/currencies'
import { fmtDate } from '@/lib/client-portal/format'
import type { PortalQuote } from '@/lib/client-portal/api'
import { usePortalCanAct, usePortalHref } from '@/lib/client-portal/portal-mode'
import { ResponsiveDataView } from '@/components/ui/ResponsiveDataView'
import { MONEY_TH, MONEY_TD, countByStatusTab, filterByStatusTab, TAB_ALL } from '@/components/ui/StatusFilterTabs'
import { statusTab } from '@/components/ui/MoneyListFilters'
import { PortalEmpty, PortalPanel } from '@/components/portal/PortalChrome'
import { PortalListPager, PortalListToolbar, usePortalListPaging } from '@/components/portal/PortalListChrome'

const quoteUrl = (q: PortalQuote, pdf = false) => (q.link_token ? `/d/${q.link_token}${pdf ? '?pdf=1' : ''}` : null)

function quoteState(q: PortalQuote): { key: string; label: string; cls: string } {
  if (q.status === 'accepted') return { key: 'accepted', label: 'Accepted', cls: 'bg-green-100 text-green-700' }
  if (q.status === 'declined') return { key: 'declined', label: 'Declined', cls: 'bg-gray-100 text-gray-600' }
  if (q.expired) return { key: 'expired', label: 'Expired', cls: 'bg-amber-100 text-amber-800' }
  return { key: 'waiting', label: 'Waiting for you', cls: 'bg-blue-100 text-blue-700' }
}

const QUOTE_TABS = [
  TAB_ALL,
  statusTab('waiting', 'Waiting', ['waiting'], 'blue'),
  statusTab('accepted', 'Accepted', ['accepted'], 'green'),
  statusTab('declined', 'Declined / expired', ['declined', 'expired'], 'slate'),
]

function QuoteActions({ q, compact = false }: { q: PortalQuote; compact?: boolean }) {
  const canAct = usePortalCanAct()
  const view = quoteUrl(q)
  const pdf = quoteUrl(q, true)
  if (!view || !pdf) return null
  return (
    <div className={`flex items-center gap-2 ${compact ? 'justify-end' : 'flex-wrap'}`}>
      <a href={pdf} target="_blank" rel="noopener noreferrer" className="btn-outlined h-8 px-3 text-[12px] inline-flex items-center gap-1">
        <span className="material-icons text-[16px]">download</span>PDF
      </a>
      <a href={view} target="_blank" rel="noopener noreferrer"
        className={`${q.waiting && canAct ? 'btn-primary' : 'btn-outlined'} h-8 px-3 text-[12px] inline-flex items-center gap-1`}>
        <span className="material-icons text-[16px]">{q.waiting && canAct ? 'task_alt' : 'visibility'}</span>
        {q.waiting && canAct ? 'View & accept' : 'View'}
      </a>
    </div>
  )
}

/** Dashboard cards: quotes waiting for the client's answer. Nothing when there are none. */
export function PortalQuotesWaiting({ quotes }: { quotes: PortalQuote[] }) {
  const ph = usePortalHref()
  const waiting = quotes.filter(q => q.waiting)
  if (waiting.length === 0) return null
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-text-primary">
            {waiting.length === 1 ? 'A quote is waiting for your answer' : `${waiting.length} quotes are waiting for your answer`}
          </p>
          <p className="text-[12px] text-text-secondary">Open a quote to see the details, download the PDF, and accept or decline it.</p>
        </div>
        <Link href={ph('/home?tab=quotes')} className="btn-ghost text-[12px] shrink-0">All quotes</Link>
      </div>
      <div className="rounded-xl border border-divider bg-surface overflow-hidden">
        <ResponsiveDataView
          className="max-h-[236px] overflow-y-auto"
          table={
            <table className="w-full text-[13px]" style={{ minWidth: 560 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>Quote</th>
                  <th className={`${MONEY_TH} text-left`}>For</th>
                  <th className={`${MONEY_TH} text-left`}>Valid until</th>
                  <th className={`${MONEY_TH} text-right`}>Total</th>
                  <th className={`${MONEY_TH} text-right`}></th>
                </tr>
              </thead>
              <tbody>
                {waiting.map(q => (
                  <tr key={q.id} className="border-b border-divider last:border-0">
                    <td className={`${MONEY_TD} font-semibold text-text-primary whitespace-nowrap`}>{q.quote_number ?? '—'}</td>
                    <td className={MONEY_TD}>
                      <p className="text-text-primary">{q.title || q.project_title || 'Quotation'}</p>
                      {q.project_title && q.title && <p className="text-[11.5px] text-text-secondary">Project: {q.project_title}</p>}
                    </td>
                    <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{q.valid_until ? fmtDate(q.valid_until) : '—'}</td>
                    <td className={`${MONEY_TD} text-right font-semibold text-text-primary tabular-nums whitespace-nowrap`}>{formatCurrency(q.total_amount, q.currency)}</td>
                    <td className={`${MONEY_TD} text-right`}><QuoteActions q={q} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </div>
    </section>
  )
}

/** Quotes tab: every quote, waiting ones first, with the PDF and the quote page. */
export function PortalQuotesTable({ quotes }: { quotes: PortalQuote[] }) {
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const rows = useMemo(() => quotes.map(q => ({ ...q, state: quoteState(q), status: quoteState(q).key })), [quotes])
  const base = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? rows.filter(q => [q.quote_number, q.title, q.project_title].some(v => (v ?? '').toLowerCase().includes(s))) : rows
  }, [rows, search])
  const counts = useMemo(() => countByStatusTab(base, QUOTE_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, QUOTE_TABS, statusTabId), [base, statusTabId])
  const paging = usePortalListPaging(filtered)

  if (quotes.length === 0) {
    return <PortalEmpty icon="request_quote" title="No quotes" body="Quotes we send you will appear here, with the PDF and a button to accept." />
  }

  return (
    <div className="space-y-3">
      <PortalListToolbar
        search={search}
        onSearch={v => { setSearch(v); paging.resetPage() }}
        placeholder="Search quote number, title or project…"
        resetDisabled={!search}
        onReset={() => { setSearch(''); paging.resetPage() }}
        tabs={QUOTE_TABS}
        statusTabId={statusTabId}
        counts={counts}
        onStatusChange={id => { setStatusTabId(id); paging.resetPage() }}
      />
      <PortalPanel>
        <ResponsiveDataView
          table={
            <table className="w-full text-[13px]" style={{ minWidth: 680 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className={`${MONEY_TH} text-left`}>Quote</th>
                  <th className={`${MONEY_TH} text-left`}>For</th>
                  <th className={`${MONEY_TH} text-left`}>Status</th>
                  <th className={`${MONEY_TH} text-left`}>Valid until</th>
                  <th className={`${MONEY_TH} text-right`}>Total</th>
                  <th className={`${MONEY_TH} text-right`}></th>
                </tr>
              </thead>
              <tbody>
                {paging.pageRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-[13px] text-text-secondary">No quotes match.</td></tr>
                ) : paging.pageRows.map(q => (
                  <tr key={q.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                    <td className={`${MONEY_TD} font-semibold text-text-primary`}>{q.quote_number ?? '—'}</td>
                    <td className={MONEY_TD}>
                      <p className="text-text-primary">{q.title || 'Quotation'}</p>
                      {q.project_title && <p className="text-[11.5px] text-text-secondary">Project: {q.project_title}</p>}
                    </td>
                    <td className={MONEY_TD}>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${q.state.cls}`}>{q.state.label}</span>
                    </td>
                    <td className={`${MONEY_TD} text-text-secondary`}>{q.valid_until ? fmtDate(q.valid_until) : '—'}</td>
                    <td className={`${MONEY_TD} text-right font-semibold text-text-primary tabular-nums`}>{formatCurrency(q.total_amount, q.currency)}</td>
                    <td className={`${MONEY_TD} text-right`}><QuoteActions q={q} compact /></td>
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
  )
}

export { QuoteActions as PortalQuoteActions }
