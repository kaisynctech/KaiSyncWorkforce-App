'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { PurchaseOrder, PoStatus } from '@/types/commercial'

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

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [pos, setPos] = useState<PoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to a company'); setLoading(false); return }

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

  const filtered = pos.filter(p => statusFilter === 'all' || p.status === statusFilter)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Purchase Orders</h1>
          <p className="text-[12px] text-text-secondary">{filtered.length} order{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => router.push('/dashboard/supply/purchase-orders/new')}
          className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
          <span className="material-icons text-[18px]">add</span>
          New PO
        </button>
      </div>

      {error && <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      <div className="flex items-center gap-2 px-4 py-3 shrink-0 flex-wrap">
        {(['all', 'draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'cancelled'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 h-7 rounded-full text-[12px] font-medium transition-colors ${statusFilter === s ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'}`}>
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-4">
        {loading ? (
          <p className="text-[13px] text-text-secondary py-8 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">shopping_cart</span>
            <p className="text-[13px] text-text-secondary mt-3">No purchase orders yet.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">PO Number</th>
                <th className="data-th text-left">Supplier</th>
                <th className="data-th text-right">Total</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Approval</th>
                <th className="data-th text-right">Received %</th>
                <th className="data-th text-left">Date</th>
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
                    <td className="data-td text-[13px] font-mono font-medium">{po.po_number ?? 'Draft'}</td>
                    <td className="data-td text-[13px] text-text-secondary">{(po.supplier as { name: string } | null)?.name ?? '—'}</td>
                    <td className="data-td text-[13px] text-right font-medium">{fmtMoney(po.total_amount)}</td>
                    <td className="data-td">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOURS[po.status]}`}>
                        {STATUS_LABELS[po.status]}
                      </span>
                    </td>
                    <td className="data-td">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${po.approval_status === 'approved' ? 'bg-success/10 text-success' : po.approval_status === 'rejected' ? 'bg-error/10 text-error' : 'bg-surface-elevated text-text-secondary'}`}>
                        {po.approval_status}
                      </span>
                    </td>
                    <td className="data-td text-[12px] text-right">
                      <span className={receivedPct === 100 ? 'text-success font-medium' : receivedPct > 0 ? 'text-amber-600' : 'text-text-secondary'}>
                        {receivedPct}%
                      </span>
                    </td>
                    <td className="data-td text-[12px] text-text-secondary">{po.created_at.slice(0, 10)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
