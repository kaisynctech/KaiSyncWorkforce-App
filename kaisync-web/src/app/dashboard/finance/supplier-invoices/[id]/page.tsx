'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { SupplierInvoice, SupplierInvoiceLine } from '@/lib/finance-types'

export default function SupplierInvoiceDetailPage() {
  const params = useParams<{ id: string }>()
  const invoiceId = params.id
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null)
  const [lines, setLines] = useState<SupplierInvoiceLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const [{ data: inv, error: invErr }, { data: lineRows, error: lineErr }] = await Promise.all([
      supabase
        .from('supplier_invoices')
        .select('*, contractors!supplier_invoices_supplier_id_fkey(name)')
        .eq('id', invoiceId)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase
        .from('supplier_invoice_lines')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('line_no'),
    ])

    if (invErr || !inv) {
      setError(invErr?.message ?? 'Invoice not found')
      setLoading(false)
      return
    }
    if (lineErr) setError(lineErr.message)
    setInvoice(inv as SupplierInvoice)
    setLines((lineRows ?? []) as SupplierInvoiceLine[])
    setLoading(false)
  }, [invoiceId])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">Loading…</div>
  }

  if (error === 'not_linked' || !invoice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-error">{error ?? 'Not found'}</p>
      </div>
    )
  }

  const supplierName = (invoice.contractors as { name: string } | null)?.name ?? '—'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/finance/supplier-invoices" className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">
              {invoice.invoice_number || 'Supplier invoice'}
            </h1>
            <p className="text-[12px] text-text-secondary">
              {supplierName} · <span className="capitalize">{invoice.status.replace(/_/g, ' ')}</span>
              {' · '}Approval: {invoice.approval_status}
            </p>
          </div>
        </div>
        <p className="text-[16px] font-semibold text-text-primary">{fmtMoney(invoice.total_amount)}</p>
      </div>

      {error && error !== 'not_linked' && (
        <p className="px-4 py-2 text-[12px] text-error">{error}</p>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {invoice.notes && (
          <p className="text-[13px] text-text-secondary">{invoice.notes}</p>
        )}
        <table className="w-full" style={{ minWidth: 720 }}>
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className="data-th text-left">#</th>
              <th className="data-th text-left">Description</th>
              <th className="data-th text-right">Qty</th>
              <th className="data-th text-right">Unit</th>
              <th className="data-th text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="data-td text-center text-text-secondary py-8">
                  No line items (header-only invoice).
                </td>
              </tr>
            ) : lines.map(line => (
              <tr key={line.id} className="border-b border-divider">
                <td className="data-td text-[13px]">{line.line_no}</td>
                <td className="data-td text-[13px]">
                  {line.description}
                  {line.inventory_item_id && (
                    <Link
                      href={`/dashboard/inventory/${line.inventory_item_id}`}
                      className="block text-[11px] text-primary"
                    >
                      View item
                    </Link>
                  )}
                </td>
                <td className="data-td text-[13px] text-right">{line.quantity}</td>
                <td className="data-td text-[13px] text-right">{fmtMoney(line.unit_price)}</td>
                <td className="data-td text-[13px] text-right">{fmtMoney(line.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="max-w-xs ml-auto space-y-1 text-[13px]">
          <div className="flex justify-between"><span className="text-text-secondary">Subtotal</span><span>{fmtMoney(invoice.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">VAT</span><span>{fmtMoney(invoice.vat_amount)}</span></div>
          <div className="flex justify-between font-semibold"><span>Total</span><span>{fmtMoney(invoice.total_amount)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Balance due</span><span>{fmtMoney(invoice.balance_due)}</span></div>
        </div>
      </div>
    </div>
  )
}
