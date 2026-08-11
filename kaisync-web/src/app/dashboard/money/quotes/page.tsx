'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { CommercialQuote } from '@/types/database'

type QuoteRow = Pick<CommercialQuote,
  'id' | 'quote_number' | 'title' | 'status' | 'total_amount' |
  'gross_margin_percent' | 'valid_until' | 'created_at'
> & { clients?: { name: string } | null }

type StatusFilter = CommercialQuote['status'] | 'all'

const STATUS_COLORS: Record<CommercialQuote['status'], string> = {
  draft:           'bg-slate-100 text-slate-700',
  internal_review: 'bg-blue-100 text-blue-700',
  sent:            'bg-amber-100 text-amber-700',
  viewed:          'bg-purple-100 text-purple-700',
  accepted:        'bg-green-100 text-green-700',
  declined:        'bg-red-100 text-red-700',
  expired:         'bg-gray-100 text-gray-500',
}

const ALL_STATUSES: CommercialQuote['status'][] = [
  'draft', 'internal_review', 'sent', 'viewed', 'accepted', 'declined', 'expired',
]

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function QuotesPage() {
  const router = useRouter()
  const [quotes,    setQuotes]    = useState<QuoteRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [searchD,   setSearchD]   = useState('')
  const [status,    setStatus]    = useState<StatusFilter>('all')

  useEffect(() => {
    const t = setTimeout(() => setSearchD(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)

    let q = supabase
      .from('commercial_quotes')
      .select('id, quote_number, title, status, total_amount, gross_margin_percent, valid_until, created_at, clients(name)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (status !== 'all') q = q.eq('status', status)
    if (searchD) q = q.or(`quote_number.ilike.%${searchD}%,title.ilike.%${searchD}%`)

    const { data } = await q
    setQuotes((data ?? []) as unknown as QuoteRow[])
    setLoading(false)
  }, [searchD, status])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Quotes</h1>
        <button onClick={() => router.push('/dashboard/money/quotes/new')} className="btn-primary h-9 px-4 text-sm">
          + New Quote
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 py-3 border-b border-divider bg-surface shrink-0 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search quote number or title…"
          className="form-input h-9 flex-1 min-w-[200px]"
        />
        <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className="form-input h-9 w-44">
          <option value="all">All statuses</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-text-secondary text-sm">Loading…</p>
          </div>
        ) : quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="material-icons text-[48px] text-text-disabled">request_quote</span>
            <p className="text-text-secondary text-sm font-medium">No quotes found</p>
            <button onClick={() => router.push('/dashboard/money/quotes/new')} className="btn-primary h-9 px-4 text-sm">Create your first quote</button>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">#</th>
                <th className="data-th text-left">Client</th>
                <th className="data-th text-left">Title</th>
                <th className="data-th text-right">Value</th>
                <th className="data-th text-right">Margin%</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Created</th>
                <th className="data-th text-left">Valid Until</th>
                <th className="data-th"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => (
                <tr
                  key={q.id}
                  onClick={() => router.push(`/dashboard/money/quotes/${q.id}`)}
                  className="bg-surface-card border-b border-divider last:border-0 cursor-pointer hover:bg-surface-elevated transition-colors"
                >
                  <td className="data-td text-sm font-mono text-text-secondary">{q.quote_number ?? '—'}</td>
                  <td className="data-td text-sm text-text-primary">{(q.clients as any)?.name ?? '—'}</td>
                  <td className="data-td text-sm text-text-primary max-w-[220px] truncate">{q.title || 'Untitled'}</td>
                  <td className="data-td text-sm text-right font-medium text-text-primary">{fmtMoney(q.total_amount)}</td>
                  <td className="data-td text-sm text-right text-text-secondary">
                    {q.gross_margin_percent != null ? `${q.gross_margin_percent.toFixed(1)}%` : '—'}
                  </td>
                  <td className="data-td">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${STATUS_COLORS[q.status]}`}>
                      {q.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="data-td text-sm text-text-secondary whitespace-nowrap">{fmt(q.created_at)}</td>
                  <td className="data-td text-sm text-text-secondary whitespace-nowrap">{fmt(q.valid_until)}</td>
                  <td className="data-td">
                    <button
                      onClick={e => { e.stopPropagation(); router.push(`/dashboard/money/quotes/${q.id}`) }}
                      className="text-text-disabled hover:text-text-primary text-sm"
                    >
                      Edit →
                    </button>
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
