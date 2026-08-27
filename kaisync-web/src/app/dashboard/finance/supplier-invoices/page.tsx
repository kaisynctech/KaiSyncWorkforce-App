'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, fmtMoney, roundFinancial } from '@/lib/finance-calc'
import { isSupplierKind } from '@/lib/partner-kinds'
import type { SupplierInvoice } from '@/lib/finance-types'

type SupplierOpt = { id: string; name: string }

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
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [prefillApplied, setPrefillApplied] = useState(false)

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
        <h1 className="text-[18px] font-semibold text-text-primary">Supplier Invoices</h1>
        <button onClick={() => setShowAdd(true)} className="btn-primary h-9 px-3 text-[13px]">+ Invoice</button>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 800 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Supplier</th>
                <th className="data-th text-left">Number</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Approval</th>
                <th className="data-th text-right">Total</th>
                <th className="data-th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-divider cursor-pointer hover:bg-background"
                  onClick={() => router.push(`/dashboard/finance/supplier-invoices/${r.id}`)}
                >
                  <td className="data-td text-[13px]">{(r.contractors as { name: string } | null)?.name ?? '—'}</td>
                  <td className="data-td text-[13px] text-primary">{r.invoice_number || '—'}</td>
                  <td className="data-td text-[12px] capitalize">{r.status.replace(/_/g, ' ')}</td>
                  <td className="data-td text-[12px] capitalize">{r.approval_status}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.total_amount)}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(r.balance_due)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-[13px] text-text-secondary py-10">No supplier invoices</td></tr>
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
