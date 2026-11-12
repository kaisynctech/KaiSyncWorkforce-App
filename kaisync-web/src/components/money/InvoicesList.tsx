'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { XeroMark, useXeroStatuses } from '@/components/xero/XeroMark'
import type { FinanceInvoice } from '@/lib/finance-types'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import {
  StatusFilterTabs,
  TAB_ALL,
  MONEY_TH,
  MONEY_TD,
  countByStatusTab,
  filterByStatusTab,
} from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter,
  MoneyHeaderFilter,
  DateHeaderFilter,
  StatusHeaderFilter,
  ResetFiltersButton,
  matchText,
  matchMoney,
  inDateRange,
  statusTab,
} from '@/components/ui/MoneyListFilters'

type InvoiceRow = FinanceInvoice & {
  invoice_type?: string | null
  client_deals?: { title: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  voided: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-500',
}

const STATUS_TABS = [
  TAB_ALL,
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('sent', 'Sent', ['sent', 'viewed'], 'blue'),
  statusTab('partial', 'Part paid', ['partially_paid'], 'amber'),
  statusTab('paid', 'Paid', ['paid'], 'green'),
  statusTab('overdue', 'Overdue', ['overdue'], 'red'),
  statusTab('voided', 'Voided', ['voided', 'cancelled'], 'gray'),
]

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'partially_paid', label: 'Partially paid' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'voided', label: 'Voided' },
  { id: 'cancelled', label: 'Cancelled' },
]

type Cols = {
  number: string
  client: string
  project: string
  issueFrom: string
  issueTo: string
  dueFrom: string
  dueTo: string
  statuses: string[]
  totalMin: string
  totalMax: string
  balanceMin: string
  balanceMax: string
}

const EMPTY_COLS: Cols = {
  number: '',
  client: '',
  project: '',
  issueFrom: '',
  issueTo: '',
  dueFrom: '',
  dueTo: '',
  statuses: [],
  totalMin: '',
  totalMax: '',
  balanceMin: '',
  balanceMax: '',
}

