'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { KpiTile } from '@/components/ui/KpiTile'
import { quoteStatusLabel } from '@/lib/contractor-portal/quotes'
import type { CommercialQuote } from '@/types/database'
import { cn } from '@/lib/utils'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  pageRange,
  totalPages,
} from '@/lib/list-pagination'

type HubTab = 'sales' | 'incoming'

type SalesRow = Pick<
  CommercialQuote,
  'id' | 'quote_number' | 'title' | 'status' | 'total_amount' | 'valid_until' | 'created_at'
> & { clients?: { name: string } | null }

type IncomingRow = {
  id: string
  title: string | null
  quote_number: string | null
  status: string
  total_amount: number | null
  submitted_at: string | null
  created_at: string
  contractor_id: string
  contractors?: { name: string } | null
}

type BucketFilter = 'all' | 'outstanding' | 'accepted' | 'done'

const SALES_STATUS_COLORS: Record<CommercialQuote['status'], string> = {
  draft: 'bg-slate-100 text-slate-700',
  internal_review: 'bg-blue-100 text-blue-700',
  sent: 'bg-amber-100 text-amber-700',
  viewed: 'bg-purple-100 text-purple-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
}

const SALES_OUTSTANDING = new Set(['draft', 'internal_review', 'sent', 'viewed'])
const SALES_DONE = new Set(['declined', 'expired'])

const INCOMING_OUTSTANDING = new Set(['submitted', 'under_review', 'revision_requested'])
const INCOMING_ACCEPTED = new Set(['approved'])
const INCOMING_DONE = new Set(['rejected', 'converted', 'expired'])

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function salesBucket(status: string): Exclude<BucketFilter, 'all'> {
  if (status === 'accepted') return 'accepted'
  if (SALES_DONE.has(status)) return 'done'
  return 'outstanding'
}

function incomingBucket(status: string): Exclude<BucketFilter, 'all'> {
  if (INCOMING_ACCEPTED.has(status)) return 'accepted'
  if (INCOMING_DONE.has(status)) return 'done'
  return 'outstanding'
}

function incomingBadgeClass(status: string): string {
  switch (status) {
    case 'submitted':
    case 'under_review':
      return 'bg-amber-100 text-amber-700'
    case 'revision_requested':
      return 'bg-blue-100 text-blue-700'
    case 'approved':
      return 'bg-green-100 text-green-700'
    case 'rejected':
      return 'bg-red-100 text-red-700'
    case 'converted':
      return 'bg-slate-100 text-slate-700'
    default:
      return 'bg-gray-100 text-gray-500'
  }
}

export default function QuotesPage() {
  return (
    <Suspense fallback={<p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>}>
      <QuotesPageInner />
    </Suspense>
  )
}

function QuotesPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientFilter = searchParams.get('client') ?? searchParams.get('client_id')
  const jobFilter = searchParams.get('job_id')
  const dealFilter = searchParams.get('deal_id') ?? searchParams.get('project_id')

  const [tab, setTab] = useState<HubTab>('sales')
  const [bucket, setBucket] = useState<BucketFilter>('all')
  const [search, setSearch] = useState('')
  const [searchD, setSearchD] = useState('')
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
    setBucket(tab === 'incoming' ? 'outstanding' : 'all')
    setSearch('')
    setSearchD('')
    setPage(1)
  }, [tab])

  useEffect(() => {
    setPage(1)
  }, [bucket, searchD, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setLoading(false)
      return
    }

    let salesQ = supabase
      .from('commercial_quotes')
      .select('id, quote_number, title, status, total_amount, valid_until, created_at, clients(name)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })
      .limit(300)

    if (clientFilter) salesQ = salesQ.eq('client_id', clientFilter)
    if (jobFilter) salesQ = salesQ.eq('job_id', jobFilter)
    if (dealFilter) salesQ = salesQ.eq('deal_id', dealFilter)

    const [salesRes, incomingRes] = await Promise.all([
      salesQ,
      supabase
        .from('contractor_quotes')
        .select(
          'id, title, quote_number, status, total_amount, submitted_at, created_at, contractor_id, contractors(name)',
        )
        .eq('company_id', member.companyId)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(300),
    ])

    setSales((salesRes.data ?? []) as unknown as SalesRow[])
    setIncoming((incomingRes.data ?? []) as unknown as IncomingRow[])

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
      const { data: d } = await supabase.from('client_deals').select('title, project_code').eq('id', dealFilter).maybeSingle()
      if (d) labels.deal = d.project_code ? `${d.project_code} · ${d.title}` : d.title
    }
    setFilterLabels(labels)
    setLoading(false)
  }, [clientFilter, jobFilter, dealFilter])

  useEffect(() => {
    void load()
  }, [load])

  const salesKpis = useMemo(() => {
    let outstanding = 0
    let accepted = 0
    let done = 0
    for (const q of sales) {
      const b = salesBucket(q.status)
      if (b === 'outstanding') outstanding += 1
      else if (b === 'accepted') accepted += 1
      else done += 1
    }
    return { outstanding, accepted, done }
  }, [sales])

  const incomingKpis = useMemo(() => {
    let outstanding = 0
    let accepted = 0
    let done = 0
    for (const q of incoming) {
      const b = incomingBucket(q.status)
      if (b === 'outstanding') outstanding += 1
      else if (b === 'accepted') accepted += 1
      else done += 1
    }
    return { outstanding, accepted, done }
  }, [incoming])

  const filteredSales = useMemo(() => {
    const q = searchD.toLowerCase()
    return sales.filter(row => {
      if (bucket !== 'all' && salesBucket(row.status) !== bucket) return false
      if (!q) return true
      const client = row.clients?.name ?? ''
      return (
        (row.quote_number ?? '').toLowerCase().includes(q) ||
        (row.title ?? '').toLowerCase().includes(q) ||
        client.toLowerCase().includes(q)
      )
    })
  }, [sales, bucket, searchD])

  const filteredIncoming = useMemo(() => {
    const q = searchD.toLowerCase()
    return incoming.filter(row => {
      if (bucket !== 'all' && incomingBucket(row.status) !== bucket) return false
      if (!q) return true
      const contractor = row.contractors?.name ?? ''
      return (
        (row.quote_number ?? '').toLowerCase().includes(q) ||
        (row.title ?? '').toLowerCase().includes(q) ||
        contractor.toLowerCase().includes(q)
      )
    })
  }, [incoming, bucket, searchD])

  const kpis = tab === 'sales' ? salesKpis : incomingKpis
  const filtered = tab === 'sales' ? filteredSales : filteredIncoming
  const pages = totalPages(filtered.length, pageSize)
  const safePage = Math.min(page, pages)
  const { from, to } = pageRange(safePage, pageSize)
  const pagedSales = filteredSales.slice(from, to + 1)
  const pagedIncoming = filteredIncoming.slice(from, to + 1)

  function openIncoming(row: IncomingRow) {
    router.push(
      `/dashboard/contractors/${row.contractor_id}?tab=Quotes&focusType=quote_pending&focus=${row.id}`,
    )
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
            q.contractors?.name ?? '',
            q.title ?? '',
            String(q.total_amount ?? 0),
            q.status,
            (q.submitted_at ?? q.created_at)?.slice(0, 10) ?? '',
          ])
    const header =
      tab === 'sales'
        ? ['Number', 'Client', 'Title', 'Value', 'Status', 'Created', 'Valid Until']
        : ['Number', 'Contractor', 'Title', 'Value', 'Status', 'Submitted']
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

  const hasScopeFilter = !!(clientFilter || jobFilter || dealFilter)

  function clearScopeFilters() {
    router.replace('/dashboard/money/quotes')
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-semibold text-text-primary">Quotes</h1>
          <p className="text-[12px] text-text-secondary mt-0.5">
            Sales quotes you send · Incoming contractor quotes to review
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="btn-outlined h-9 px-3 text-sm disabled:opacity-40"
          >
            Export
          </button>
          {tab === 'sales' && (
            <button
              type="button"
              onClick={() => router.push('/dashboard/money/quotes/new')}
              className="btn-primary h-9 px-4 text-sm"
            >
              + New Quote
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 px-4 pt-3 border-b border-divider bg-surface shrink-0">
        {(
          [
            { id: 'sales' as const, label: 'Sales' },
            { id: 'incoming' as const, label: 'Incoming' },
          ] as const
        ).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-divider bg-surface shrink-0">
        <KpiTile
          value={kpis.outstanding}
          label="Outstanding"
          bg="#1E293B"
          valueFg="#FCD34D"
          labelFg="#64748B"
        />
        <KpiTile
          value={kpis.accepted}
          label="Accepted"
          bg="#0F2918"
          valueFg="#22C55E"
          labelFg="#4ADE80"
        />
        <KpiTile
          value={kpis.done}
          label="Done"
          bg="#1E293B"
          valueFg="#94A3B8"
          labelFg="#64748B"
        />
      </div>

      <div className="flex gap-2 px-4 py-3 border-b border-divider bg-surface shrink-0 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={
            tab === 'sales'
              ? 'Search quote #, title, or client…'
              : 'Search quote #, title, or contractor…'
          }
          className="form-input h-9 flex-1 min-w-[200px]"
        />
        <div className="flex gap-1 flex-wrap">
          {(
            [
              { id: 'all' as const, label: 'All' },
              { id: 'outstanding' as const, label: 'Outstanding' },
              { id: 'accepted' as const, label: 'Accepted' },
              { id: 'done' as const, label: 'Done' },
            ] as const
          ).map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setBucket(f.id)}
              className={cn(
                'h-9 px-3 rounded-lg text-[12px] font-medium border transition-colors',
                bucket === f.id
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface border-divider text-text-secondary hover:bg-surface-elevated',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {hasScopeFilter && tab === 'sales' && (
          <div className="flex flex-wrap gap-1.5 items-center w-full">
            {filterLabels.client && (
              <span className="h-8 px-2.5 rounded-md bg-surface-elevated border border-divider text-[12px] text-text-primary flex items-center">
                Client: {filterLabels.client}
              </span>
            )}
            {filterLabels.job && (
              <span className="h-8 px-2.5 rounded-md bg-surface-elevated border border-divider text-[12px] text-text-primary flex items-center">
                Job: {filterLabels.job}
              </span>
            )}
            {filterLabels.deal && (
              <span className="h-8 px-2.5 rounded-md bg-surface-elevated border border-divider text-[12px] text-text-primary flex items-center">
                Project: {filterLabels.deal}
              </span>
            )}
            <button
              type="button"
              onClick={clearScopeFilters}
              className="h-8 px-2.5 text-[12px] text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-text-secondary text-sm">Loading…</p>
          </div>
        ) : tab === 'sales' ? (
          filteredSales.length === 0 ? (
            <EmptySales onCreate={() => router.push('/dashboard/money/quotes/new')} />
          ) : (
            <table className="w-full" style={{ minWidth: 900 }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">#</th>
                  <th className="data-th text-left">Client</th>
                  <th className="data-th text-left">Title</th>
                  <th className="data-th text-right">Value</th>
                  <th className="data-th text-left">Status</th>
                  <th className="data-th text-left">Created</th>
                  <th className="data-th text-left">Valid Until</th>
                </tr>
              </thead>
              <tbody>
                {pagedSales.map(q => (
                  <tr
                    key={q.id}
                    onClick={() => router.push(`/dashboard/money/quotes/${q.id}`)}
                    className="bg-surface-card border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated transition-colors"
                  >
                    <td className="data-td text-sm font-mono text-text-secondary">
                      {q.quote_number ?? '—'}
                    </td>
                    <td className="data-td text-sm text-text-primary">{q.clients?.name ?? '—'}</td>
                    <td className="data-td text-sm text-text-primary max-w-[240px] truncate">
                      {q.title || 'Untitled'}
                    </td>
                    <td className="data-td text-sm text-right font-medium text-text-primary">
                      {fmtMoney(q.total_amount)}
                    </td>
                    <td className="data-td">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${SALES_STATUS_COLORS[q.status]}`}
                      >
                        {q.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="data-td text-sm text-text-secondary whitespace-nowrap">
                      {fmt(q.created_at)}
                    </td>
                    <td className="data-td text-sm text-text-secondary whitespace-nowrap">
                      {fmt(q.valid_until)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : filteredIncoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="material-icons text-[48px] text-text-disabled">inbox</span>
            <p className="text-text-secondary text-sm font-medium">No incoming contractor quotes</p>
            <p className="text-[12px] text-text-secondary">
              Submitted quotes from contractors appear here for review.
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 960 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">#</th>
                <th className="data-th text-left">Contractor</th>
                <th className="data-th text-left">Title</th>
                <th className="data-th text-right">Value</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Submitted</th>
                <th className="data-th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedIncoming.map(q => (
                <tr
                  key={q.id}
                  onClick={() => openIncoming(q)}
                  className="bg-surface-card border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated transition-colors"
                >
                  <td className="data-td text-sm font-mono text-text-secondary">
                    {q.quote_number ?? '—'}
                  </td>
                  <td className="data-td text-sm text-text-primary">{q.contractors?.name ?? '—'}</td>
                  <td className="data-td text-sm text-text-primary max-w-[240px] truncate">
                    {q.title || 'Untitled'}
                  </td>
                  <td className="data-td text-sm text-right font-medium text-text-primary">
                    {fmtMoney(q.total_amount)}
                  </td>
                  <td className="data-td">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${incomingBadgeClass(q.status)}`}
                    >
                      {quoteStatusLabel(q.status)}
                    </span>
                  </td>
                  <td className="data-td text-sm text-text-secondary whitespace-nowrap">
                    {fmt(q.submitted_at ?? q.created_at)}
                  </td>
                  <td className="data-td text-right">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        openIncoming(q)
                      }}
                      className="text-[12px] font-medium text-primary hover:underline"
                    >
                      {INCOMING_OUTSTANDING.has(q.status) ? 'Review' : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-divider bg-surface shrink-0 flex-wrap">
          <p className="text-[12px] text-text-secondary">
            Showing {from + 1}–{Math.min(to + 1, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="form-input h-8 text-[12px] w-24"
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
              className="h-8 px-3 rounded-lg border border-divider text-[12px] disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-[12px] text-text-secondary">
              {safePage} / {pages}
            </span>
            <button
              type="button"
              disabled={safePage >= pages}
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              className="h-8 px-3 rounded-lg border border-divider text-[12px] disabled:opacity-40"
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
      <span className="material-icons text-[48px] text-text-disabled">request_quote</span>
      <p className="text-text-secondary text-sm font-medium">No sales quotes found</p>
      <button type="button" onClick={onCreate} className="btn-primary h-9 px-4 text-sm">
        Create your first quote
      </button>
    </div>
  )
}
