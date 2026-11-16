'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { RfqStatus } from '@/types/commercial'
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
  DateHeaderFilter,
  StatusHeaderFilter,
  ResetFiltersButton,
  matchText,
  inDateRange,
  statusTab,
} from '@/components/ui/MoneyListFilters'

const STATUS_COLOURS: Record<RfqStatus, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  sent: 'bg-blue-100 text-blue-700',
  responses_received: 'bg-amber-100 text-amber-700',
  closed: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
}

const STATUS_LABELS: Record<RfqStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  responses_received: 'Responses received',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

/** Tab colours follow STATUS_COLOURS (draft grey, sent blue, responses amber, closed green, cancelled red). */
const STATUS_TABS = [
  TAB_ALL,
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('sent', 'Sent', ['sent'], 'blue'),
  statusTab('responses_received', 'Responses', ['responses_received'], 'amber'),
  statusTab('closed', 'Closed', ['closed'], 'green'),
  statusTab('cancelled', 'Cancelled', ['cancelled'], 'red'),
]

const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as RfqStatus[]).map(id => ({ id, label: STATUS_LABELS[id] }))

interface RfqRow {
  id: string
  rfq_number: string | null
  title: string
  status: RfqStatus
  response_deadline: string | null
  created_at: string
  deal?: { title: string } | null
  deal_id?: string | null
  quote?: { quote_number: string | null; title: string } | null
  quote_id?: string | null
}

type Cols = {
  number: string
  title: string
  project: string
  quote: string
  statuses: string[]
  deadlineFrom: string
  deadlineTo: string
  createdFrom: string
  createdTo: string
}

const EMPTY_COLS: Cols = {
  number: '', title: '', project: '', quote: '', statuses: [],
  deadlineFrom: '', deadlineTo: '', createdFrom: '', createdTo: '',
}

function colsActive(c: Cols): boolean {
  return !!(c.number || c.title || c.project || c.quote || c.statuses.length
    || c.deadlineFrom || c.deadlineTo || c.createdFrom || c.createdTo)
}

export default function RfqListPage() {
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RfqRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusTabId, setStatusTabId] = useState('all')
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to a company'); setLoading(false); return }

    const { data, error: err } = await supabase
      .from('rfqs')
      .select('*, deal:client_deals(title), quote:commercial_quotes(quote_number, title)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (err) { setError(err.message); setLoading(false); return }
    setRfqs((data ?? []) as RfqRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function patch(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rfqs.filter(r => {
      const project = r.deal?.title ?? ''
      const quote = r.quote ? (r.quote.quote_number ?? 'Quote') : ''
      if (!matchText(r.rfq_number, cols.number)) return false
      if (!matchText(r.title, cols.title)) return false
      if (!matchText(project, cols.project)) return false
      if (!matchText(quote, cols.quote)) return false
      if (cols.statuses.length && !cols.statuses.includes(r.status)) return false
      if (!inDateRange(r.response_deadline, cols.deadlineFrom, cols.deadlineTo)) return false
      if (!inDateRange(r.created_at, cols.createdFrom, cols.createdTo)) return false
      if (!q) return true
      return (r.rfq_number ?? '').toLowerCase().includes(q)
        || r.title.toLowerCase().includes(q)
        || project.toLowerCase().includes(q)
        || quote.toLowerCase().includes(q)
        || (r.quote?.title ?? '').toLowerCase().includes(q)
    })
  }, [rfqs, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Ask suppliers</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">{filtered.length} RFQ{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => router.push('/dashboard/supply/rfqs/new')}
          className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1">
          <span className="material-icons text-[16px]">add</span>
          New RFQ
        </button>
      </div>

      {error && <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search RFQ #, title, project, or quote…"
          className="form-input h-8 flex-1 min-w-[180px] text-[12px]"
        />
        <ResetFiltersButton
          disabled={!colsActive(cols) && !search}
          onReset={() => { setCols(EMPTY_COLS); setSearch('') }}
        />
        <StatusFilterTabs tabs={STATUS_TABS} value={statusTabId} counts={counts} onChange={setStatusTabId} />
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-[13px] text-text-secondary py-8 text-center">Loading…</p>
        ) : rfqs.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">request_quote</span>
            <p className="text-[13px] text-text-secondary mt-3">
              No RFQs yet. Create one from Supply or from a sales quote.
            </p>
            <button
              type="button"
              onClick={() => router.push('/dashboard/supply/rfqs/new')}
              className="btn-primary h-9 px-4 text-[13px] mt-4"
            >
              New RFQ
            </button>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 820 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Number" value={cols.number} onChange={v => patch({ number: v })} placeholder="RFQ #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Title" value={cols.title} onChange={v => patch({ title: v })} placeholder="Title…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Project" value={cols.project} onChange={v => patch({ project: v })} placeholder="Project…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Quote" value={cols.quote} onChange={v => patch({ quote: v })} placeholder="Quote #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter
                    label="Status"
                    options={STATUS_OPTIONS}
                    selected={cols.statuses}
                    onChange={statuses => patch({ statuses })}
                  />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <DateHeaderFilter
                    label="Deadline"
                    from={cols.deadlineFrom}
                    to={cols.deadlineTo}
                    onChange={p => patch({ deadlineFrom: p.from, deadlineTo: p.to })}
                  />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <DateHeaderFilter
                    label="Created"
                    from={cols.createdFrom}
                    to={cols.createdTo}
                    onChange={p => patch({ createdFrom: p.from, createdTo: p.to })}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(rfq => (
                <tr key={rfq.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                  onClick={() => router.push(`/dashboard/supply/rfqs/${rfq.id}`)}>
                  <td className={`${MONEY_TD} font-mono font-medium`}>{rfq.rfq_number ?? '—'}</td>
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{rfq.title}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>
                    {rfq.deal?.title ?? '—'}
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary`}>
                    {rfq.quote ? `${rfq.quote.quote_number ?? 'Quote'}` : '—'}
                  </td>
                  <td className={MONEY_TD}>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${STATUS_COLOURS[rfq.status]}`}>
                      {STATUS_LABELS[rfq.status]}
                    </span>
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{rfq.response_deadline ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{rfq.created_at.slice(0, 10)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-14">
                    No RFQs match these filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
