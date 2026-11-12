'use client'

import { scopeQuery, type DocListScope } from '@/components/money/InvoicesList'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { quoteStatusLabel } from '@/lib/contractor-portal/quotes'
import type { CommercialQuote } from '@/types/database'
import { cn } from '@/lib/utils'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import {
  ColumnHeaderFilter,
  ColumnFilterText,
  ColumnFilterMoney,
  ColumnFilterDateRange,
  ColumnFilterStatus,
  ColumnFilterClear,
} from '@/components/ui/ColumnHeaderFilter'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'

type HubTab = 'sales' | 'incoming'

type SalesRow = Pick<
  CommercialQuote,
  'id' | 'quote_number' | 'title' | 'status' | 'currency' | 'total_amount' | 'valid_until' | 'created_at'
> & { clients?: { name: string } | null }

/** A quote the business received: a contractor's quote, or a supplier's reply to an RFQ. */
type IncomingRow = {
  id: string
  source: 'contractor' | 'supplier'
  title: string | null
  quote_number: string | null
  status: string
  currency: string | null
  total_amount: number | null
  submitted_at: string | null
  created_at: string
  party: string | null
  href: string
}

type ContractorQuoteRow = {
  id: string; title: string | null; quote_number: string | null; status: string; currency: string | null
  total_amount: number | null; submitted_at: string | null; created_at: string; contractor_id: string
  contractors?: { name: string } | null
}
type RfqReplyRow = {
  id: string; rfq_id: string; status: string; response_total: number | null; responded_at: string | null
  declined_at: string | null; created_at: string
  supplier?: { name: string } | null
  rfq?: { rfq_number: string | null; title: string | null } | null
}

/** Toolbar status tabs — exact statuses (not the old Outstanding/Done buckets). */
type StatusTab = 'all' | 'draft' | 'sent' | 'accepted' | 'declined' | 'submitted' | 'approved' | 'rejected'

type TextCols = {
  number: string
  party: string
  title: string
  valueMin: string
  valueMax: string
  statuses: string[]
  dateFrom: string
  dateTo: string
  validFrom: string
  validTo: string
}

const EMPTY_COLS: TextCols = {
  number: '',
  party: '',
  title: '',
  valueMin: '',
  valueMax: '',
  statuses: [],
  dateFrom: '',
  dateTo: '',
  validFrom: '',
  validTo: '',
}

const SALES_STATUS_COLORS: Record<CommercialQuote['status'], string> = {
  draft: 'bg-slate-100 text-slate-700',
  internal_review: 'bg-blue-100 text-blue-700',
  sent: 'bg-amber-100 text-amber-700',
  viewed: 'bg-purple-100 text-purple-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
}

const INCOMING_OUTSTANDING = new Set(['submitted', 'under_review', 'revision_requested', 'responded'])

/** Supplier replies to an RFQ, in the same words as contractor quotes. */
const RFQ_REPLY_STATUS: Record<string, string> = {
  responded: 'responded', selected: 'approved', not_selected: 'rejected', declined: 'declined',
}
function incomingLabel(status: string): string {
  if (status === 'responded') return 'Received'
  if (status === 'declined') return 'Supplier declined'
  return quoteStatusLabel(status)
}

const SALES_STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'internal_review', label: 'Internal review' },
  { id: 'sent', label: 'Sent' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'expired', label: 'Expired' },
]

