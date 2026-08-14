'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { QuoteLine } from '@/types/quotes'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function calcMarkup(cost: number, sell: number) {
  return cost > 0 ? ((sell - cost) / cost) * 100 : 0
}
function calcSell(cost: number, markup: number) {
  return cost * (1 + markup / 100)
}
function fmtR(n: number) {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  quoteId: string
  companyId: string
  onAllPriced: (allPriced: boolean) => void
}

// ─── Row state ─────────────────────────────────────────────────────────────────

interface PricingRow extends QuoteLine {
  costStr:   string
  sellStr:   string
  markupStr: string
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function PricingTab({ quoteId, companyId, onAllPriced }: Props) {
  const supabase = createClient()
  const [rows, setRows]           = useState<PricingRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [defaultMargin, setDefaultMargin] = useState('15')
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const VAT_RATE = 0.15

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('commercial_quote_lines')
      .select('*')
      .eq('quote_id', quoteId)
      .eq('company_id', companyId)
      .eq('is_excluded', false)
      .order('sort_order')
    const loaded = (data ?? []) as QuoteLine[]
    const priced = loaded.map(l => ({
      ...l,
      costStr:   String(l.cost_price ?? 0),
      sellStr:   String(l.unit_sell_price ?? 0),
      markupStr: l.markup_percent != null
        ? String(l.markup_percent)
        : String(calcMarkup(l.cost_price ?? 0, l.unit_sell_price ?? 0).toFixed(2)),
    }))
    setRows(priced)
    setLoading(false)
    onAllPriced(priced.every(r => (r.unit_sell_price ?? 0) > 0))
  }, [quoteId, companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  // ── Debounced DB save ──
  function scheduleSave(rowId: string, patch: Partial<QuoteLine>) {
    if (saveTimers.current[rowId]) clearTimeout(saveTimers.current[rowId])
    saveTimers.current[rowId] = setTimeout(async () => {
      await supabase.from('commercial_quote_lines')
        .update(patch)
        .eq('id', rowId)
        .eq('company_id', companyId)
    }, 800)
  }

  // ── Row update handlers ──
  function patchRow(id: string, patch: Partial<PricingRow>) {
    setRows(prev => {
      const next = prev.map(r => r.id !== id ? r : { ...r, ...patch })
      onAllPriced(next.every(r => (parseFloat(r.sellStr) || 0) > 0))
      return next
    })
  }

  function onCostChange(row: PricingRow, val: string) {
    const cost  = parseFloat(val) || 0
    const mkup  = parseFloat(row.markupStr) || 0
    const sell  = calcSell(cost, mkup)
    const sellStr = sell.toFixed(2)
    patchRow(row.id, { costStr: val, sellStr })
    const qty = row.quantity ?? 1
    scheduleSave(row.id, {
      cost_price: cost,
      unit_sell_price: sell,
      subtotal_cost: cost * qty,
      subtotal_sell: sell * qty,
      vat_amount: sell * qty * VAT_RATE,
      line_total: sell * qty * (1 + VAT_RATE),
    })
  }

  function onSellChange(row: PricingRow, val: string) {
    const cost = parseFloat(row.costStr) || 0
    const sell = parseFloat(val) || 0
    const mkup = calcMarkup(cost, sell)
    patchRow(row.id, { sellStr: val, markupStr: mkup.toFixed(2) })
    const qty = row.quantity ?? 1
    scheduleSave(row.id, {
      unit_sell_price: sell,
      markup_percent: mkup,
      subtotal_sell: sell * qty,
      vat_amount: sell * qty * VAT_RATE,
      line_total: sell * qty * (1 + VAT_RATE),
    })
  }

  function onMarkupChange(row: PricingRow, val: string) {
    const cost = parseFloat(row.costStr) || 0
    const mkup = parseFloat(val) || 0
    const sell = calcSell(cost, mkup)
    patchRow(row.id, { markupStr: val, sellStr: sell.toFixed(2) })
    const qty = row.quantity ?? 1
    scheduleSave(row.id, {
      unit_sell_price: sell,
      markup_percent: mkup,
      subtotal_sell: sell * qty,
      vat_amount: sell * qty * VAT_RATE,
      line_total: sell * qty * (1 + VAT_RATE),
    })
  }

  function applyDefaultMargin() {
    const mkup = parseFloat(defaultMargin) || 0
    setRows(prev => prev.map(r => {
      if ((parseFloat(r.sellStr) || 0) > 0) return r // skip already-priced
      const cost = parseFloat(r.costStr) || 0
      const sell = calcSell(cost, mkup)
      const qty  = r.quantity ?? 1
      scheduleSave(r.id, {
        unit_sell_price: sell,
        markup_percent: mkup,
        subtotal_sell: sell * qty,
        vat_amount: sell * qty * VAT_RATE,
        line_total: sell * qty * (1 + VAT_RATE),
      })
      return { ...r, sellStr: sell.toFixed(2), markupStr: String(mkup) }
    }))
  }

  // ── Totals ──
  const totals = rows.reduce((acc, r) => {
    const cost = (parseFloat(r.costStr) || 0) * (r.quantity ?? 1)
    const sell = (parseFloat(r.sellStr) || 0) * (r.quantity ?? 1)
    acc.cost += cost
    acc.sell += sell
    return acc
  }, { cost: 0, sell: 0 })
  const vat          = totals.sell * VAT_RATE
  const total        = totals.sell + vat
  const grossProfit  = totals.sell - totals.cost
  const avgMargin    = totals.sell > 0 ? (grossProfit / totals.sell) * 100 : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-text-secondary text-[13px]">
        <span className="material-icons animate-spin text-primary">refresh</span>
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Default margin bar */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-[12px] text-text-secondary font-medium whitespace-nowrap">Default margin:</label>
        <div className="relative w-24">
          <input
            type="number" min="0" max="999" step="0.1"
            value={defaultMargin}
            onChange={e => setDefaultMargin(e.target.value)}
            className="h-8 w-full rounded-md border border-divider bg-surface px-3 pr-7 text-[12px] text-text-primary focus:outline-none focus:border-primary"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-secondary">%</span>
        </div>
        <button
          type="button"
          onClick={applyDefaultMargin}
          className="h-8 px-3 rounded-md border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors whitespace-nowrap"
        >
          Apply to all unfilled
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border border-divider rounded-xl">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-divider bg-surface-elevated text-text-secondary text-left">
              <th className="px-3 py-2 font-medium w-8">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium w-24">Source</th>
              <th className="px-3 py-2 font-medium text-right w-28">Cost (R)</th>
              <th className="px-3 py-2 font-medium text-right w-28">Sell (R)</th>
              <th className="px-3 py-2 font-medium text-right w-24">Margin %</th>
              <th className="px-3 py-2 font-medium text-right w-14">Qty</th>
              <th className="px-3 py-2 font-medium text-right w-28">Line total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const sell   = parseFloat(row.sellStr) || 0
              const cost   = parseFloat(row.costStr) || 0
              const margin = sell > 0 ? ((sell - cost) / sell) * 100 : 0
              const total  = sell * (row.quantity ?? 1)

              return (
                <tr key={row.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                  <td className="px-3 py-2 text-text-secondary text-center">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium text-text-primary">{row.description}</td>
                  <td className="px-3 py-2 text-text-secondary capitalize">{row.source_type ?? '—'}</td>

                  {/* Cost */}
                  <td className="px-3 py-1">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary text-[11px]">R</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={row.costStr}
                        onChange={e => onCostChange(row, e.target.value)}
                        className="h-7 w-full rounded border border-divider bg-surface pl-5 pr-2 text-[12px] text-text-primary focus:outline-none focus:border-primary text-right"
                      />
                    </div>
                  </td>

                  {/* Sell */}
                  <td className="px-3 py-1">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary text-[11px]">R</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={row.sellStr}
                        onChange={e => onSellChange(row, e.target.value)}
                        className={cn(
                          'h-7 w-full rounded border bg-surface pl-5 pr-2 text-[12px] text-text-primary focus:outline-none focus:border-primary text-right',
                          sell <= 0 ? 'border-red-300' : 'border-divider',
                        )}
                      />
                    </div>
                  </td>

                  {/* Margin */}
                  <td className="px-3 py-1">
                    <div className="relative">
                      <input
                        type="number" min="-999" step="0.1"
                        value={row.markupStr}
                        onChange={e => onMarkupChange(row, e.target.value)}
                        className={cn(
                          'h-7 w-full rounded border bg-surface pl-2 pr-5 text-[12px] text-text-primary focus:outline-none focus:border-primary text-right',
                          margin < 0 ? 'border-red-300 bg-red-50' :
                          margin < 5 ? 'border-amber-300 bg-amber-50' :
                          'border-divider',
                        )}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary text-[10px]">%</span>
                    </div>
                  </td>

                  <td className="px-3 py-2 text-right text-text-secondary">{row.quantity}</td>
                  <td className="px-3 py-2 text-right font-medium text-text-primary">{fmtR(total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky footer totals */}
      <div className="mt-3 border-t border-divider pt-3 grid grid-cols-5 gap-4 text-[12px]">
        <div>
          <p className="text-text-secondary mb-0.5">Total cost</p>
          <p className="font-semibold text-text-primary">{fmtR(totals.cost)}</p>
        </div>
        <div>
          <p className="text-text-secondary mb-0.5">Subtotal (excl. VAT)</p>
          <p className="font-semibold text-text-primary">{fmtR(totals.sell)}</p>
        </div>
        <div>
          <p className="text-text-secondary mb-0.5">VAT (15%)</p>
          <p className="font-semibold text-text-primary">{fmtR(vat)}</p>
        </div>
        <div>
          <p className="text-text-secondary mb-0.5">Total (incl. VAT)</p>
          <p className="font-semibold text-[14px] text-text-primary">{fmtR(total)}</p>
        </div>
        <div>
          <p className="text-text-secondary mb-0.5">Gross profit</p>
          <p className={cn('font-semibold', grossProfit >= 0 ? 'text-green-600' : 'text-red-500')}>{fmtR(grossProfit)}</p>
          <p className="text-[10px] text-text-secondary">Avg margin: {avgMargin.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  )
}
