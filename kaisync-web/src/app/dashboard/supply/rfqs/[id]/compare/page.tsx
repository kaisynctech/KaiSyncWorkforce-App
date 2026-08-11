'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import type { Rfq } from '@/types/commercial'

interface ComparisonLine {
  rfq_line_id: string
  sort_order: number
  description: string
  unit: string
  quantity: number
  responses: {
    recipient_id: string
    supplier_id: string
    supplier_name: string
    unit_price: number
    line_total: number
    lead_time_days: number
    responded: boolean
  }[]
}

interface ComparisonRecipient {
  recipient_id: string
  supplier_id: string
  supplier_name: string
  status: string
  response_total: number
  delivery_days: number | null
  is_selected: boolean
}

interface Comparison {
  rfq_id: string
  lines: ComparisonLine[]
  recipients: ComparisonRecipient[]
}

export default function RfqComparePage() {
  const { id: rfqId } = useParams<{ id: string }>()
  const router = useRouter()
  const [rfq, setRfq] = useState<Rfq | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ComparisonRecipient | null>(null)
  const [selecting, setSelecting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const { data: rfqData } = await supabase.from('rfqs').select('*').eq('id', rfqId).maybeSingle()
    setRfq(rfqData as Rfq | null)

    const { data: cmpData, error: cmpErr } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: Comparison | null; error: { message: string } | null }>)
      ('get_rfq_comparison', { p_rfq_id: rfqId })

    if (cmpErr) { setError(cmpErr.message); setLoading(false); return }
    setComparison(cmpData)
    setLoading(false)
  }, [rfqId])

  useEffect(() => { void load() }, [load])

  async function selectSupplier(rec: ComparisonRecipient) {
    setSelecting(true)
    const supabase = createClient()
    // Clear all selected
    await supabase.from('rfq_recipients').update({ is_selected: false }).eq('rfq_id', rfqId)
    // Mark this one
    await supabase.from('rfq_recipients').update({ is_selected: true, status: 'selected' }).eq('id', rec.recipient_id)
    setConfirming(null)
    setSelecting(false)
    // Navigate to new PO pre-filled
    router.push(`/dashboard/supply/purchase-orders/new?rfq_id=${rfqId}&recipient_id=${rec.recipient_id}`)
  }

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  if (error) return <p className="p-6 text-[13px] text-error">{error}</p>
  if (!comparison || !rfq) return <p className="p-6 text-[13px] text-text-secondary">No comparison data.</p>

  const recipients = comparison.recipients ?? []
  const lines = comparison.lines ?? []

  const respondedCount = recipients.filter(r => r.status === 'responded' || r.status === 'selected').length
  const totalCount = recipients.length

  // Per-line minimum unit_price for highlighting
  function minPriceForLine(line: ComparisonLine): number {
    const prices = (line.responses ?? []).filter(r => r.responded && r.unit_price > 0).map(r => r.unit_price)
    return prices.length > 0 ? Math.min(...prices) : -1
  }

  // Per-recipient total sum
  const recipientTotals = new Map<string, number>()
  for (const rec of recipients) {
    recipientTotals.set(rec.recipient_id, rec.response_total)
  }
  const minTotal = Math.min(...Array.from(recipientTotals.values()).filter(v => v > 0))

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.push(`/dashboard/supply/rfqs/${rfqId}`)} className="text-text-secondary hover:text-text-primary">
          <span className="material-icons text-[20px]">arrow_back</span>
        </button>
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary">Supplier Comparison — {rfq.rfq_number ?? rfq.title}</h1>
          <p className="text-[12px] text-text-secondary">{respondedCount} of {totalCount} suppliers responded</p>
        </div>
      </div>

      {respondedCount < totalCount && (
        <div className="mx-4 mt-3 p-2 rounded bg-amber-50 text-amber-700 text-[12px] border border-amber-200">
          <span className="material-icons text-[14px] align-middle mr-1">info</span>
          {totalCount - respondedCount} supplier{totalCount - respondedCount !== 1 ? 's have' : ' has'} not responded yet. You can still compare what's been received.
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {recipients.length === 0 ? (
          <p className="text-[13px] text-text-secondary text-center py-12">No supplier responses to compare yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: `${260 + recipients.length * 180}px` }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left w-60">Item</th>
                  <th className="data-th text-center w-16">Unit</th>
                  <th className="data-th text-right w-16">Qty</th>
                  {recipients.map(r => (
                    <th key={r.recipient_id} className="data-th text-right" style={{ minWidth: 160 }}>
                      <div className="font-semibold text-text-primary">{r.supplier_name}</div>
                      <div className="text-[10px] text-text-secondary font-normal capitalize">{r.status}</div>
                      {r.delivery_days != null && (
                        <div className="text-[10px] text-text-secondary font-normal">{r.delivery_days}d lead</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const minPrice = minPriceForLine(line)
                  return (
                    <tr key={line.rfq_line_id} className="border-b border-divider">
                      <td className="data-td text-[13px]">{line.description}</td>
                      <td className="data-td text-[12px] text-text-secondary text-center">{line.unit}</td>
                      <td className="data-td text-[13px] text-right">{line.quantity}</td>
                      {recipients.map(rec => {
                        const resp = (line.responses ?? []).find(r => r.recipient_id === rec.recipient_id)
                        const isLowest = resp && resp.unit_price > 0 && resp.unit_price === minPrice
                        return (
                          <td key={rec.recipient_id} className={`data-td text-[13px] text-right ${isLowest ? 'bg-success/5 font-semibold text-success' : ''}`}>
                            {resp?.responded ? (
                              <>
                                {fmtMoney(resp.unit_price)}
                                <span className="block text-[11px] text-text-secondary font-normal">{fmtMoney(resp.line_total)} total</span>
                              </>
                            ) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              {/* Totals footer */}
              <tfoot>
                <tr className="border-t-2 border-divider bg-surface-elevated font-semibold">
                  <td className="data-td text-[13px]" colSpan={3}>Total (incl. VAT)</td>
                  {recipients.map(rec => {
                    const isLowest = rec.response_total > 0 && rec.response_total === minTotal
                    return (
                      <td key={rec.recipient_id} className={`data-td text-[13px] text-right ${isLowest ? 'text-success' : ''}`}>
                        {rec.response_total > 0 ? fmtMoney(rec.response_total) : '—'}
                      </td>
                    )
                  })}
                </tr>
                {/* Select supplier row */}
                <tr className="border-t border-divider">
                  <td className="data-td" colSpan={3} />
                  {recipients.map(rec => (
                    <td key={rec.recipient_id} className="data-td text-right">
                      <button
                        onClick={() => setConfirming(rec)}
                        disabled={rec.response_total === 0}
                        className={`btn-primary h-8 px-3 text-[12px] disabled:opacity-40 ${rec.is_selected ? 'opacity-70' : ''}`}>
                        {rec.is_selected ? '✓ Selected' : 'Select Supplier'}
                      </button>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-xl shadow-2xl w-80 p-5 space-y-4">
            <h3 className="text-[15px] font-semibold text-text-primary">Create Purchase Order?</h3>
            <p className="text-[13px] text-text-secondary">
              Create a Purchase Order from <strong>{confirming.supplier_name}</strong>?
              This will pre-fill the PO with their quoted prices.
            </p>
            <div className="text-[13px] font-semibold">Total: {fmtMoney(confirming.response_total)}</div>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(null)} className="btn-secondary flex-1 h-9 text-[13px]">Cancel</button>
              <button onClick={() => selectSupplier(confirming)} disabled={selecting} className="btn-primary flex-1 h-9 text-[13px] disabled:opacity-50">
                {selecting ? 'Creating…' : 'Create PO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
