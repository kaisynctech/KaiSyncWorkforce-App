'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, fmtMoney, roundFinancial } from '@/lib/finance-calc'
import { isSupplierKind } from '@/lib/partner-kinds'
import { XeroMark, useXeroStatuses } from '@/components/xero/XeroMark'
import type { SupplierInvoice } from '@/lib/finance-types'
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
  StatusHeaderFilter,
  ResetFiltersButton,
  matchText,
  matchMoney,
  statusTab,
} from '@/components/ui/MoneyListFilters'

type SupplierOpt = { id: string; name: string }

/** supplier_invoices.status CHECK: draft, received, approved, partially_paid, paid, overdue, cancelled. */
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  received: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const STATUS_TABS = [
  TAB_ALL,
  statusTab('draft', 'Draft', ['draft'], 'slate'),
  statusTab('received', 'Received', ['received'], 'amber'),
  statusTab('approved', 'Approved', ['approved'], 'blue'),
  statusTab('partially_paid', 'Part paid', ['partially_paid'], 'purple'),
  statusTab('paid', 'Paid', ['paid'], 'green'),
  statusTab('overdue', 'Overdue', ['overdue'], 'red'),
  statusTab('cancelled', 'Cancelled', ['cancelled'], 'gray'),
]

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'received', label: 'Received' },
  { id: 'approved', label: 'Approved' },
  { id: 'partially_paid', label: 'Partially paid' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'cancelled', label: 'Cancelled' },
]

/** supplier_invoices.approval_status CHECK: pending, approved, rejected. */
const APPROVAL_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

type Cols = {
  bill: string
  supplier: string
  theirInvoice: string
  statuses: string[]
  approvals: string[]
  totalMin: string
  totalMax: string
  balanceMin: string
  balanceMax: string
}

const EMPTY_COLS: Cols = {
  bill: '', supplier: '', theirInvoice: '', statuses: [], approvals: [],
  totalMin: '', totalMax: '', balanceMin: '', balanceMax: '',
}

function colsActive(c: Cols): boolean {
  return !!(c.bill || c.supplier || c.theirInvoice || c.statuses.length || c.approvals.length
    || c.totalMin || c.totalMax || c.balanceMin || c.balanceMax)
}

export default function SupplierInvoicesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <SupplierInvoicesPageInner />
    </Suspense>
  )
}

function SupplierInvoicesPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [rows, setRows] = useState<SupplierInvoice[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [poId, setPoId] = useState('')
  const [grnId, setGrnId] = useState('')
  const [grnNumber, setGrnNumber] = useState('')
  const [number, setNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const xero = useXeroStatuses(companyId, 'supplier_invoice', rows.slice(0, 300).map(r => r.id))
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [prefillApplied, setPrefillApplied] = useState(false)
  const [statusTabId, setStatusTabId] = useState('all')
  const [search, setSearch] = useState('')
  const [cols, setCols] = useState<Cols>(EMPTY_COLS)

  function patchCols(p: Partial<Cols>) { setCols(prev => ({ ...prev, ...p })) }

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const supplier = (r.contractors as { name: string } | null)?.name ?? ''
      if (!matchText(r.bill_number, cols.bill)) return false
      if (!matchText(supplier, cols.supplier)) return false
      if (!matchText(r.invoice_number, cols.theirInvoice)) return false
      if (cols.statuses.length && !cols.statuses.includes(r.status)) return false
      if (cols.approvals.length && !cols.approvals.includes(r.approval_status)) return false
      if (!matchMoney(r.total_amount, cols.totalMin, cols.totalMax)) return false
      if (!matchMoney(r.balance_due, cols.balanceMin, cols.balanceMax)) return false
      if (!q) return true
      return (r.bill_number ?? '').toLowerCase().includes(q)
        || supplier.toLowerCase().includes(q)
        || (r.invoice_number ?? '').toLowerCase().includes(q)
    })
  }, [rows, cols, search])

  const counts = useMemo(() => countByStatusTab(base, STATUS_TABS), [base])
  const filtered = useMemo(() => filterByStatusTab(base, STATUS_TABS, statusTabId), [base, statusTabId])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [{ data }, { data: cons }] = await Promise.all([
      supabase
        .from('supplier_invoices')
        .select('*, contractors!supplier_invoices_supplier_id_fkey(name)')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('contractors')
        .select('id, name, partner_kind')
        .eq('company_id', member.companyId)
        .order('name'),
    ])
    setRows((data ?? []) as SupplierInvoice[])
    setSuppliers(
      ((cons ?? []) as { id: string; name: string; partner_kind?: string | null }[])
        .filter(c => isSupplierKind(c.partner_kind))
        .map(c => ({ id: c.id, name: c.name })),
    )
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (prefillApplied) return
    const qPo = searchParams.get('po_id')
    const qSupplier = searchParams.get('supplier_id')
    const qGrn = searchParams.get('grn_id')
    const qGrnNumber = searchParams.get('grn_number')
    const qAmount = searchParams.get('amount')
    if (!qPo && !qSupplier && !qGrn) return
    if (qPo) setPoId(qPo)
    if (qSupplier) setSupplierId(qSupplier)
    if (qGrn) setGrnId(qGrn)
    if (qGrnNumber) setGrnNumber(qGrnNumber)
    if (qAmount && Number(qAmount) > 0) setAmount(qAmount)
    setShowAdd(true)
    setPrefillApplied(true)
  }, [searchParams, prefillApplied])

  async function create() {
    if (!companyId || !supplierId) return
    if (!(Number(amount) > 0) && !grnId && !poId) return
    setBusy(true)
    const supabase = createClient()
    const vatRate = 0.15
    const noteParts = [
      grnNumber ? `From GRN ${grnNumber}` : (grnId ? `From GRN ${grnId}` : null),
      poId ? `PO linked` : null,
    ].filter(Boolean)

    type SourceLine = {
      description: string
      quantity: number
      unit_price: number
      inventory_item_id: string | null
    }
    let sourceLines: SourceLine[] = []

    if (grnId) {
      const { data: grnLines } = await supabase
        .from('goods_received_lines')
        .select('description, quantity_received, unit_cost, inventory_item_id')
        .eq('grn_id', grnId)
        .order('created_at')
      sourceLines = ((grnLines ?? []) as {
        description: string
        quantity_received: number
        unit_cost: number
        inventory_item_id: string | null
      }[])
        .filter(l => l.description?.trim() && Number(l.quantity_received) > 0)
        .map(l => ({
          description: l.description.trim(),
          quantity: Number(l.quantity_received) || 0,
          unit_price: Number(l.unit_cost) || 0,
          inventory_item_id: l.inventory_item_id,
        }))
    } else if (poId) {
      const { data: poLines } = await supabase
        .from('purchase_order_lines')
        .select('description, quantity_ordered, unit_price, inventory_item_id')
        .eq('po_id', poId)
        .order('sort_order')
      sourceLines = ((poLines ?? []) as {
        description: string
        quantity_ordered: number
        unit_price: number
        inventory_item_id: string | null
      }[])
        .filter(l => l.description?.trim())
        .map(l => ({
          description: l.description.trim(),
          quantity: Number(l.quantity_ordered) || 0,
          unit_price: Number(l.unit_price) || 0,
          inventory_item_id: l.inventory_item_id,
        }))
    }

    let headerSubtotal = Number(amount)
    let linePayloads: Array<Record<string, unknown>> = []

    if (sourceLines.length > 0) {
      linePayloads = sourceLines.map((l, idx) => {
        const lineSub = roundFinancial(l.quantity * l.unit_price)
        const lineCalc = calculateVatExclusive(lineSub, vatRate)
        return {
          company_id: companyId,
          line_no: idx + 1,
          inventory_item_id: l.inventory_item_id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          subtotal: lineCalc.subtotal,
          vat_rate: vatRate,
          vat_amount: lineCalc.vatAmount,
          total_amount: lineCalc.totalAmount,
          is_vat_inclusive: false,
          tax_type: 'standard',
        }
      })
      headerSubtotal = roundFinancial(
        linePayloads.reduce((s, l) => s + Number(l.subtotal), 0),
      )
    }

    if (!(headerSubtotal > 0)) {
      setBusy(false)
      return
    }

    const calc = calculateVatExclusive(headerSubtotal, vatRate)
    const { data: inserted, error } = await supabase.from('supplier_invoices').insert({
      company_id: companyId,
      supplier_id: supplierId,
      po_id: poId || null,
      invoice_number: number.trim() || null,
      subtotal: calc.subtotal,
      vat_rate: vatRate,
      vat_amount: calc.vatAmount,
      total_amount: calc.totalAmount,
      amount_paid: 0,
      balance_due: calc.totalAmount,
      is_vat_inclusive: false,
      tax_type: 'standard',
      due_date: dueDate || null,
      notes: noteParts.length ? noteParts.join(' · ') : null,
      status: 'received',
      approval_status: 'pending',
      created_by: employeeId,
    }).select('id').single()

    if (error || !inserted) {
      setBusy(false)
      return
    }

    const invoiceId = (inserted as { id: string }).id
    if (linePayloads.length > 0) {
      await supabase.from('supplier_invoice_lines').insert(
        linePayloads.map(l => ({ ...l, invoice_id: invoiceId })),
      )
    }

    setBusy(false)
    setShowAdd(false)
    setNumber(''); setAmount(''); setDueDate(''); setSupplierId(''); setPoId(''); setGrnId(''); setGrnNumber('')
    router.push(`/dashboard/finance/supplier-invoices/${invoiceId}`)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Supplier Invoices</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary h-8 px-3 text-[12px]">+ Invoice</button>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search bill #, supplier, or their invoice…"
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
          <table className="w-full" style={{ minWidth: 820 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Bill" value={cols.bill} onChange={v => patchCols({ bill: v })} placeholder="Bill #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Supplier" value={cols.supplier} onChange={v => patchCols({ supplier: v })} placeholder="Supplier name…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter label="Their invoice" value={cols.theirInvoice} onChange={v => patchCols({ theirInvoice: v })} placeholder="Their invoice #…" />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter
                    label="Status"
                    options={STATUS_OPTIONS}
                    selected={cols.statuses}
                    onChange={statuses => patchCols({ statuses })}
                  />
                </th>
                <th className={`${MONEY_TH} text-left`}>
                  <StatusHeaderFilter
                    label="Approval"
                    options={APPROVAL_OPTIONS}
                    selected={cols.approvals}
                    onChange={approvals => patchCols({ approvals })}
                  />
                </th>
                <th className={`${MONEY_TH} text-right`}>
                  <MoneyHeaderFilter
                    label="Total"
                    min={cols.totalMin}
                    max={cols.totalMax}
                    onChange={p => patchCols({ totalMin: p.min, totalMax: p.max })}
                  />
                </th>
                <th className={`${MONEY_TH} text-right`}>
                  <MoneyHeaderFilter
                    label="Balance"
                    min={cols.balanceMin}
                    max={cols.balanceMax}
                    onChange={p => patchCols({ balanceMin: p.min, balanceMax: p.max })}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-divider cursor-pointer hover:bg-surface-elevated transition-colors"
                  onClick={() => router.push(`/dashboard/finance/supplier-invoices/${r.id}`)}
                >
                  <td className={`${MONEY_TD} font-medium text-primary`}>
                    <span className="inline-flex items-center gap-1.5">{r.bill_number ?? '—'}
                      {(r.approval_status === 'approved' || xero.statuses?.[r.id]) && (
                        <XeroMark companyId={companyId} kind="supplier_invoice" id={r.id} state={xero.statuses?.[r.id]} connected={xero.connected}
                          canSend={r.approval_status === 'approved'} onChanged={() => void xero.reload()} />
                      )}
                    </span>
                  </td>
                  <td className={`${MONEY_TD} text-text-primary`}>{(r.contractors as { name: string } | null)?.name ?? '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{r.invoice_number || '—'}</td>
                  <td className={MONEY_TD}>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`${MONEY_TD} capitalize`}>{r.approval_status}</td>
                  <td className={`${MONEY_TD} text-right`}>{fmtMoney(r.total_amount)}</td>
                  <td className={`${MONEY_TD} text-right`}>{fmtMoney(r.balance_due)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-10">
                    {rows.length === 0 ? 'No supplier invoices' : 'No supplier invoices match these filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New supplier invoice</h3>
            {(poId || grnNumber) && (
              <p className="text-[12px] text-text-secondary bg-surface-elevated rounded-lg px-3 py-2">
                {grnNumber ? `From GRN ${grnNumber}` : 'From goods received'}
                {poId ? ' · PO will be linked' : ''}
                {' · '}Line items will be copied automatically
              </p>
            )}
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Invoice number" className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount ex VAT" className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={() => void create()} disabled={busy || !supplierId} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">{busy ? '…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