function colsActive(c: Cols): boolean {
  return !!(
    c.number ||
    c.client ||
    c.project ||
    c.issueFrom ||
    c.issueTo ||
    c.dueFrom ||
    c.dueTo ||
    c.statuses.length ||
    c.totalMin ||
    c.totalMax ||
    c.balanceMin ||
    c.balanceMax
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export type DocListScope = { clientId?: string | null; jobId?: string | null; dealId?: string | null; quoteId?: string | null }

/** Query string that pre-fills a new document with this scope (job / project / client). */
export function scopeQuery(scope: DocListScope, withProject = false): string {
  const p = new URLSearchParams()
  if (scope.jobId) p.set('job_id', scope.jobId)
  if (scope.clientId) p.set('client_id', scope.clientId)
  if (scope.dealId) { p.set('deal_id', scope.dealId); if (withProject) p.set('project_id', scope.dealId) }
  const q = p.toString()
  return q ? `?${q}` : ''
}

/**
 * The invoices table used on Money → Invoices and, embedded, on a job or project (same columns, filters,
 * status tabs and Xero marks). Embedded: no page header, no scope chips, "+ Invoice" pre-fills the job/project.
 */
export function InvoicesList({ clientId = null, jobId = null, dealId = null, quoteId = null, embedded = false, prefill, onNew, newLabel }: DocListScope & {
  embedded?: boolean; prefill?: DocListScope
  /** Replaces the "+ Invoice" link (an order makes its invoice from the quote). */
  onNew?: () => void; newLabel?: string
}) {
  const router = useRouter()
  const clientFilter = clientId
  const jobFilter = jobId
  const dealFilter = dealId

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusTabId, setStatusTabId] = useState('all')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)
  const [filterLabels, setFilterLabels] = useState<{ client?: string; job?: string; deal?: string }>({})
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) {
        setRows([])
        return
      }
      setCompanyId(member.companyId)

      let q = supabase
        .from('finance_invoices')
        .select(`
        id, invoice_number, status, currency,
        total_amount, amount_paid, balance_due,
        issue_date, due_date, paid_date,
        client_id, job_id, deal_id, project_id,
        clients(name),
        client_deals!finance_invoices_deal_id_fkey(title)
      `)
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false })

      if (clientFilter) q = q.eq('client_id', clientFilter)
      if (jobFilter) q = q.eq('job_id', jobFilter)
      if (dealFilter) q = q.or(`deal_id.eq.${dealFilter},project_id.eq.${dealFilter}`)
      if (quoteId) q = q.eq('quote_id', quoteId)

      const listRes = await q
      if (listRes.error) {
        console.error('finance_invoices list failed', listRes.error)
        setRows([])
      } else {
        setRows((listRes.data ?? []) as unknown as InvoiceRow[])
      }

      const labels: { client?: string; job?: string; deal?: string } = {}
      if (clientFilter) {
        const { data: c } = await supabase.from('clients').select('name').eq('id', clientFilter).maybeSingle()
        if (c?.name) labels.client = c.name
      }
      if (jobFilter) {
        const { data: j } = await supabase.from('jobs').select('title, job_code').eq('id', jobFilter).maybeSingle()
        if (j) labels.job = j.job_code ? `${j.job_code} · ${j.title}` : j.title
      }
      if (dealFilter) {
        const { data: d } = await supabase
          .from('client_deals')
          .select('title, project_code')
          .eq('id', dealFilter)
          .maybeSingle()
        if (d) labels.deal = d.project_code ? `${d.project_code} · ${d.title}` : d.title
      }
      setFilterLabels(labels)
    } catch (err) {
      console.error('invoices page load failed', err)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [clientFilter, jobFilter, dealFilter, quoteId])

  useEffect(() => {
    void load()
  }, [load])

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (!matchText(r.invoice_number, cols.number)) return false
      const client = (r.clients as { name: string } | null)?.name ?? ''
      if (!matchText(client, cols.client)) return false
      const project = (r.client_deals as { title: string } | null)?.title ?? ''
      if (!matchText(project, cols.project)) return false
      if (!inDateRange(r.issue_date, cols.issueFrom, cols.issueTo)) return false
      if (!inDateRange(r.due_date, cols.dueFrom, cols.dueTo)) return false
      if (cols.statuses.length && !cols.statuses.includes(r.status)) return false
      if (!matchMoney(r.total_amount, cols.totalMin, cols.totalMax)) return false
      if (!matchMoney(r.balance_due, cols.balanceMin, cols.balanceMax)) return false
      if (!q) return true
      return (
        (r.invoice_number ?? '').toLowerCase().includes(q) ||
        client.toLowerCase().includes(q) ||
        project.toLowerCase().includes(q)
      )
    })
  }, [rows, search, cols])

  const statusCounts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])

  const xero = useXeroStatuses(companyId, 'invoice', filtered.slice(0, 300).map(r => r.id))
  const xeroMark = (r: InvoiceRow) => (
    <XeroMark
      companyId={companyId}
      kind="invoice"
      id={r.id}
      state={xero.statuses?.[r.id]}
      connected={xero.connected}
      canSend={!['draft', 'cancelled', 'voided'].includes(r.status)}
      onChanged={() => void xero.reload()}
    />
  )

  const hasScopeFilter = !!(clientFilter || jobFilter || dealFilter)
  const hasFilters = colsActive(cols) || !!search

  function clearScopeFilters() {
    router.replace('/dashboard/money/invoices')
  }

  return (
    <div className={embedded ? 'flex flex-col rounded-xl border border-divider bg-surface overflow-hidden' : 'h-full flex flex-col'}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          {embedded
            ? <h2 className="text-[14px] font-semibold text-text-primary leading-tight">Invoices</h2>
            : <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Invoices</h1>}
          {!embedded && <p className="text-[11px] text-text-secondary mt-0.5">Sales invoices you send to clients</p>}
        </div>
        {onNew ? (
          <button type="button" onClick={onNew} className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1">
            <span className="material-icons text-[16px]">add</span>{newLabel ?? 'Invoice'}
          </button>
        ) : (
          <Link
            href={`/dashboard/money/invoices/new${scopeQuery(prefill ?? { clientId, jobId, dealId }, true)}`}
            className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1"
          >
            <span className="material-icons text-[16px]">add</span>Invoice
          </Link>
        )}
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider shrink-0 flex-wrap bg-surface items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search number or client…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]"
        />
        <ResetFiltersButton
          disabled={!hasFilters}
          onReset={() => {
            setCols(EMPTY_COLS)
            setSearch('')
          }}
        />
        <StatusFilterTabs
          tabs={STATUS_TABS}
          value={statusTabId}
          counts={statusCounts}
          onChange={setStatusTabId}
        />
        {hasScopeFilter && !embedded && (
          <div className="flex flex-wrap gap-1.5 items-center w-full">
            {filterLabels.client && (
              <span className="h-7 px-2 rounded-md bg-surface-elevated border border-divider text-[11px] text-text-primary flex items-center">
                Client: {filterLabels.client}
              </span>
            )}
            {filterLabels.job && (
              <span className="h-7 px-2 rounded-md bg-surface-elevated border border-divider text-[11px] text-text-primary flex items-center">
                Job: {filterLabels.job}
              </span>
            )}
            {filterLabels.deal && (
              <span className="h-7 px-2 rounded-md bg-surface-elevated border border-divider text-[11px] text-text-primary flex items-center">
                Project: {filterLabels.deal}
              </span>
            )}
            <button
              type="button"
              onClick={clearScopeFilters}
              className="h-7 px-2 text-[11px] text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[12px] text-text-secondary py-10">Loading…</p>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider sticky top-0 z-10">
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter
                        label="Number"
                        value={cols.number}
                        onChange={v => setCols(c => ({ ...c, number: v }))}
                        placeholder="Invoice #…"
                      />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter
                        label="Client"
                        value={cols.client}
                        onChange={v => setCols(c => ({ ...c, client: v }))}
                        placeholder="Client…"
                      />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter
                        label="Project"
                        value={cols.project}
                        onChange={v => setCols(c => ({ ...c, project: v }))}
                        placeholder="Project…"
                      />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <DateHeaderFilter
                        label="Issue Date"
                        from={cols.issueFrom}
                        to={cols.issueTo}
                        onChange={p => setCols(c => ({ ...c, issueFrom: p.from, issueTo: p.to }))}
                      />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <DateHeaderFilter
                        label="Due"
                        from={cols.dueFrom}
                        to={cols.dueTo}
                        onChange={p => setCols(c => ({ ...c, dueFrom: p.from, dueTo: p.to }))}
                      />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <StatusHeaderFilter
                        label="Status"
                        options={STATUS_OPTIONS}
                        selected={cols.statuses}
                        onChange={v => setCols(c => ({ ...c, statuses: v }))}
                      />
                    </th>
                    <th className={`${MONEY_TH} text-right`}>
                      <MoneyHeaderFilter
                        label="Total"
                        min={cols.totalMin}
                        max={cols.totalMax}
                        onChange={p => setCols(c => ({ ...c, totalMin: p.min, totalMax: p.max }))}
                      />
                    </th>
                    <th className={`${MONEY_TH} text-right`}>
                      <MoneyHeaderFilter
                        label="Balance"
                        min={cols.balanceMin}
                        max={cols.balanceMax}
                        onChange={p =>
                          setCols(c => ({ ...c, balanceMin: p.min, balanceMax: p.max }))
                        }
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr
                      key={r.id}
                      className="border-b border-divider hover:bg-surface-elevated cursor-pointer transition-colors"
                      onClick={() => router.push(`/dashboard/money/invoices/${r.id}`)}
                    >
                      <td className={`${MONEY_TD} font-medium text-text-primary`}>
                        <span className="inline-flex items-center gap-1.5">
                          {r.invoice_number || <span className="text-text-disabled italic">draft</span>}
                          {(xero.statuses?.[r.id] ||
                            !['draft', 'cancelled', 'voided'].includes(r.status)) &&
                            xeroMark(r)}
                        </span>
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary`}>
                        {(r.clients as { name: string } | null)?.name ?? '—'}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary`}>
                        {(r.client_deals as { title: string } | null)?.title ?? '—'}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary`}>{r.issue_date ?? '—'}</td>
                      <td className={`${MONEY_TD} text-text-secondary`}>{r.due_date ?? '—'}</td>
                      <td className={MONEY_TD}>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={`${MONEY_TD} text-right text-text-primary`}>
                        {fmtMoney(r.total_amount, r.currency)}
                      </td>
                      <td className={`${MONEY_TD} text-right font-medium text-text-primary`}>
                        {fmtMoney(r.balance_due, r.currency)}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-[12px] text-text-secondary py-14">
                        <span className="material-icons text-[32px] text-text-disabled block mb-1">
                          receipt_long
                        </span>
                        No invoices found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            }
            mobile={
              filtered.length === 0 ? (
                <div className="text-center text-[12px] text-text-secondary py-14">
                  <span className="material-icons text-[32px] text-text-disabled block mb-1">
                    receipt_long
                  </span>
                  No invoices found
                </div>
              ) : (
                <>
                  {filtered.map(r => (
                    <DataCard
                      key={r.id}
                      onClick={() => router.push(`/dashboard/money/invoices/${r.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>
                            <span className="inline-flex items-center gap-1.5">
                              {r.invoice_number || 'Draft'}
                              {(xero.statuses?.[r.id] ||
                                !['draft', 'cancelled', 'voided'].includes(r.status)) &&
                                xeroMark(r)}
                            </span>
                          </DataCardTitle>
                          <DataCardMeta>
                            {(r.clients as { name: string } | null)?.name ?? '—'}
                          </DataCardMeta>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <DataCardRow label="Total" value={fmtMoney(r.total_amount, r.currency)} />
                      <DataCardRow label="Balance" value={fmtMoney(r.balance_due, r.currency)} />
                      <DataCardRow label="Due" value={r.due_date ?? '—'} />
                    </DataCard>
                  ))}
                </>
              )
            }
          />
        )}
      </div>
    </div>
  )
}