const INCOMING_STATUS_OPTIONS = [
  { id: 'responded', label: 'Received (supplier)' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'under_review', label: 'Under review' },
  { id: 'revision_requested', label: 'Revision requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'converted', label: 'Converted' },
  { id: 'expired', label: 'Expired' },
  { id: 'declined', label: 'Supplier declined' },
]

/** Coloured status pills — colours match the status badges in the table. */
const SALES_STATUS_TABS: {
  id: StatusTab
  label: string
  match: string[] | null
  idle: string
  active: string
}[] = [
  {
    id: 'all',
    label: 'All',
    match: null,
    idle: 'border-divider text-text-primary hover:bg-surface-elevated',
    active: 'bg-slate-800 text-white border-slate-800',
  },
  {
    id: 'draft',
    label: 'Draft',
    match: ['draft'],
    idle: 'border-slate-200 text-slate-700 hover:bg-slate-50',
    active: 'bg-slate-700 text-white border-slate-700',
  },
  {
    id: 'sent',
    label: 'Sent',
    match: ['sent'],
    idle: 'border-amber-200 text-amber-700 hover:bg-amber-50',
    active: 'bg-amber-500 text-white border-amber-500',
  },
  {
    id: 'accepted',
    label: 'Accepted',
    match: ['accepted'],
    idle: 'border-green-200 text-green-700 hover:bg-green-50',
    active: 'bg-green-600 text-white border-green-600',
  },
  {
    id: 'declined',
    label: 'Declined',
    match: ['declined'],
    idle: 'border-red-200 text-red-700 hover:bg-red-50',
    active: 'bg-red-600 text-white border-red-600',
  },
]

const INCOMING_STATUS_TABS: typeof SALES_STATUS_TABS = [
  {
    id: 'all',
    label: 'All',
    match: null,
    idle: 'border-divider text-text-primary hover:bg-surface-elevated',
    active: 'bg-slate-800 text-white border-slate-800',
  },
  {
    id: 'submitted',
    label: 'To review',
    match: ['submitted', 'under_review', 'revision_requested', 'responded'],
    idle: 'border-amber-200 text-amber-700 hover:bg-amber-50',
    active: 'bg-amber-500 text-white border-amber-500',
  },
  {
    id: 'approved',
    label: 'Approved',
    match: ['approved'],
    idle: 'border-green-200 text-green-700 hover:bg-green-50',
    active: 'bg-green-600 text-white border-green-600',
  },
  {
    id: 'rejected',
    label: 'Rejected',
    match: ['rejected', 'declined'],
    idle: 'border-red-200 text-red-700 hover:bg-red-50',
    active: 'bg-red-600 text-white border-red-600',
  },
]

const TD = 'data-td !py-1.5 !px-2.5 text-[12px]'
const TH = 'data-th !py-1.5 !px-2.5 text-[11px] !text-text-primary'

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function incomingBadgeClass(status: string): string {
  switch (status) {
    case 'submitted':
    case 'under_review':
    case 'responded':
      return 'bg-amber-100 text-amber-700'
    case 'revision_requested':
      return 'bg-blue-100 text-blue-700'
    case 'approved':
      return 'bg-green-100 text-green-700'
    case 'rejected':
    case 'declined':
      return 'bg-red-100 text-red-700'
    case 'converted':
      return 'bg-slate-100 text-slate-700'
    default:
      return 'bg-gray-100 text-gray-500'
  }
}

function colsActive(c: TextCols): boolean {
  return !!(
    c.number ||
    c.party ||
    c.title ||
    c.valueMin ||
    c.valueMax ||
    c.statuses.length ||
    c.dateFrom ||
    c.dateTo ||
    c.validFrom ||
    c.validTo
  )
}

function dayKey(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function inDateRange(iso: string | null | undefined, from: string, to: string): boolean {
  const d = dayKey(iso)
  if (!d) return !(from || to)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

function matchMoney(amount: number | null | undefined, min: string, max: string): boolean {
  const n = Number(amount ?? 0)
  if (min !== '' && !Number.isNaN(Number(min)) && n < Number(min)) return false
  if (max !== '' && !Number.isNaN(Number(max)) && n > Number(max)) return false
  return true
}

function toggleStatus(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

/**
 * The quotes table on Money → Sales Quotes (kind 'sales': quotes the business sends) and Money → Incoming Quotes
 * (kind 'incoming': contractor quotes and supplier replies to RFQs), and, embedded, on a job or project (sales
 * quotes only, no page header or scope chips, "+ New Quote" pre-fills the job/project).
 */
export function QuotesList({ clientId = null, jobId = null, dealId = null, embedded = false, prefill, kind = 'sales' }: DocListScope & { embedded?: boolean; prefill?: DocListScope; kind?: HubTab }) {
  const router = useRouter()
  const clientFilter = clientId
  const jobFilter = jobId
  const dealFilter = dealId
  const newQuoteHref = `/dashboard/money/quotes/new${scopeQuery(prefill ?? { clientId, jobId, dealId })}`

  const tab: HubTab = embedded ? 'sales' : kind
  const [statusTab, setStatusTab] = useState<StatusTab>('all')
  const [search, setSearch] = useState('')
  const [searchD, setSearchD] = useState('')
  const [cols, setCols] = useState<TextCols>(EMPTY_COLS)
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SalesRow[]>([])
  const [incoming, setIncoming] = useState<IncomingRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [filterLabels, setFilterLabels] = useState<{ client?: string; job?: string; deal?: string }>({})

  useEffect(() => {
    const t = setTimeout(() => setSearchD(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setStatusTab('all')
    setSearch('')
    setSearchD('')
    setCols(EMPTY_COLS)
    setPage(1)
  }, [tab])

  useEffect(() => {
    setPage(1)
  }, [statusTab, searchD, pageSize, cols])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) {
        setSales([])
        setIncoming([])
        return
      }

      let salesQ = supabase
        .from('commercial_quotes')
        .select('id, quote_number, title, status, currency, total_amount, valid_until, created_at, clients(name)')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false })
        .limit(300)

      if (clientFilter) salesQ = salesQ.eq('client_id', clientFilter)
      if (jobFilter) salesQ = salesQ.eq('job_id', jobFilter)
      if (dealFilter) salesQ = salesQ.eq('deal_id', dealFilter)

      if (tab === 'sales') {
        const salesRes = await salesQ
        if (salesRes.error) {
          console.error('commercial_quotes list failed', salesRes.error)
          setSales([])
        } else {
          setSales((salesRes.data ?? []) as unknown as SalesRow[])
        }
      } else {
        const [cqRes, rfqRes] = await Promise.all([
          supabase
            .from('contractor_quotes')
            .select('id, title, quote_number, status, currency, total_amount, submitted_at, created_at, contractor_id, contractors(name)')
            .eq('company_id', member.companyId)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(300),
          supabase
            .from('rfq_recipients')
            .select('id, rfq_id, status, response_total, responded_at, declined_at, created_at, supplier:contractors(name), rfq:rfqs(rfq_number, title)')
            .eq('company_id', member.companyId)
            .in('status', Object.keys(RFQ_REPLY_STATUS))
            .order('created_at', { ascending: false })
            .limit(300),
        ])
        if (cqRes.error) console.error('contractor_quotes list failed', cqRes.error)
        if (rfqRes.error) console.error('rfq replies list failed', rfqRes.error)
        const rows: IncomingRow[] = [
          ...((cqRes.data ?? []) as unknown as ContractorQuoteRow[]).map(q => ({
            id: q.id, source: 'contractor' as const, title: q.title, quote_number: q.quote_number, status: q.status,
            currency: q.currency, total_amount: q.total_amount, submitted_at: q.submitted_at, created_at: q.created_at,
            party: q.contractors?.name ?? null,
            href: `/dashboard/contractors/${q.contractor_id}?tab=Quotes&focusType=quote_pending&focus=${q.id}`,
          })),
          ...((rfqRes.data ?? []) as unknown as RfqReplyRow[]).map(r => ({
            id: r.id, source: 'supplier' as const, title: r.rfq?.title ?? null, quote_number: r.rfq?.rfq_number ?? null,
            status: RFQ_REPLY_STATUS[r.status] ?? r.status, currency: null,
            total_amount: r.status === 'declined' ? null : r.response_total,
            submitted_at: r.responded_at ?? r.declined_at, created_at: r.created_at,
            party: r.supplier?.name ?? null,
            href: `/dashboard/supply/rfqs/${r.rfq_id}/responses?supplier=${r.id}`,
          })),
        ].sort((a, b) => (b.submitted_at ?? b.created_at).localeCompare(a.submitted_at ?? a.created_at))
        setIncoming(rows)
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
      console.error('quotes page load failed', err)
      setSales([])
      setIncoming([])
    } finally {
      setLoading(false)
    }
  }, [clientFilter, jobFilter, dealFilter, tab])

  useEffect(() => {
    void load()
  }, [load])

  const matchSalesCols = useCallback(
    (row: SalesRow) => {
      if (cols.number && !(row.quote_number ?? '').toLowerCase().includes(cols.number.toLowerCase())) return false
      if (cols.party && !(row.clients?.name ?? '').toLowerCase().includes(cols.party.toLowerCase())) return false
      if (cols.title && !(row.title ?? '').toLowerCase().includes(cols.title.toLowerCase())) return false
      if (!matchMoney(row.total_amount, cols.valueMin, cols.valueMax)) return false
      if (cols.statuses.length && !cols.statuses.includes(row.status)) return false
      if (!inDateRange(row.created_at, cols.dateFrom, cols.dateTo)) return false
      if (!inDateRange(row.valid_until, cols.validFrom, cols.validTo)) return false
      return true
    },
    [cols],
  )

  const matchIncomingCols = useCallback(
    (row: IncomingRow) => {
      if (cols.number && !(row.quote_number ?? '').toLowerCase().includes(cols.number.toLowerCase())) return false
      if (cols.party && !(row.party ?? '').toLowerCase().includes(cols.party.toLowerCase())) return false
      if (cols.title && !(row.title ?? '').toLowerCase().includes(cols.title.toLowerCase())) return false
      if (!matchMoney(row.total_amount, cols.valueMin, cols.valueMax)) return false
      if (cols.statuses.length && !cols.statuses.includes(row.status)) return false
      if (!inDateRange(row.submitted_at ?? row.created_at, cols.dateFrom, cols.dateTo)) return false
      return true
    },
    [cols],
  )

  const salesBase = useMemo(() => {
    const q = searchD.toLowerCase()
    return sales.filter(row => {
      if (!matchSalesCols(row)) return false
      if (!q) return true
      const client = row.clients?.name ?? ''
      return (
        (row.quote_number ?? '').toLowerCase().includes(q) ||
        (row.title ?? '').toLowerCase().includes(q) ||
        client.toLowerCase().includes(q)
      )
    })
  }, [sales, searchD, matchSalesCols])

  const incomingBase = useMemo(() => {
    const q = searchD.toLowerCase()
    return incoming.filter(row => {
      if (!matchIncomingCols(row)) return false
      if (!q) return true
      const contractor = row.party ?? ''
      return (
        (row.quote_number ?? '').toLowerCase().includes(q) ||
        (row.title ?? '').toLowerCase().includes(q) ||
        contractor.toLowerCase().includes(q)
      )
    })
  }, [incoming, searchD, matchIncomingCols])

  const statusTabs = tab === 'sales' ? SALES_STATUS_TABS : INCOMING_STATUS_TABS

  const statusCounts = useMemo(() => {
    const rows = tab === 'sales' ? salesBase : incomingBase
    const counts: Record<string, number> = { all: rows.length }
    for (const t of statusTabs) {
      if (!t.match) continue
      counts[t.id] = rows.filter(row => t.match!.includes(row.status)).length
    }
    return counts
  }, [tab, salesBase, incomingBase, statusTabs])

  const filteredSales = useMemo(() => {
    const t = SALES_STATUS_TABS.find(x => x.id === statusTab)
    if (!t?.match) return salesBase
    return salesBase.filter(row => t.match!.includes(row.status))
  }, [salesBase, statusTab])

  const filteredIncoming = useMemo(() => {
    const t = INCOMING_STATUS_TABS.find(x => x.id === statusTab)
    if (!t?.match) return incomingBase
    return incomingBase.filter(row => t.match!.includes(row.status))
  }, [incomingBase, statusTab])

  const filtered = tab === 'sales' ? filteredSales : filteredIncoming
  const pages = totalPages(filtered.length, pageSize)
  const safePage = Math.min(page, pages)
  const { from, to } = pageRange(safePage, pageSize)
  const pagedSales = filteredSales.slice(from, to + 1)
  const pagedIncoming = filteredIncoming.slice(from, to + 1)
  const hasColFilters = colsActive(cols)
  const hasScopeFilter = !!(clientFilter || jobFilter || dealFilter)

  function openIncoming(row: IncomingRow) {
    router.push(row.href)
  }

  function exportCsv() {
    const rows =
      tab === 'sales'
        ? filteredSales.map(q => [
            q.quote_number ?? '',
            q.clients?.name ?? '',
            q.title ?? '',
            String(q.total_amount ?? 0),
            q.status,
            q.created_at?.slice(0, 10) ?? '',
            q.valid_until ?? '',
          ])
        : filteredIncoming.map(q => [
            q.quote_number ?? '',
            q.source === 'supplier' ? 'Supplier (RFQ)' : 'Contractor',
            q.party ?? '',
            q.title ?? '',
            String(q.total_amount ?? 0),
            q.status,
            (q.submitted_at ?? q.created_at)?.slice(0, 10) ?? '',
          ])
    const header =
      tab === 'sales'
        ? ['Number', 'Client', 'Title', 'Value', 'Status', 'Created', 'Valid Until']
        : ['Number', 'Source', 'From', 'Title', 'Value', 'Status', 'Received']
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = tab === 'sales' ? 'sales-quotes.csv' : 'incoming-quotes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function clearScopeFilters() {
    router.replace('/dashboard/money/quotes')
  }

  function patchCols(patch: Partial<TextCols>) {
    setCols(prev => ({ ...prev, ...patch }))
  }

  const statusOptions = tab === 'sales' ? SALES_STATUS_OPTIONS : INCOMING_STATUS_OPTIONS

  return (
    <div className={embedded ? 'flex flex-col rounded-xl border border-divider bg-surface overflow-hidden' : 'h-full flex flex-col'}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          {embedded
            ? <h2 className="text-[14px] font-semibold text-text-primary leading-tight">Quotes</h2>
            : <h1 className="text-[18px] font-semibold text-text-primary leading-tight">{tab === 'sales' ? 'Sales Quotes' : 'Incoming Quotes'}</h1>}
          {!embedded && (
            <p className="text-[11px] text-text-secondary mt-0.5">
              {tab === 'sales'
                ? 'Quotes you send to your clients'
                : 'Quotes you receive: from contractors, and suppliers\' replies to your RFQs'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
          >
            Export
          </button>
          {tab === 'sales' ? (
            <button
              type="button"
              onClick={() => router.push(newQuoteHref)}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              + New Quote
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push('/dashboard/supply/rfqs/new')}
              className="btn-primary h-8 px-3 text-[12px]"
            >
              + New RFQ
            </button>
          )}
        </div>
      </div>


      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={
            tab === 'sales'
              ? 'Search quote #, title, or client…'
              : 'Search number, title, contractor or supplier…'
          }
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]"
        />
        <button
          type="button"
          disabled={!hasColFilters && !search}
          onClick={() => {
            setCols(EMPTY_COLS)
            setSearch('')
            setSearchD('')
          }}
          className="h-8 px-2.5 rounded-md border border-divider text-[11px] font-medium text-text-secondary hover:bg-surface-elevated disabled:opacity-40 inline-flex items-center gap-1"
        >
          <span className="material-icons text-[14px]">filter_alt_off</span>
          Reset filters
        </button>
        <div className="flex gap-1 flex-wrap ml-auto">
          {statusTabs.map(f => {
            const count = statusCounts[f.id] ?? 0
            const on = statusTab === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusTab(f.id)}
                className={cn(
                  'h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors bg-surface',
                  on ? f.active : f.idle,
                )}
              >
                {f.label}
                <span className={cn('ml-1 tabular-nums font-medium', on ? 'text-white/85' : 'opacity-70')}>
                  ({count})
                </span>
              </button>
            )
          })}
        </div>
        {hasScopeFilter && tab === 'sales' && !embedded && (
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
          <div className="flex items-center justify-center py-16">
            <p className="text-text-secondary text-[12px]">Loading…</p>
          </div>
        ) : tab === 'sales' ? (
          filteredSales.length === 0 ? (
            <EmptySales onCreate={() => router.push('/dashboard/money/quotes/new')} />
          ) : (
            <ResponsiveDataView
              table={
                <table className="w-full" style={{ minWidth: 720 }}>
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className={`${TH} text-left`}>
                        <ColumnHeaderFilter label="#" active={!!cols.number}>
                          <ColumnFilterText
                            value={cols.number}
                            onChange={v => patchCols({ number: v })}
                            placeholder="Quote #…"
                          />
                          <ColumnFilterClear
                            disabled={!cols.number}
                            onClear={() => patchCols({ number: '' })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                      <th className={`${TH} text-left`}>
                        <ColumnHeaderFilter label="Client" active={!!cols.party}>
                          <ColumnFilterText
                            value={cols.party}
                            onChange={v => patchCols({ party: v })}
                            placeholder="Client name…"
                          />
                          <ColumnFilterClear
                            disabled={!cols.party}
                            onClear={() => patchCols({ party: '' })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                      <th className={`${TH} text-left`}>
                        <ColumnHeaderFilter label="Title" active={!!cols.title}>
                          <ColumnFilterText
                            value={cols.title}
                            onChange={v => patchCols({ title: v })}
                            placeholder="Title…"
                          />
                          <ColumnFilterClear
                            disabled={!cols.title}
                            onClear={() => patchCols({ title: '' })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                      <th className={`${TH} text-right`}>
                        <ColumnHeaderFilter
                          label="Value"
                          align="right"
                          active={!!(cols.valueMin || cols.valueMax)}
                        >
                          <ColumnFilterMoney
                            min={cols.valueMin}
                            max={cols.valueMax}
                            onMin={v => patchCols({ valueMin: v })}
                            onMax={v => patchCols({ valueMax: v })}
                          />
                          <ColumnFilterClear
                            disabled={!cols.valueMin && !cols.valueMax}
                            onClear={() => patchCols({ valueMin: '', valueMax: '' })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                      <th className={`${TH} text-left`}>
                        <ColumnHeaderFilter label="Status" active={cols.statuses.length > 0}>
                          <ColumnFilterStatus
                            options={statusOptions}
                            selected={cols.statuses}
                            onToggle={id => patchCols({ statuses: toggleStatus(cols.statuses, id) })}
                          />
                          <ColumnFilterClear
                            disabled={cols.statuses.length === 0}
                            onClear={() => patchCols({ statuses: [] })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                      <th className={`${TH} text-left`}>
                        <ColumnHeaderFilter
                          label="Created"
                          active={!!(cols.dateFrom || cols.dateTo)}
                        >
                          <ColumnFilterDateRange
                            from={cols.dateFrom}
                            to={cols.dateTo}
                            onFrom={v => patchCols({ dateFrom: v })}
                            onTo={v => patchCols({ dateTo: v })}
                          />
                          <ColumnFilterClear
                            disabled={!cols.dateFrom && !cols.dateTo}
                            onClear={() => patchCols({ dateFrom: '', dateTo: '' })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                      <th className={`${TH} text-left`}>
                        <ColumnHeaderFilter
                          label="Valid Until"
                          active={!!(cols.validFrom || cols.validTo)}
                        >
                          <ColumnFilterDateRange
                            from={cols.validFrom}
                            to={cols.validTo}
                            onFrom={v => patchCols({ validFrom: v })}
                            onTo={v => patchCols({ validTo: v })}
                          />
                          <ColumnFilterClear
                            disabled={!cols.validFrom && !cols.validTo}
                            onClear={() => patchCols({ validFrom: '', validTo: '' })}
                          />
                        </ColumnHeaderFilter>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSales.map(q => (
                      <tr
                        key={q.id}
                        onClick={() => router.push(`/dashboard/money/quotes/${q.id}`)}
                        className="bg-surface-card border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated transition-colors"
                      >
                        <td className={`${TD} font-mono text-text-secondary`}>{q.quote_number ?? '—'}</td>
                        <td className={`${TD} text-text-primary`}>{q.clients?.name ?? '—'}</td>
                        <td className={`${TD} text-text-primary max-w-[240px] truncate`}>
                          {q.title || 'Untitled'}
                        </td>
                        <td className={`${TD} text-right font-medium text-text-primary`}>
                          {fmtMoney(q.total_amount, q.currency)}
                        </td>
                        <td className={TD}>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${SALES_STATUS_COLORS[q.status]}`}
                          >
                            {q.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className={`${TD} text-text-secondary whitespace-nowrap`}>{fmt(q.created_at)}</td>
                        <td className={`${TD} text-text-secondary whitespace-nowrap`}>{fmt(q.valid_until)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
              mobile={
                <>
                  {pagedSales.map(q => (
                    <DataCard
                      key={q.id}
                      onClick={() => router.push(`/dashboard/money/quotes/${q.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataCardTitle>{q.title || 'Untitled'}</DataCardTitle>
                          <DataCardMeta className="font-mono">{q.quote_number ?? '—'}</DataCardMeta>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${SALES_STATUS_COLORS[q.status]}`}
                        >
                          {q.status.replace('_', ' ')}
                        </span>
                      </div>
                      <DataCardRow label="Client" value={q.clients?.name ?? '—'} />
                      <DataCardRow label="Value" value={fmtMoney(q.total_amount, q.currency)} />
                      <DataCardRow label="Valid" value={fmt(q.valid_until)} />
                    </DataCard>
                  ))}
                </>
              }
            />
          )
        ) : filteredIncoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="material-icons text-[40px] text-text-disabled">inbox</span>
            <p className="text-text-secondary text-[13px] font-medium">No incoming quotes</p>
            <p className="text-[11px] text-text-secondary">
              Quotes contractors send you, and suppliers&apos; replies to your RFQs, appear here.
            </p>
          </div>
        ) : (
          <ResponsiveDataView
            table={
              <table className="w-full" style={{ minWidth: 860 }}>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className={`${TH} text-left`}>
                      <ColumnHeaderFilter label="#" active={!!cols.number}>
                        <ColumnFilterText
                          value={cols.number}
                          onChange={v => patchCols({ number: v })}
                          placeholder="Quote #…"
                        />
                        <ColumnFilterClear
                          disabled={!cols.number}
                          onClear={() => patchCols({ number: '' })}
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className={`${TH} text-left`}>Source</th>
                    <th className={`${TH} text-left`}>
                      <ColumnHeaderFilter label="From" active={!!cols.party}>
                        <ColumnFilterText
                          value={cols.party}
                          onChange={v => patchCols({ party: v })}
                          placeholder="Contractor or supplier…"
                        />
                        <ColumnFilterClear
                          disabled={!cols.party}
                          onClear={() => patchCols({ party: '' })}
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className={`${TH} text-left`}>
                      <ColumnHeaderFilter label="Title" active={!!cols.title}>
                        <ColumnFilterText
                          value={cols.title}
                          onChange={v => patchCols({ title: v })}
                          placeholder="Title…"
                        />
                        <ColumnFilterClear
                          disabled={!cols.title}
                          onClear={() => patchCols({ title: '' })}
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className={`${TH} text-right`}>
                      <ColumnHeaderFilter
                        label="Value"
                        align="right"
                        active={!!(cols.valueMin || cols.valueMax)}
                      >
                        <ColumnFilterMoney
                          min={cols.valueMin}
                          max={cols.valueMax}
                          onMin={v => patchCols({ valueMin: v })}
                          onMax={v => patchCols({ valueMax: v })}
                        />
                        <ColumnFilterClear
                          disabled={!cols.valueMin && !cols.valueMax}
                          onClear={() => patchCols({ valueMin: '', valueMax: '' })}
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className={`${TH} text-left`}>
                      <ColumnHeaderFilter label="Status" active={cols.statuses.length > 0}>
                        <ColumnFilterStatus
                          options={statusOptions}
                          selected={cols.statuses}
                          onToggle={id => patchCols({ statuses: toggleStatus(cols.statuses, id) })}
                        />
                        <ColumnFilterClear
                          disabled={cols.statuses.length === 0}
                          onClear={() => patchCols({ statuses: [] })}
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className={`${TH} text-left`}>
                      <ColumnHeaderFilter
                        label="Received"
                        active={!!(cols.dateFrom || cols.dateTo)}
                      >
                        <ColumnFilterDateRange
                          from={cols.dateFrom}
                          to={cols.dateTo}
                          onFrom={v => patchCols({ dateFrom: v })}
                          onTo={v => patchCols({ dateTo: v })}
                        />
                        <ColumnFilterClear
                          disabled={!cols.dateFrom && !cols.dateTo}
                          onClear={() => patchCols({ dateFrom: '', dateTo: '' })}
                        />
                      </ColumnHeaderFilter>
                    </th>
                    <th className={`${TH} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedIncoming.map(q => (
                    <tr
                      key={q.id}
                      onClick={() => openIncoming(q)}
                      className="bg-surface-card border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated transition-colors"
                    >
                      <td className={`${TD} font-mono text-text-secondary`}>{q.quote_number ?? '—'}</td>
                      <td className={TD}>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${q.source === 'supplier' ? 'bg-indigo-50 text-indigo-700' : 'bg-teal-50 text-teal-700'}`}>
                          {q.source === 'supplier' ? `Supplier${q.quote_number ? ` · ${q.quote_number}` : ''}` : 'Contractor'}
                        </span>
                      </td>
                      <td className={`${TD} text-text-primary`}>{q.party ?? '—'}</td>
                      <td className={`${TD} text-text-primary max-w-[240px] truncate`}>
                        {q.title || 'Untitled'}
                      </td>
                      <td className={`${TD} text-right font-medium text-text-primary`}>
                        {q.total_amount == null ? '—' : fmtMoney(q.total_amount, q.currency)}
                      </td>
                      <td className={TD}>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${incomingBadgeClass(q.status)}`}
                        >
                          {incomingLabel(q.status)}
                        </span>
                      </td>
                      <td className={`${TD} text-text-secondary whitespace-nowrap`}>
                        {fmt(q.submitted_at ?? q.created_at)}
                      </td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            openIncoming(q)
                          }}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          {INCOMING_OUTSTANDING.has(q.status) ? 'Review' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            mobile={
              <>
                {pagedIncoming.map(q => (
                  <DataCard key={q.id} onClick={() => openIncoming(q)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <DataCardTitle>{q.title || 'Untitled'}</DataCardTitle>
                        <DataCardMeta>
                          {q.party ?? '—'} · {q.quote_number ?? '—'}
                        </DataCardMeta>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${incomingBadgeClass(q.status)}`}
                      >
                        {incomingLabel(q.status)}
                      </span>
                    </div>
                    <DataCardRow label="Value" value={fmtMoney(q.total_amount, q.currency)} />
                    <DataCardRow label="Received" value={fmt(q.submitted_at ?? q.created_at)} />
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        openIncoming(q)
                      }}
                      className="mt-3 w-full h-10 rounded-lg text-[12px] font-medium bg-primary/10 text-primary"
                    >
                      {INCOMING_OUTSTANDING.has(q.status) ? 'Review' : 'Open'}
                    </button>
                  </DataCard>
                ))}
              </>
            }
          />
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-t border-divider bg-surface shrink-0 flex-wrap">
          <p className="text-[11px] text-text-secondary">
            Showing {from + 1}–{Math.min(to + 1, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="form-input h-7 text-[11px] w-24"
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="h-7 px-2.5 rounded-md border border-divider text-[11px] disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-[11px] text-text-secondary">
              {safePage} / {pages}
            </span>
            <button
              type="button"
              disabled={safePage >= pages}
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              className="h-7 px-2.5 rounded-md border border-divider text-[11px] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptySales({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="material-icons text-[40px] text-text-disabled">request_quote</span>
      <p className="text-text-secondary text-[13px] font-medium">No sales quotes found</p>
      <button type="button" onClick={onCreate} className="btn-primary h-8 px-3 text-[12px]">
        Create your first quote
      </button>
    </div>
  )
}
