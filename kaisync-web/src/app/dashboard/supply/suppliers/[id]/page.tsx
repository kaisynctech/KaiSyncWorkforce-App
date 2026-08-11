'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { PurchaseOrder } from '@/types/commercial'

interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  vat_number: string | null
  payment_terms: number | null
  bank_account: string | null
  bank_name: string | null
  is_active: boolean
  company_id: string
}

type Tab = 'details' | 'purchase-history' | 'rfq-history'

interface RfqHistoryRow {
  id: string
  rfq_id: string
  status: string
  response_total: number
  responded_at: string | null
  rfqs?: { rfq_number: string | null; title: string } | null
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [rfqHistory, setRfqHistory] = useState<RfqHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('details')
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)

    const [{ data: sup }, { data: poRows }, { data: rfqRows }] = await Promise.all([
      supabase.from('contractors').select('*').eq('id', id).eq('company_id', member.companyId).eq('partner_kind', 'supplier').maybeSingle(),
      supabase.from('purchase_orders').select('*, contractors!purchase_orders_supplier_id_fkey(name)').eq('supplier_id', id).eq('company_id', member.companyId).order('created_at', { ascending: false }),
      supabase.from('rfq_recipients').select('*, rfqs(rfq_number, title)').eq('supplier_id', id).eq('company_id', member.companyId).order('created_at', { ascending: false }),
    ])

    setSupplier(sup as Supplier | null)
    setPos((poRows ?? []) as PurchaseOrder[])
    setRfqHistory((rfqRows ?? []) as RfqHistoryRow[])
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  if (!supplier) return <p className="p-6 text-[13px] text-text-secondary">Supplier not found</p>

  const poStatusColour: Record<string, string> = {
    draft: 'bg-surface-elevated text-text-secondary',
    pending_approval: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    sent: 'bg-indigo-100 text-indigo-700',
    partially_received: 'bg-amber-100 text-amber-700',
    received: 'bg-success/10 text-success',
    cancelled: 'bg-error/10 text-error',
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.push('/dashboard/supply/suppliers')} className="text-text-secondary hover:text-text-primary">
          <span className="material-icons text-[20px]">arrow_back</span>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary truncate">{supplier.name}</h1>
          <p className="text-[12px] text-text-secondary">
            {supplier.is_active ? 'Active' : 'Inactive'} supplier
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-divider shrink-0 px-4">
        {(['details', 'purchase-history', 'rfq-history'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[13px] font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            {t === 'purchase-history' ? 'Purchase History' : t === 'rfq-history' ? 'RFQ History' : 'Details'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'details' && (
          <div className="space-y-4 max-w-lg">
            <div className="card p-4 space-y-3">
              <h3 className="text-[13px] font-semibold text-text-primary">Contact Information</h3>
              <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
                <dt className="text-text-secondary">Email</dt><dd>{supplier.email ?? '—'}</dd>
                <dt className="text-text-secondary">Phone</dt><dd>{supplier.phone ?? '—'}</dd>
                <dt className="text-text-secondary">VAT Number</dt><dd>{supplier.vat_number ?? '—'}</dd>
                <dt className="text-text-secondary">Payment Terms</dt><dd>{supplier.payment_terms != null ? `${supplier.payment_terms} days` : '—'}</dd>
                <dt className="text-text-secondary">Bank</dt><dd>{supplier.bank_name ?? '—'}</dd>
                <dt className="text-text-secondary">Account</dt><dd>{supplier.bank_account ?? '—'}</dd>
              </dl>
            </div>
            <div className="flex gap-2">
              <Link href={`/dashboard/supply/purchase-orders/new?supplier_id=${supplier.id}`}
                className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
                <span className="material-icons text-[18px]">add</span>
                New PO
              </Link>
              <Link href={`/dashboard/supply/rfqs/new?supplier_id=${supplier.id}`}
                className="btn-secondary h-9 px-4 text-[13px] flex items-center gap-1">
                <span className="material-icons text-[18px]">request_quote</span>
                New RFQ
              </Link>
            </div>
          </div>
        )}

        {tab === 'purchase-history' && (
          pos.length === 0 ? (
            <p className="text-[13px] text-text-secondary text-center py-12">No purchase orders yet.</p>
          ) : (
            <table className="w-full" style={{ minWidth: 560 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">PO Number</th>
                  <th className="data-th text-right">Total</th>
                  <th className="data-th text-left">Status</th>
                  <th className="data-th text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {pos.map(po => (
                  <tr key={po.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                    onClick={() => router.push(`/dashboard/supply/purchase-orders/${po.id}`)}>
                    <td className="data-td text-[13px] font-medium">{po.po_number ?? 'Draft'}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(po.total_amount)}</td>
                    <td className="data-td">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${poStatusColour[po.status] ?? ''}`}>
                        {po.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="data-td text-[12px] text-text-secondary">{po.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'rfq-history' && (
          rfqHistory.length === 0 ? (
            <p className="text-[13px] text-text-secondary text-center py-12">No RFQ history yet.</p>
          ) : (
            <table className="w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">RFQ</th>
                  <th className="data-th text-left">Title</th>
                  <th className="data-th text-left">Status</th>
                  <th className="data-th text-right">Response Total</th>
                </tr>
              </thead>
              <tbody>
                {rfqHistory.map(r => (
                  <tr key={r.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                    onClick={() => router.push(`/dashboard/supply/rfqs/${r.rfq_id}`)}>
                    <td className="data-td text-[13px] font-medium">{r.rfqs?.rfq_number ?? '—'}</td>
                    <td className="data-td text-[13px] text-text-secondary">{r.rfqs?.title ?? '—'}</td>
                    <td className="data-td">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-elevated text-text-secondary capitalize">
                        {r.status}
                      </span>
                    </td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(r.response_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}
