'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import RfqBoard from '@/components/quotes/RfqBoard'
import RfqSidePanel from '@/components/quotes/RfqSidePanel'
import RfqComparisonPanel from '@/components/quotes/RfqComparisonPanel'
import type { QuoteRfq, QuoteSourcingSummaryRow, RfqComparisonRow } from '@/types/quotes'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  part: 'bg-blue-50 text-blue-600',
  service: 'bg-purple-50 text-purple-600',
  material: 'bg-green-50 text-green-600',
  labour: 'bg-amber-50 text-amber-600',
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  quoteId: string
  quoteNumber: string
  companyId: string
  employeeId: string
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function StockSourcingTab({ quoteId, quoteNumber, companyId, employeeId }: Props) {
  const supabase = createClient()

  const [summary, setSummary]   = useState<QuoteSourcingSummaryRow[]>([])
  const [rfqs, setRfqs]         = useState<QuoteRfq[]>([])
  const [loading, setLoading]   = useState(true)

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // RFQ panel state
  const [rfqPanelOpen, setRfqPanelOpen] = useState(false)
  const [activeRfq,    setActiveRfq]    = useState<QuoteRfq | null>(null)
  const [preloadItems, setPreloadItems] = useState<QuoteSourcingSummaryRow[]>([])

  // Comparison panel state
  const [cmpPanelOpen,  setCmpPanelOpen]  = useState(false)
  const [cmpItem,       setCmpItem]       = useState<QuoteSourcingSummaryRow | null>(null)
  const [cmpRows,       setCmpRows]       = useState<RfqComparisonRow[]>([])

  // Load all data
  const load = useCallback(async () => {
    const [sumRes, rfqRes] = await Promise.all([
      supabase.rpc('get_quote_sourcing_summary', {
        p_company_id: companyId,
        p_quote_id:   quoteId,
      }),
      supabase
        .from('quote_rfqs')
        .select(`
          *,
          supplier:contractors(id, name),
          lines:quote_rfq_lines(*)
        `)
        .eq('quote_id', quoteId)
        .eq('company_id', companyId)
        .order('created_at'),
    ])

    const rawRfqs = (rfqRes.data ?? []) as (QuoteRfq & { supplier: { name: string } | null })[]
    setRfqs(rawRfqs.map(r => ({ ...r, supplier_name: r.supplier?.name ?? undefined })))
    setSummary((sumRes.data ?? []) as QuoteSourcingSummaryRow[])
    setLoading(false)
  }, [companyId, quoteId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  // Open RFQ panel (create new)
  function openNewRfq(items?: QuoteSourcingSummaryRow[]) {
    setActiveRfq(null)
    setPreloadItems(items ?? [])
    setRfqPanelOpen(true)
  }

  // Open RFQ panel (existing)
  function openExistingRfq(rfq: QuoteRfq) {
    setActiveRfq(rfq)
    setPreloadItems([])
    setRfqPanelOpen(true)
  }

  // Open comparison panel
  async function openComparison(item: QuoteSourcingSummaryRow) {
    const { data } = await supabase.rpc('get_rfq_comparison', {
      p_company_id:        companyId,
      p_quote_id:          quoteId,
      p_catalogue_item_id: item.catalogue_item_id,
    })
    setCmpItem(item)
    setCmpRows((data ?? []) as RfqComparisonRow[])
    setCmpPanelOpen(true)
  }

  // Confirm stock source directly
  async function confirmStock(item: QuoteSourcingSummaryRow) {
    await supabase
      .from('commercial_quote_lines')
      .update({ source_type: 'inventory', rfq_line_id: null })
      .eq('id', item.line_id)
      .eq('company_id', companyId)
    void load()
  }

  // Confirm catalogue / self-delivery source
  async function confirmCatalogue(item: QuoteSourcingSummaryRow) {
    await supabase
      .from('commercial_quote_lines')
      .update({ source_type: 'catalogue', rfq_line_id: null })
      .eq('id', item.line_id)
      .eq('company_id', companyId)
    void load()
  }

  // Toggle select
  function toggleSelect(lineId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-text-secondary text-[13px]">
        <span className="material-icons animate-spin text-primary">refresh</span>
        Loading…
      </div>
    )
  }

  const selectedItems = summary.filter(r => selected.has(r.line_id))

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ── Multi-select action bar ── */}
      {selected.size >= 2 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30">
          <span className="text-[13px] font-medium text-primary">{selected.size} items selected</span>
          <button
            type="button"
            onClick={() => { openNewRfq(selectedItems); setSelected(new Set()) }}
            className="h-8 px-4 rounded-lg bg-primary text-white text-[12px] font-medium hover:bg-primary/90 transition-colors"
          >
            Create RFQ for these items
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[12px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Items & Status table (~55% height) ── */}
      <div className="flex-[55] min-h-0 border border-divider rounded-xl overflow-hidden">
        {summary.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-10 text-text-secondary">
            <span className="material-icons text-[36px] mb-2">list_alt</span>
            <p className="text-[13px] font-medium">No lines yet</p>
            <p className="text-[12px] mt-1">Process items in Tab 1 first</p>
          </div>
        ) : (
          <div className="overflow-x-auto h-full overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-divider bg-surface-elevated text-text-secondary text-left">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 font-medium w-8">#</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium w-14">Type</th>
                  <th className="px-3 py-2 font-medium text-right w-14">Qty</th>
                  <th className="px-3 py-2 font-medium w-32">Stock status</th>
                  <th className="px-3 py-2 font-medium w-36">Sourcing</th>
                  <th className="px-3 py-2 font-medium w-36">Action</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, idx) => {
                  const isSelected = selected.has(row.line_id)
                  const needsOutsource = (row.qty_in_stock === 0 || row.service_delivery === 'outsourced') && !row.is_confirmed
                  const canUseStock   = row.qty_in_stock >= row.qty_requested && !row.is_confirmed
                  const canSelectSrc  = row.rfq_responded_count > 0
                  const selfService   = row.service_delivery === 'self' && (row.item_type === 'service' || row.item_type === 'labour')

                  // Stock status
                  let stockStatus: React.ReactNode
                  if (selfService) {
                    stockStatus = <span className="text-blue-600">We provide</span>
                  } else if (row.service_delivery === 'outsourced') {
                    stockStatus = <span className="text-text-secondary">Outsource</span>
                  } else if (!row.is_stockable) {
                    stockStatus = <span className="text-text-secondary">—</span>
                  } else if (row.qty_in_stock >= row.qty_requested) {
                    stockStatus = <span className="text-green-600">In stock ({row.qty_in_stock})</span>
                  } else if (row.qty_in_stock > 0) {
                    stockStatus = <span className="text-amber-600">Partial ({row.qty_in_stock})</span>
                  } else {
                    stockStatus = <span className="text-red-500">Not in stock</span>
                  }

                  // Sourcing status
                  let sourcingStatus: React.ReactNode
                  if (row.is_confirmed) {
                    sourcingStatus = (
                      <span className="flex items-center gap-1 text-green-600">
                        <span className="material-icons text-[14px]">check_circle</span>
                        Confirmed ({row.source_type})
                      </span>
                    )
                  } else if (row.rfq_count === 0) {
                    sourcingStatus = <span className="text-text-secondary">—</span>
                  } else if (row.rfq_responded_count === row.rfq_count) {
                    sourcingStatus = <span className="text-amber-600">{row.rfq_count} quotes — select one</span>
                  } else {
                    sourcingStatus = <span className="text-text-secondary">Waiting ({row.rfq_responded_count}/{row.rfq_count})</span>
                  }

                  return (
                    <tr key={row.line_id} className={cn(
                      'border-b border-divider last:border-0 group',
                      isSelected && 'bg-primary/5',
                    )}>
                      {/* Checkbox */}
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(row.line_id)}
                          className="accent-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 text-text-secondary text-center">{idx + 1}</td>
                      <td className="px-3 py-2 text-text-secondary font-mono">{row.item_sku ?? '—'}</td>
                      <td className="px-3 py-2 text-text-primary font-medium">{row.item_name}</td>
                      <td className="px-3 py-2">
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', TYPE_COLOURS[row.item_type] ?? 'bg-gray-100 text-gray-600')}>
                          {row.item_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-text-secondary">{row.qty_requested}</td>
                      <td className="px-3 py-2">{stockStatus}</td>
                      <td className="px-3 py-2">{sourcingStatus}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {/* Self-service: confirm catalogue */}
                          {selfService && !row.is_confirmed && (
                            <button
                              type="button"
                              onClick={() => void confirmCatalogue(row)}
                              className="h-7 px-2.5 rounded-md bg-blue-50 text-blue-600 text-[11px] font-medium hover:bg-blue-100 transition-colors"
                            >
                              Confirm
                            </button>
                          )}
                          {/* Select source from RFQ responses */}
                          {canSelectSrc && (
                            <button
                              type="button"
                              onClick={() => void openComparison(row)}
                              className="h-7 px-2.5 rounded-md bg-green-50 text-green-600 text-[11px] font-medium hover:bg-green-100 transition-colors"
                            >
                              Select source
                            </button>
                          )}
                          {/* Use stock */}
                          {canUseStock && !selfService && (
                            <button
                              type="button"
                              onClick={() => void confirmStock(row)}
                              className="h-7 px-2.5 rounded-md bg-blue-50 text-blue-600 text-[11px] font-medium hover:bg-blue-100 transition-colors"
                            >
                              Use stock
                            </button>
                          )}
                          {/* Outsource */}
                          {needsOutsource && !selfService && !canUseStock && !canSelectSrc && (
                            <button
                              type="button"
                              onClick={() => openNewRfq([row])}
                              className="h-7 px-2.5 rounded-md bg-amber-50 text-amber-600 text-[11px] font-medium hover:bg-amber-100 transition-colors"
                            >
                              Outsource
                            </button>
                          )}
                          {/* Change source */}
                          {row.is_confirmed && (
                            <button
                              type="button"
                              onClick={() => void openComparison(row)}
                              className="h-7 px-2.5 rounded-md border border-divider text-text-secondary text-[11px] hover:bg-surface-elevated transition-colors"
                            >
                              Change
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── RFQ Board (~45% height) ── */}
      <div className="flex-[45] min-h-0 overflow-y-auto">
        <RfqBoard
          rfqs={rfqs}
          onOpenRfq={openExistingRfq}
          onNewRfq={() => openNewRfq()}
        />
      </div>

      {/* ── Panels ── */}
      <RfqSidePanel
        isOpen={rfqPanelOpen}
        onClose={() => setRfqPanelOpen(false)}
        rfq={activeRfq}
        preloadedItems={preloadItems}
        quoteId={quoteId}
        companyId={companyId}
        employeeId={employeeId}
        quoteNumber={quoteNumber}
        rfqCount={rfqs.length}
        onSaved={() => void load()}
      />

      <RfqComparisonPanel
        isOpen={cmpPanelOpen}
        onClose={() => setCmpPanelOpen(false)}
        item={cmpItem}
        rows={cmpRows}
        quoteId={quoteId}
        companyId={companyId}
        onConfirmed={() => void load()}
      />
    </div>
  )
}
