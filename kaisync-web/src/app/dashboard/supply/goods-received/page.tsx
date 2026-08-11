'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { GoodsReceivedNote, GrnStatus } from '@/types/commercial'

const STATUS_COLOURS: Record<GrnStatus, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  received: 'bg-success/10 text-success',
  partial: 'bg-amber-100 text-amber-700',
}

interface GrnRow {
  id: string
  grn_number: string | null
  status: GrnStatus
  received_date: string
  supplier?: { name: string } | null
  po?: { po_number: string | null } | null
}

export default function GoodsReceivedPage() {
  const router = useRouter()
  const [grns, setGrns] = useState<GrnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to a company'); setLoading(false); return }

    const { data, error: err } = await supabase
      .from('goods_received_notes')
      .select('*, supplier:contractors!goods_received_notes_supplier_id_fkey(name), po:purchase_orders!goods_received_notes_po_id_fkey(po_number)')
      .eq('company_id', member.companyId)
      .order('received_date', { ascending: false })

    if (err) { setError(err.message); setLoading(false); return }
    setGrns((data ?? []) as GrnRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Goods Received Notes</h1>
          <p className="text-[12px] text-text-secondary">{grns.length} GRN{grns.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => router.push('/dashboard/supply/goods-received/new')}
          className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
          <span className="material-icons text-[18px]">add</span>
          New GRN
        </button>
      </div>

      {error && <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      <div className="flex-1 overflow-auto px-4 pt-3">
        {loading ? (
          <p className="text-[13px] text-text-secondary py-8 text-center">Loading…</p>
        ) : grns.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">local_shipping</span>
            <p className="text-[13px] text-text-secondary mt-3">No goods received notes yet.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">GRN Number</th>
                <th className="data-th text-left">Supplier</th>
                <th className="data-th text-left">PO Ref</th>
                <th className="data-th text-left">Received Date</th>
                <th className="data-th text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {grns.map(g => (
                <tr key={g.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                  onClick={() => router.push(`/dashboard/supply/goods-received/${g.id}`)}>
                  <td className="data-td text-[13px] font-mono font-medium">{g.grn_number ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">{(g.supplier as { name: string } | null)?.name ?? '—'}</td>
                  <td className="data-td text-[13px] text-text-secondary">
                    {(g.po as { po_number: string | null } | null)?.po_number ?? '—'}
                  </td>
                  <td className="data-td text-[12px] text-text-secondary">{g.received_date}</td>
                  <td className="data-td">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOURS[g.status]}`}>
                      {g.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
