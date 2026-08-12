'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import type { QuoteAssistSuggestion } from '@/types/commercial'

interface Props {
  quoteId: string
  companyId: string
  existingLineCount: number
  onAddLines: () => void
  onClose: () => void
}

const CONFIDENCE_COLORS = {
  high:   'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-500',
}

const ITEM_TYPE_COLORS: Record<string, string> = {
  material:   'bg-blue-100 text-blue-700',
  labour:     'bg-amber-100 text-amber-700',
  subcontract:'bg-purple-100 text-purple-700',
  equipment:  'bg-green-100 text-green-700',
  other:      'bg-gray-100 text-gray-500',
}

export function QuoteAssistPanel({ quoteId, companyId, existingLineCount, onAddLines, onClose }: Props) {
  const [description,    setDescription]    = useState('')
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [suggestions,    setSuggestions]    = useState<QuoteAssistSuggestion[]>([])
  const [checked,        setChecked]        = useState<boolean[]>([])
  const [addToCatalogue, setAddToCatalogue] = useState<boolean[]>([])
  const [adding,         setAdding]         = useState(false)

  async function generate() {
    if (!description.trim()) return
    setLoading(true)
    setError(null)
    setSuggestions([])
    try {
      const res  = await fetch('/api/ai/quote-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), company_id: companyId, quote_id: quoteId }),
      })
      const data = await res.json() as { suggestions?: QuoteAssistSuggestion[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Generation failed')
      const s = data.suggestions ?? []
      setSuggestions(s)
      setChecked(s.map(() => true))
      setAddToCatalogue(s.map(() => false))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  function toggleSuggestion(i: number) {
    setChecked(prev => { const n = [...prev]; n[i] = !n[i]; return n })
  }
  function toggleCatalogue(i: number) {
    setAddToCatalogue(prev => { const n = [...prev]; n[i] = !n[i]; return n })
  }

  const selected = suggestions.filter((_, i) => checked[i])

  async function handleAddLines() {
    if (selected.length === 0 || adding) return
    setAdding(true)
    const supabase = createClient()

    // 1. Insert quote lines
    const insertRows = selected.map((s, i) => ({
      company_id:        companyId,
      quote_id:          quoteId,
      sort_order:        existingLineCount + i,
      item_type:         s.item_type,
      catalogue_item_id: s.catalogue_item_id,
      description:       s.description,
      unit:              s.unit,
      quantity:          s.quantity,
      cost_price:        s.suggested_cost_price,
      markup_percent:    s.markup_percent,
      unit_sell_price:   s.suggested_sell_price,
      subtotal_cost:     s.suggested_cost_price * s.quantity,
      subtotal_sell:     s.suggested_sell_price * s.quantity,
      vat_rate:          0.15,
      vat_amount:        s.suggested_sell_price * s.quantity * 0.15,
      line_total:        s.suggested_sell_price * s.quantity * 1.15,
    }))
    await supabase.from('commercial_quote_lines').insert(insertRows)

    // 2. Increment usage count for catalogue matches
    const catalogueIds = selected.filter(s => s.catalogue_item_id).map(s => s.catalogue_item_id!)
    for (const itemId of catalogueIds) {
      await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<unknown>)(
        'increment_catalogue_usage', { p_item_id: itemId }
      )
    }

    // 3. Save new items to catalogue if checked
    const newItems = selected.filter((s, i) => {
      const origIdx = suggestions.indexOf(s)
      return !s.catalogue_item_id && addToCatalogue[origIdx] && checked[i]
    })
    if (newItems.length > 0) {
      await supabase.from('quote_catalogue_items').insert(
        newItems.map(s => ({
          company_id:    companyId,
          name:          s.description,
          unit:          s.unit,
          item_type:     s.item_type,
          cost_price:    s.suggested_cost_price,
          sell_price:    s.suggested_sell_price,
          markup_percent: s.markup_percent,
          ai_suggested:  true,
          usage_count:   1,
          last_used_at:  new Date().toISOString(),
        }))
      )
    }

    setAdding(false)
    onAddLines()
  }

  const newCatalogueItems = selected.filter((s, i) => !s.catalogue_item_id && addToCatalogue[suggestions.indexOf(s)] && checked[i])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end sm:justify-center bg-black/50">
      <div className="bg-surface rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">✨</span>
            <h2 className="text-[16px] font-semibold text-text-primary">AI Quote Assistant</h2>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Description input */}
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-text-secondary">Describe the work</label>
            <textarea
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={`Describe the work, e.g: Install 20sqm bathroom tiles,\nplumbing for 1 toilet + basin + shower, tiling grout and waterproofing...`}
              className="form-input resize-none text-[13px]"
            />
            <button
              onClick={generate}
              disabled={loading || !description.trim()}
              className="self-start btn-primary h-9 px-4 text-[13px] disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <><span className="material-icons text-[16px] animate-spin">progress_activity</span>Thinking…</>
              ) : 'Generate Quote Lines →'}
            </button>
          </div>

          {error && <p className="text-[13px] text-error">{error}</p>}

          {/* Results */}
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-text-secondary">
                  {suggestions.length} suggestions · {selected.length} selected
                </p>
                <button onClick={() => setChecked(suggestions.map(() => true))} className="text-[12px] text-primary hover:underline">Select all</button>
              </div>

              {suggestions.map((s, i) => (
                <div key={i} className={`border border-divider rounded-lg p-3 transition-opacity ${!checked[i] ? 'opacity-40' : ''}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={checked[i]} onChange={() => toggleSuggestion(i)} className="mt-1 rounded" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Catalogue/new badge */}
                        {s.catalogue_item_id ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                            From catalogue
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                            New item
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ITEM_TYPE_COLORS[s.item_type] ?? ''}`}>
                          {s.item_type}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CONFIDENCE_COLORS[s.confidence]}`}>
                          {s.confidence}
                        </span>
                      </div>
                      <p className="text-[13px] font-medium text-text-primary mt-1">{s.description}</p>
                      <p className="text-[11px] text-text-secondary mt-0.5">{s.reasoning}</p>
                      {s.catalogue_match_name && s.catalogue_match_name !== s.description && (
                        <p className="text-[11px] text-text-disabled mt-0.5">Catalogue: {s.catalogue_match_name}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-semibold text-text-primary">{fmtMoney(s.suggested_sell_price)}/{s.unit}</p>
                      <p className="text-[11px] text-text-secondary">×{s.quantity} = {fmtMoney(s.suggested_sell_price * s.quantity)}</p>
                      <p className="text-[11px] text-text-disabled">{s.markup_percent}% mkp</p>
                    </div>
                  </div>

                  {/* Add to catalogue checkbox for new items */}
                  {!s.catalogue_item_id && checked[i] && (
                    <label className="flex items-center gap-2 mt-2 ml-7 text-[11px] text-text-secondary cursor-pointer">
                      <input type="checkbox" checked={addToCatalogue[i]} onChange={() => toggleCatalogue(i)} className="rounded" />
                      Add to catalogue
                    </label>
                  )}
                </div>
              ))}

              {/* New catalogue items summary */}
              {newCatalogueItems.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-[12px] font-medium text-blue-800 dark:text-blue-300 mb-1">
                    Will be saved to catalogue:
                  </p>
                  {newCatalogueItems.map((s, i) => (
                    <p key={i} className="text-[12px] text-blue-700 dark:text-blue-400">
                      • {s.description} at {fmtMoney(s.suggested_sell_price)}/{s.unit}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {suggestions.length > 0 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-divider shrink-0">
            <button onClick={() => { setSuggestions([]); setChecked([]); setAddToCatalogue([]) }} className="text-[13px] text-text-secondary hover:text-text-primary">
              Clear
            </button>
            <button
              onClick={handleAddLines}
              disabled={selected.length === 0 || adding}
              className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
            >
              {adding ? 'Adding…' : `Add ${selected.length} line${selected.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
