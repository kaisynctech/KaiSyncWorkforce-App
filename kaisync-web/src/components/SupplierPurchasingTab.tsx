'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'

/** Supplier profile → Purchasing: their purchase orders and price requests (was the separate Supply supplier page). */
type PoRow = { id: string; po_number: string | null; status: string; total_amount: number | null; created_at: string }
type AskRow = {
  id: string
  rfq_id: string
  status: string
  response_total: number | null
  created_at: string
  rfqs: { rfq_number: string | null; title: string | null } | null
}

const PO_STATUS: Record<string, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  sent: 'bg-indigo-100 text-indigo-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
}

export function SupplierPurchasingTab({ companyId, supplierId }: { companyId: string; supplierId: string }) {
  const [pos, setPos] = useState<PoRow[] | null>(null)
  const [asks, setAsks] = useState<AskRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const supabase = createClient()
      const [poRes, askRes] = await Promise.all([
        supabase.from('purchase_orders')
          .select('id, po_number, status, total_amount, created_at')
          .eq('company_id', companyId).eq('supplier_id', supplierId)
          .order('created_at', { ascending: false }).limit(50),
        supabase.from('rfq_recipients')
          .select('id, rfq_id, status, response_total, created_at, rfqs(rfq_number, title)')
          .eq('company_id', companyId).eq('supplier_id', supplierId)
          .order('created_at', { ascending: false }).limit(50),
      ])
      if (!live) return
      if (poRes.error || askRes.error) setError((poRes.error ?? askRes.error)?.message ?? 'Could not load purchasing')
      setPos((poRes.data ?? []) as PoRow[])
      setAsks((askRes.data ?? []) as unknown as AskRow[])
    })()
    return () => { live = false }
  }, [companyId, supplierId])

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex flex-wrap gap-2">
        <Link href={`/dashboard/supply/purchase-orders/new?supplier_id=${supplierId}`} prefetch={false}
          className="btn-primary h-11 px-4 text-[13px] inline-flex items-center gap-1">
          <span className="material-icons text-[18px]">add</span>New purchase order
        </Link>
        <Link href={`/dashboard/supply/rfqs/new?supplier_id=${supplierId}`} prefetch={false}
          className="btn-secondary h-11 px-4 text-[13px] inline-flex items-center gap-1">
          <span className="material-icons text-[18px]">request_quote</span>Ask for prices
        </Link>
      </div>
      {error && <p className="text-[13px] text-error">{error}</p>}

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-text-primary">Purchase orders</h3>
        {pos === null ? <p className="text-[13px] text-text-secondary">Loading…</p>
          : pos.length === 0 ? <p className="text-[13px] text-text-secondary">No purchase orders yet.</p>
          : <ul className="flex flex-col rounded-xl border border-divider bg-surface divide-y divide-divider">
              {pos.map(po => (
                <li key={po.id}>
                  <Link href={`/dashboard/supply/purchase-orders/${po.id}`} prefetch={false}
                    className="flex items-center justify-between gap-3 px-3 py-3 min-h-[44px] hover:bg-surface-elevated/60">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-text-primary">{po.po_number ?? 'Draft'}</span>
                      <span className="block text-[12px] text-text-secondary">{po.created_at.slice(0, 10)}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[13.5px] tabular-nums">{fmtMoney(po.total_amount ?? 0)}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${PO_STATUS[po.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                        {po.status.replace(/_/g, ' ')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-text-primary">Price requests</h3>
        {asks === null ? <p className="text-[13px] text-text-secondary">Loading…</p>
          : asks.length === 0 ? <p className="text-[13px] text-text-secondary">No price requests yet.</p>
          : <ul className="flex flex-col rounded-xl border border-divider bg-surface divide-y divide-divider">
              {asks.map(a => (
                <li key={a.id}>
                  <Link href={`/dashboard/supply/rfqs/${a.rfq_id}`} prefetch={false}
                    className="flex items-center justify-between gap-3 px-3 py-3 min-h-[44px] hover:bg-surface-elevated/60">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-text-primary">{a.rfqs?.rfq_number ?? 'Request'}</span>
                      <span className="block text-[12px] text-text-secondary truncate">{a.rfqs?.title ?? '—'}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[13.5px] tabular-nums">{a.response_total ? fmtMoney(a.response_total) : '—'}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-elevated text-text-secondary capitalize">{a.status}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>}
      </section>
    </div>
  )
}
