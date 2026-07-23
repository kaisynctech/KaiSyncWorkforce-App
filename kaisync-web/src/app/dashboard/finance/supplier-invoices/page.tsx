'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, fmtMoney } from '@/lib/finance-calc'
import { isSupplierKind } from '@/lib/partner-kinds'
import type { SupplierInvoice } from '@/lib/finance-types'

type SupplierOpt = { id: string; name: string }

export default function SupplierInvoicesPage() {
  const [rows, setRows] = useState<SupplierInvoice[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [number, setNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)

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
        .select('id, name, partner_kind, is_supplier')
        .eq('company_id', member.companyId)
        .order('name'),
    ])
    setRows((data ?? []) as SupplierInvoice[])
    setSuppliers(
      ((cons ?? []) as { id: string; name: string; partner_kind?: string | null; is_supplier?: boolean }[])
        .filter(c => isSupplierKind(c.partner_kind) || c.is_supplier === true)
        .map(c => ({ id: c.id, name: c.name })),
    )
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function create() {
    if (!companyId || !supplierId || !(Number(amount) > 0)) return
    setBusy(true)
    const supabase = createClient()
    const calc = calculateVatExclusive(Number(amount), 0.15)
    await supabase.from('supplier_invoices').insert({
      company_id: companyId,
      supplier_id: supplierId,
      invoice_number: number.trim() || null,
      subtotal: calc.subtotal,
      vat_rate: 0.15,
      vat_amount: calc.vatAmount,
      total_amount: calc.totalAmount,
      amount_paid: 0,
      balance_due: calc.totalAmount,
      is_vat_inclusive: false,
      tax_type: 'standard',
      due_date: dueDate || null,
      status: 'received',
      approval_status: 'pending',
      created_by: employeeId,
    })
    setShowAdd(false)
    setNumber(''); setAmount(''); setDueDate(''); setSupplierId('')
    setBusy(false)
    await load()
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
                <tr key={r.id} className="border-b border-divider">
                  <td className="data-td text-[13px]">{(r.contractors as { name: string } | null)?.name ?? '—'}</td>
                  <td className="data-td text-[13px]">{r.invoice_number || '—'}</td>
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
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Invoice number" className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount ex VAT" className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={create} disabled={busy || !supplierId} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">{busy ? '…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
