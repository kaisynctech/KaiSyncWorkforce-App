'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { XeroMark, useXeroStatuses } from '@/components/xero/XeroMark'
import type { PoStatus } from '@/types/commercial'
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

const STATUS_COLOURS: Record<PoStatus, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  sent: 'bg-indigo-100 text-indigo-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
}

const STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  sent: 'Sent',
  partially_received: 'Partial receipt',
  received: 'Received',
  cancelled: 'Cancelled',
}

/** Tab colours follow STATUS_COLOURS. Received also counts partially_received. */
const STATUS_TABS = [
  TAB_ALL,
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('pending_approval', 'Pending', ['pending_approval'], 'amber'),
  statusTab('approved', 'Approved', ['approved'], 'blue'),
  statusTab('sent', 'Sent', ['sent'], 'indigo'),
  statusTab('received', 'Received', ['received', 'partially_received'], 'green'),
  statusTab('cancelled', 'Cancelled', ['cancelled'], 'red'),
]

const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as PoStatus[]).map(id => ({ id, label: STATUS_LABELS[id] }))

const APPROVAL_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

interface PoRow {
  id: string
  po_number: string | null
  status: PoStatus
  approval_status: string
  total_amount: number
  amount_received_value: number
  created_at: string
  supplier?: { name: string } | null
}

type Cols = {
  number: string
  supplier: string
  totalMin: string
  totalMax: string
  statuses: string[]
  approvals: string[]
  dateFrom: string
  dateTo: string
}

const EMPTY_COLS: Cols = {
  number: '', supplier: '', totalMin: '', totalMax: '', statuses: [], approvals: [], dateFrom: '', dateTo: '',
}

function colsActive(c: Cols): boolean {
  return !!(c.number || c.supplier || c.totalMin || c.totalMax || c.statuses.length
    || c.approvals.length || c.dateFrom || c.dateTo)
}

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [pos, setPos] = useState<PoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusTabId, setStatusTabId] = useState('all')
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to a company'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data, error: err } = await supabase
      .from('purchase_orders')
      .select('*, supplier:contractors!purchase_orders_supplier_id_fkey(name)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (err) { setError(err.message); setLoading(false); return }
    setPos((data ?? []) as PoRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function patch(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pos.filter(p => {
      const supplier = p.supplier?.name ?? ''
      if (!matchText(p.po_number ?? 'Draft', cols.number)) return false
      if (!matchText(supplier, cols.supplier)) return false
      if (!matchMoney(p.total_amount, cols.totalMin, cols.totalMax)) return false
      if (cols.statuses.length && !cols.statuses.includes(p.status)) return false
      if (cols.approvals.length && !cols.approvals.includes(p.approval_status)) return false
      if (!inDateRange(p.created_at, cols.dateFrom, cols.dateTo)) return false
      if (!q) return true
      return (p.po_number ?? '').toLowerCase().includes(q) || supplier.toLowerCase().includes(q)
    })
  }, [pos, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])
  // A PO reaches Xero as a bill once it is fully received.
  const xero = useXeroStatuses(companyId, 'po', filtered.slice(0, 300).map(p => p.id))

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Purchase Orders</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">{filtered.length} order{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => router.push('/dashboard/supply/purchase-orders/new')}
          className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1">
          <span className="material-icons text-[16px]">add</span>
          New PO
        </button>
      </div>

      {error && <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search PO # or supplier…"
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
        ) : pos.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">shopping_cart</span>
            <p className="text-[13px] text-text-secondary mt-3">No purchase orders yet.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 820 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="PO Number" value={cols.number} onChange={v => patch({ number: v })} placeholder="PO #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Supplier" value={cols.supplier} onChange={v => patch({ supplier: v })} placeholder="Supplier name…" />
                </th>
                <th className={`${MONEY_TH} text-right`}>
                  <MoneyHeaderFilter
                    label="Total"
                    min={cols.totalMin}
                    max={cols.totalMax}
                    onChange={p => patch({ totalMin: p.min, totalMax: p.max })}
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
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter
                    label="Approval"
                    options={APPROVAL_OPTIONS}
                    selected={cols.approvals}
                    onChange={approvals => patch({ approvals })}
                  />
                </th>
                <th className={`${MONEY_TH} text-right`}>Received %</th>
                <th className={`${MONEY_TH} text-left`}>
                  <DateHeaderFilter
                    label="Date"
                    from={cols.dateFrom}
                    to={cols.dateTo}
                    onChange={p => patch({ dateFrom: p.from, dateTo: p.to })}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(po => {
                const receivedPct = po.total_amount > 0
                  ? Math.round((po.amount_received_value / po.total_amount) * 100)
                  : 0
                return (
                  <tr key={po.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                    onClick={() => router.push(`/dashboard/supply/purchase-orders/${po.id}`)}>
                    <td className={`${MONEY_TD} font-mono font-medium`}>
                      <span className="inline-flex items-center gap-1.5">{po.po_number ?? 'Draft'}
                        {xero.statuses?.[po.id] && (
                          <XeroMark companyId={companyId} kind="po" id={po.id} state={xero.statuses[po.id]} connected={xero.connected} onChanged={() => void xero.reload()} />
                        )}
                      </span>
                    </td>
                    <td className={`${MONEY_TD} text-text-primary`}>{po.supplier?.name ?? '—'}</td>
                    <td className={`${MONEY_TD} text-right font-medium`}>{fmtMoney(po.total_amount, (po as { currency?: string | null }).currency)}</td>
                    <td className={MONEY_TD}>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${STATUS_COLOURS[po.status]}`}>
                        {STATUS_LABELS[po.status]}
                      </span>
                    </td>
                    <td className={MONEY_TD}>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${po.approval_status === 'approved' ? 'bg-success/10 text-success' : po.approval_status === 'rejected' ? 'bg-error/10 text-error' : 'bg-surface-elevated text-text-secondary'}`}>
                        {po.approval_status}
                      </span>
                    </td>
                    <td className={`${MONEY_TD} text-right`}>
                      <span className={receivedPct === 100 ? 'text-success font-medium' : receivedPct > 0 ? 'text-amber-600' : 'text-text-secondary'}>
                        {receivedPct}%
                      </span>
                    </td>
                    <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{po.created_at.slice(0, 10)}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-14">
                    No purchase orders match these filters
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
