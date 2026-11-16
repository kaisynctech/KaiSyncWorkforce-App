'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { GrnStatus } from '@/types/commercial'
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

const STATUS_COLOURS: Record<GrnStatus, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  received: 'bg-success/10 text-success',
  partial: 'bg-amber-100 text-amber-700',
}

/** Tab colours follow STATUS_COLOURS. */
const STATUS_TABS = [
  TAB_ALL,
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('received', 'Received', ['received'], 'green'),
  statusTab('partial', 'Partial', ['partial'], 'amber'),
]

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'received', label: 'Received' },
  { id: 'partial', label: 'Partial' },
]

interface GrnRow {
  id: string
  grn_number: string | null
  status: GrnStatus
  received_date: string
  supplier?: { name: string } | null
  po?: { po_number: string | null } | null
}

type Cols = {
  number: string
  supplier: string
  po: string
  statuses: string[]
  dateFrom: string
  dateTo: string
}

const EMPTY_COLS: Cols = { number: '', supplier: '', po: '', statuses: [], dateFrom: '', dateTo: '' }

function colsActive(c: Cols): boolean {
  return !!(c.number || c.supplier || c.po || c.statuses.length || c.dateFrom || c.dateTo)
}

export default function GoodsReceivedPage() {
  const router = useRouter()
  const [grns, setGrns] = useState<GrnRow[]>([])
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
      .from('goods_received_notes')
      .select('*, supplier:contractors!goods_received_notes_supplier_id_fkey(name), po:purchase_orders!goods_received_notes_po_id_fkey(po_number)')
      .eq('company_id', member.companyId)
      .order('received_date', { ascending: false })

    if (err) { setError(err.message); setLoading(false); return }
    setGrns((data ?? []) as GrnRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function patch(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return grns.filter(g => {
      const supplier = g.supplier?.name ?? ''
      const poNumber = g.po?.po_number ?? ''
      if (!matchText(g.grn_number, cols.number)) return false
      if (!matchText(supplier, cols.supplier)) return false
      if (!matchText(poNumber, cols.po)) return false
      if (cols.statuses.length && !cols.statuses.includes(g.status)) return false
      if (!inDateRange(g.received_date, cols.dateFrom, cols.dateTo)) return false
      if (!q) return true
      return (g.grn_number ?? '').toLowerCase().includes(q)
        || supplier.toLowerCase().includes(q)
        || poNumber.toLowerCase().includes(q)
    })
  }, [grns, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Goods received</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">{filtered.length} GRN{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => router.push('/dashboard/supply/goods-received/new')}
          className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1">
          <span className="material-icons text-[16px]">add</span>
          New GRN
        </button>
      </div>

      {error && <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search GRN #, supplier, or PO…"
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
        ) : grns.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">local_shipping</span>
            <p className="text-[13px] text-text-secondary mt-3">No goods received notes yet.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 680 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="GRN Number" value={cols.number} onChange={v => patch({ number: v })} placeholder="GRN #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Supplier" value={cols.supplier} onChange={v => patch({ supplier: v })} placeholder="Supplier name…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="PO Ref" value={cols.po} onChange={v => patch({ po: v })} placeholder="PO #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <DateHeaderFilter
                    label="Received Date"
                    from={cols.dateFrom}
                    to={cols.dateTo}
                    onChange={p => patch({ dateFrom: p.from, dateTo: p.to })}
                  />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter
                    label="Status"
                    options={STATUS_OPTIONS}
                    selected={cols.statuses}
                    onChange={statuses => patch({ statuses })}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                  onClick={() => router.push(`/dashboard/supply/goods-received/${g.id}`)}>
                  <td className={`${MONEY_TD} font-mono font-medium`}>{g.grn_number ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-primary`}>{g.supplier?.name ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{g.po?.po_number ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{g.received_date}</td>
                  <td className={MONEY_TD}>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${STATUS_COLOURS[g.status]}`}>
                      {g.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-[13px] text-text-secondary py-14">
                    No goods received notes match these filters
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
