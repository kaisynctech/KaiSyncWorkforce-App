'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { XeroMark, useXeroStatuses } from '@/components/xero/XeroMark'
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

type CreditNoteRow = {
  id: string
  credit_note_number: string | null
  status: string
  reason_code: string | null
  total_amount: number
  issue_date: string | null
  clients: { name: string } | null
  finance_invoices: { invoice_number: string | null } | null
}

const STATUS_BADGE: Record<string, string> = {
  draft:             'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  approved:          'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  applied:           'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  voided:            'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

/** Tab colours follow STATUS_BADGE (approved is shown to users as "Issued"). */
const STATUS_TABS = [
  TAB_ALL,
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('issued', 'Issued', ['approved'], 'green'),
  statusTab('applied', 'Applied', ['applied'], 'purple'),
  statusTab('voided', 'Voided', ['voided'], 'gray'),
]

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'pending_approval', label: 'Pending approval' },
  { id: 'approved', label: 'Issued' },
  { id: 'applied', label: 'Applied' },
  { id: 'voided', label: 'Voided' },
]

type Cols = {
  number: string
  invoice: string
  client: string
  reason: string
  amountMin: string
  amountMax: string
  statuses: string[]
  dateFrom: string
  dateTo: string
}

const EMPTY_COLS: Cols = {
  number: '', invoice: '', client: '', reason: '',
  amountMin: '', amountMax: '', statuses: [], dateFrom: '', dateTo: '',
}

function colsActive(c: Cols): boolean {
  return !!(c.number || c.invoice || c.client || c.reason || c.amountMin || c.amountMax
    || c.statuses.length || c.dateFrom || c.dateTo)
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status === 'approved' ? 'issued' : status.replace(/_/g, ' ')}
    </span>
  )
}

export default function CreditNotesPage() {
  const router = useRouter()
  const [rows, setRows]       = useState<CreditNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [statusTabId, setStatusTabId] = useState('all')
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    const { data } = await supabase
      .from('credit_notes')
      .select('id, credit_note_number, status, reason_code, total_amount, issue_date, clients(name), finance_invoices(invoice_number)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })
    setRows((data ?? []) as unknown as CreditNoteRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function patch(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const client = r.clients?.name ?? ''
      const invoice = r.finance_invoices?.invoice_number ?? ''
      const reason = (r.reason_code ?? '').replace(/_/g, ' ')
      if (!matchText(r.credit_note_number, cols.number)) return false
      if (!matchText(invoice, cols.invoice)) return false
      if (!matchText(client, cols.client)) return false
      if (!matchText(reason, cols.reason)) return false
      if (!matchMoney(r.total_amount, cols.amountMin, cols.amountMax)) return false
      if (cols.statuses.length && !cols.statuses.includes(r.status)) return false
      if (!inDateRange(r.issue_date, cols.dateFrom, cols.dateTo)) return false
      if (!q) return true
      return (r.credit_note_number ?? '').toLowerCase().includes(q)
        || invoice.toLowerCase().includes(q)
        || client.toLowerCase().includes(q)
        || reason.toLowerCase().includes(q)
    })
  }, [rows, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])
  const xero = useXeroStatuses(companyId, 'credit_note', filtered.slice(0, 300).map(r => r.id))

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Credit Notes</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">Issue from an invoice detail page</p>
        </div>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search credit note #, invoice, client, or reason…"
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
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="#" value={cols.number} onChange={v => patch({ number: v })} placeholder="Credit note #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Invoice" value={cols.invoice} onChange={v => patch({ invoice: v })} placeholder="Invoice #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Client" value={cols.client} onChange={v => patch({ client: v })} placeholder="Client name…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Reason" value={cols.reason} onChange={v => patch({ reason: v })} placeholder="Reason…" />
                </th>
                <th className={`${MONEY_TH} text-right`}>
                  <MoneyHeaderFilter
                    label="Amount"
                    min={cols.amountMin}
                    max={cols.amountMax}
                    onChange={p => patch({ amountMin: p.min, amountMax: p.max })}
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
              {filtered.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-divider hover:bg-surface-elevated transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/money/credit-notes/${r.id}`)}
                >
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>
                    <span className="inline-flex items-center gap-1.5">
                      {r.credit_note_number || <span className="text-text-disabled italic">draft</span>}
                      {r.status === 'approved' && (
                        <XeroMark companyId={companyId} kind="credit_note" id={r.id} state={xero.statuses?.[r.id]} connected={xero.connected} onChanged={() => void xero.reload()} />
                      )}
                    </span>
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary`}>
                    {r.finance_invoices?.invoice_number ?? '—'}
                  </td>
                  <td className={`${MONEY_TD} text-text-primary`}>
                    {r.clients?.name ?? '—'}
                  </td>
                  <td className={`${MONEY_TD} text-text-secondary capitalize`}>
                    {(r.reason_code ?? '—').replace(/_/g, ' ')}
                  </td>
                  <td className={`${MONEY_TD} text-right font-medium text-text-primary`}>
                    {fmtMoney(r.total_amount)}
                  </td>
                  <td className={MONEY_TD}><StatusBadge status={r.status} /></td>
                  <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{r.issue_date ?? '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-14">
                    <span className="material-icons text-[32px] text-text-disabled block mb-1">undo</span>
                    {rows.length === 0
                      ? 'No credit notes yet — issue one from an invoice'
                      : 'No credit notes match these filters'}
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
