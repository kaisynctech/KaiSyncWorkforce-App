'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { KpiTile } from '@/components/ui/KpiTile'
import { quoteStatusLabel } from '@/lib/contractor-portal/quotes'
import type { CommercialQuote } from '@/types/database'
import { cn } from '@/lib/utils'

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
  const router = useRouter()
  const [tab, setTab] = useState<HubTab>('sales')
  const [bucket, setBucket] = useState<BucketFilter>('all')
  const [search, setSearch] = useState('')
  const [searchD, setSearchD] = useState('')
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SalesRow[]>([])
  const [incoming, setIncoming] = useState<IncomingRow[]>([])

  useEffect(() => {
    const t = setTimeout(() => setSearchD(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setBucket('all')
    setSearch('')
    setSearchD('')
  }, [tab])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setLoading(false)
      return
    }

    const [salesRes, incomingRes] = await Promise.all([
      supabase
        .from('commercial_quotes')
        .select('id, quote_number, title, status, total_amount, valid_until, created_at, clients(name)')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false })
        .limit(300),
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
    setLoading(false)
  }, [])

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

  function openIncoming(row: IncomingRow) {
    router.push(
      `/dashboard/contractors/${row.contractor_id}?tab=Quotes&focusType=quote_pending&focus=${row.id}`,
    )
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
                {filteredSales.map(q => (
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
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">#</th>
                <th className="data-th text-left">Contractor</th>
                <th className="data-th text-left">Title</th>
                <th className="data-th text-right">Value</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncoming.map(q => (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
