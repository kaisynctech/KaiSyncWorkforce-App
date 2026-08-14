'use client'

import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { RFQ_STATUS_CONFIG } from '@/lib/rfq'
import type { RfqComparisonRow, QuoteSourcingSummaryRow } from '@/types/quotes'

interface Props {
  isOpen: boolean
  onClose: () => void
  item: QuoteSourcingSummaryRow | null
  rows: RfqComparisonRow[]
  quoteId: string
  companyId: string
  onConfirmed: () => void   // refresh sourcing summary
}

export default function RfqComparisonPanel({ isOpen, onClose, item, rows, quoteId, companyId, onConfirmed }: Props) {
  const supabase = createClient()

  function fmtR(n: number | null | undefined) {
    if (n == null) return '—'
    return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  async function selectRfqLine(row: RfqComparisonRow) {
    if (!item) return
    try {
      // 1. Clear is_selected on all rfq_lines for this item in this quote
      const { data: allRfqs } = await supabase
        .from('quote_rfqs')
        .select('id')
        .eq('quote_id', quoteId)
        .eq('company_id', companyId)
      const rfqIds = (allRfqs ?? []).map((r: { id: string }) => r.id)
      if (rfqIds.length) {
        await supabase
          .from('quote_rfq_lines')
          .update({ is_selected: false })
          .in('rfq_id', rfqIds)
          .eq('catalogue_item_id', item.catalogue_item_id)
      }

      // 2. Set the winner
      await supabase
        .from('quote_rfq_lines')
        .update({ is_selected: true })
        .eq('id', row.rfq_line_id)

      // 3. Update the commercial_quote_line
      await supabase
        .from('commercial_quote_lines')
        .update({
          source_type:  'rfq',
          rfq_line_id:  row.rfq_line_id,
          cost_price:   row.supplier_price ?? 0,
        })
        .eq('id', item.line_id)
        .eq('company_id', companyId)

      onConfirmed()
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to select source')
    }
  }

  async function useStock() {
    if (!item) return
    try {
      await supabase
        .from('commercial_quote_lines')
        .update({ source_type: 'inventory', rfq_line_id: null })
        .eq('id', item.line_id)
        .eq('company_id', companyId)

      onConfirmed()
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to confirm stock source')
    }
  }

  const respondedRows = rows.filter(r => r.supplier_price !== null)

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40" onClick={onClose} />}

      <div className={cn(
        'fixed top-0 right-0 h-full w-[440px] bg-background border-l border-divider z-50',
        'shadow-xl transition-transform duration-200 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">Select source</h2>
            {item && <p className="text-[12px] text-text-secondary mt-0.5">{item.item_name}</p>}
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Supplier quotes */}
          {respondedRows.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
                Available quotes ({respondedRows.length} received)
              </p>
              <div className="space-y-3">
                {respondedRows.map(row => {
                  const cfg = RFQ_STATUS_CONFIG[row.rfq_status as keyof typeof RFQ_STATUS_CONFIG] ?? RFQ_STATUS_CONFIG.responded
                  return (
                    <div key={row.rfq_line_id} className={cn(
                      'border rounded-xl p-4',
                      row.is_selected ? 'border-green-400 bg-green-50' : 'border-divider',
                    )}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="text-[13px] font-semibold text-text-primary">{row.supplier_name}</p>
                          <p className="text-[10px] text-text-secondary font-mono">{row.rfq_number}</p>
                        </div>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', cfg.colour, cfg.bgColour)}>
                          {cfg.label}
                        </span>
                      </div>

                      <div className="space-y-0.5 text-[12px] text-text-secondary mb-3">
                        <p className="text-[14px] font-semibold text-text-primary">{fmtR(row.supplier_price)} / unit</p>
                        {row.supplier_ref && <p>Ref: {row.supplier_ref}</p>}
                        {row.supplier_qty != null && <p>{row.supplier_qty} available</p>}
                        {row.lead_time_days != null && <p>Lead time: {row.lead_time_days} day{row.lead_time_days !== 1 ? 's' : ''}</p>}
                        {row.supplier_notes && <p className="italic">{row.supplier_notes}</p>}
                      </div>

                      <div className="flex items-center justify-end">
                        {row.is_selected ? (
                          <span className="flex items-center gap-1 text-[12px] text-green-600 font-medium">
                            <span className="material-icons text-[15px]">check_circle</span>
                            Selected
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void selectRfqLine(row)}
                            className="flex items-center gap-1 h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-medium hover:bg-primary/90 transition-colors"
                          >
                            Select this
                            <span className="material-icons text-[14px]">arrow_forward</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Use from stock */}
          {item && item.is_stockable && item.qty_in_stock > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
                Or use from your own inventory
              </p>
              <div className={cn(
                'border rounded-xl p-4',
                item.source_type === 'inventory' ? 'border-green-400 bg-green-50' : 'border-divider',
              )}>
                <p className="text-[13px] font-semibold text-text-primary mb-1">
                  {item.qty_in_stock} in stock
                </p>
                <div className="flex items-center justify-end">
                  {item.source_type === 'inventory' ? (
                    <span className="flex items-center gap-1 text-[12px] text-green-600 font-medium">
                      <span className="material-icons text-[15px]">check_circle</span>
                      Using stock
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void useStock()}
                      className="flex items-center gap-1 h-8 px-3 rounded-lg border border-primary text-primary text-[12px] font-medium hover:bg-primary/5 transition-colors"
                    >
                      Use stock
                      <span className="material-icons text-[14px]">arrow_forward</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {respondedRows.length === 0 && !(item?.is_stockable && item.qty_in_stock > 0) && (
            <div className="text-center py-10 text-text-secondary">
              <span className="material-icons text-[36px] mb-2 block">hourglass_empty</span>
              <p className="text-[13px]">No supplier responses yet.</p>
              <p className="text-[12px] mt-1">Log responses via the RFQ board below.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-divider shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-full rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
