'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { SupplierInvoice, SupplierInvoiceLine } from '@/lib/finance-types'

interface LinkedPo { id: string; po_number: string | null; total_amount: number; status: string }
interface UnlinkedPo { id: string; po_number: string | null; total_amount: number }

export default function SupplierInvoiceDetailPage() {
  const params = useParams<{ id: string }>()
  const invoiceId = params.id
  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null)
  const [lines, setLines] = useState<SupplierInvoiceLine[]>([])
  const [linkedPo, setLinkedPo] = useState<LinkedPo | null>(null)
  const [unlinkedPos, setUnlinkedPos] = useState<UnlinkedPo[]>([])
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linking, setLinking] = useState(false)
  const [paying, setPaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

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
    const typedInv = inv as SupplierInvoice & { po_id?: string | null; project_id?: string | null }
    setInvoice(typedInv)
    setLines((lineRows ?? []) as SupplierInvoiceLine[])

    // Load linked PO if present
    if (typedInv.po_id) {
      const { data: poData } = await supabase.from('purchase_orders').select('id, po_number, total_amount, status').eq('id', typedInv.po_id).maybeSingle()
      setLinkedPo(poData as LinkedPo | null)
    } else {
      setLinkedPo(null)
      // Load unlinked POs for same supplier
      if (typedInv.supplier_id) {
        const { data: poRows } = await supabase.from('purchase_orders').select('id, po_number, total_amount').eq('company_id', member.companyId).eq('supplier_id', typedInv.supplier_id).is('po_id', null)
        setUnlinkedPos((poRows ?? []) as UnlinkedPo[])
      }
    }
    setLoading(false)
  }, [invoiceId])

  async function linkToPo(poId: string) {
    setLinking(true)
    const supabase = createClient()
    await supabase.from('supplier_invoices').update({ po_id: poId }).eq('id', invoiceId)
    setShowLinkModal(false)
    setLinking(false)
    showToast('Invoice linked to PO.')
    void load()
  }

  async function recordPayment() {
    if (!invoice || paying) return
    setPaying(true)
    setError(null)
    const supabase = createClient()
    const now = new Date().toISOString()
    await supabase.from('supplier_invoices').update({
      amount_paid: invoice.total_amount,
      balance_due: 0,
      status: 'paid',
      paid_at: now,
      updated_at: now,
    }).eq('id', invoiceId)
    // Sync project costs if invoice is linked to a project deal
    const projectId = (invoice as SupplierInvoice & { project_id?: string | null }).project_id
    if (projectId) {
      await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: null }>)(
        'sync_project_costs', { p_deal_id: projectId }
      )
    }
    setPaying(false)
    showToast('Payment recorded.')
    void load()
  }

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
        <div className="flex items-center gap-2">
          <p className="text-[16px] font-semibold text-text-primary">{fmtMoney(invoice.total_amount)}</p>
          {invoice.status !== 'paid' && invoice.balance_due > 0 && (
            <button
              onClick={() => void recordPayment()}
              disabled={paying}
              className="btn-primary h-9 px-3 text-[12px] disabled:opacity-50"
            >
              {paying ? 'Recording…' : 'Record payment'}
            </button>
          )}
          {invoice.status === 'paid' && (
            <span className="text-[11px] text-success font-medium flex items-center gap-1">
              <span className="material-icons text-[14px]">check_circle</span>
              Paid
            </span>
          )}
        </div>
      </div>

      {error && error !== 'not_linked' && (
        <p className="px-4 py-2 text-[12px] text-error">{error}</p>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Linked PO section */}
        <div className="card p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-icons text-[18px] text-text-secondary">shopping_cart</span>
            {linkedPo ? (
              <div>
                <p className="text-[12px] text-text-secondary">Linked Purchase Order</p>
                <Link href={`/dashboard/supply/purchase-orders/${linkedPo.id}`}
                  className="text-[13px] font-semibold text-primary hover:underline">
                  {linkedPo.po_number ?? 'Draft PO'} — {fmtMoney(linkedPo.total_amount)}
                </Link>
                <span className="ml-2 text-[11px] text-text-secondary capitalize">{linkedPo.status.replace(/_/g, ' ')}</span>
              </div>
            ) : (
              <span className="text-[13px] text-text-secondary">No purchase order linked</span>
            )}
          </div>
          {!linkedPo && (
            <button onClick={() => setShowLinkModal(true)} className="btn-secondary h-8 px-3 text-[12px]">
              Link to PO
            </button>
          )}
        </div>

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

      {/* Link PO modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-xl shadow-2xl w-96 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-text-primary">Link to Purchase Order</h3>
              <button onClick={() => setShowLinkModal(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons text-[20px]">close</span>
              </button>
            </div>
            {unlinkedPos.length === 0 ? (
              <p className="text-[13px] text-text-secondary py-4 text-center">No unlinked purchase orders found for this supplier.</p>
            ) : (
              <div className="max-h-64 overflow-auto space-y-1">
                {unlinkedPos.map(po => (
                  <button key={po.id} onClick={() => linkToPo(po.id)} disabled={linking}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-elevated text-[13px] disabled:opacity-50">
                    <span className="font-medium">{po.po_number ?? 'Draft PO'}</span>
                    <span className="ml-2 text-text-secondary">{fmtMoney(po.total_amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
