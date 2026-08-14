'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { getUnitLabel } from '@/lib/units'
import ServiceDeliveryToggle from '@/components/quotes/ServiceDeliveryToggle'
import VariantPickerModal from '@/components/quotes/VariantPickerModal'
import type { CatalogueItem } from '@/types/inventory'
import type { RequestLine, ServiceDelivery } from '@/types/quotes'

// ─── Types ─────────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  part: 'bg-blue-50 text-blue-600',
  service: 'bg-purple-50 text-purple-600',
  material: 'bg-green-50 text-green-600',
  labour: 'bg-amber-50 text-amber-600',
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  companyId: string
  lines: RequestLine[]
  onChange: (lines: RequestLine[]) => void
  onProcess: () => Promise<void>
  processing: boolean
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function RequestTab({ companyId, lines, onChange, onProcess, processing }: Props) {
  const supabase = createClient()

  // Search state
  const [query,       setQuery]       = useState('')
  const [results,     setResults]     = useState<CatalogueItem[]>([])
  const [showResults, setShowResults] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Variant picker
  const [variantBase, setVariantBase] = useState<CatalogueItem | null>(null)

  // Search catalogue
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(async () => {
      const { data } = await supabase
        .from('quote_catalogue_items')
        .select('*, condition:catalogue_conditions(id,name)')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .or(`name.ilike.%${query}%,sku.ilike.%${query}%,code.ilike.%${query}%`)
        .order('usage_count', { ascending: false })
        .limit(8)
      setResults((data ?? []) as CatalogueItem[])
      setShowResults(true)
    }, 250)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  function addFromCatalogue(item: CatalogueItem) {
    // If item has variants, open picker first
    if (item.variant_group_id) {
      setVariantBase(item)
      setShowResults(false)
      setQuery('')
      return
    }
    addLine(item)
  }

  function addLine(item: CatalogueItem) {
    const isService = item.item_type === 'service' || item.item_type === 'labour'
    const newLine: RequestLine = {
      tempId: crypto.randomUUID(),
      catalogue_item_id: item.id,
      variant_id: null,
      item_name: item.name,
      item_sku: item.sku ?? item.code ?? null,
      item_type: item.item_type as RequestLine['item_type'],
      qty: 1,
      unit_of_measure: item.unit_of_measure ?? item.unit ?? 'each',
      service_delivery: isService ? 'self' : null,
      notes: null,
      cost_price: item.cost_price ?? 0,
      unit_sell_price: item.sell_price ?? 0,
    }
    onChange([...lines, newLine])
    setQuery('')
    setResults([])
  }

  function addFreeText() {
    if (!query.trim()) return
    const newLine: RequestLine = {
      tempId: crypto.randomUUID(),
      catalogue_item_id: null,
      variant_id: null,
      item_name: query.trim(),
      item_sku: null,
      item_type: null,
      qty: 1,
      unit_of_measure: 'each',
      service_delivery: null,
      notes: null,
      cost_price: 0,
      unit_sell_price: 0,
    }
    onChange([...lines, newLine])
    setQuery('')
    setResults([])
  }

  function updateLine(tempId: string, patch: Partial<RequestLine>) {
    onChange(lines.map(l => l.tempId === tempId ? { ...l, ...patch } : l))
  }

  function removeLine(tempId: string) {
    onChange(lines.filter(l => l.tempId !== tempId))
  }

  function comingSoon() {
    alert('Coming soon — document upload and AI extraction in Phase 2.')
  }

  return (
    <div className="flex flex-col h-full">

      {/* Action bar */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={comingSoon}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
        >
          <span className="material-icons text-[15px]">upload_file</span>
          Upload PO / PDF
        </button>
        <button
          type="button"
          onClick={comingSoon}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
        >
          <span className="material-icons text-[15px]">image</span>
          Upload image
        </button>
        <span className="text-[11px] text-text-secondary ml-1 italic">AI extraction — Phase 2</span>
      </div>

      {/* Drop zone — only shown when no lines yet */}
      {lines.length === 0 && (
        <div className="border-2 border-dashed border-divider rounded-xl flex flex-col items-center justify-center py-10 mb-4 text-text-secondary">
          <span className="material-icons text-[36px] mb-2">description</span>
          <p className="text-[13px] font-medium">Drop a customer PO, image or PDF here</p>
          <p className="text-[12px] mt-1">Items will be extracted automatically (Phase 2)</p>
        </div>
      )}

      {/* Lines table */}
      {lines.length > 0 && (
        <div className="border border-divider rounded-xl overflow-hidden mb-4">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-divider bg-surface-elevated text-text-secondary text-left">
                <th className="px-3 py-2 w-8 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium w-20">Qty</th>
                <th className="px-3 py-2 font-medium w-16">Unit</th>
                <th className="px-3 py-2 font-medium w-20">Type</th>
                <th className="px-3 py-2 font-medium">Delivery</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={line.tempId} className="border-b border-divider last:border-0">
                  <td className="px-3 py-2 text-text-secondary text-center">{idx + 1}</td>
                  <td className="px-3 py-2 text-text-secondary font-mono">
                    {line.item_sku ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.item_name}
                      onChange={e => updateLine(line.tempId, { item_name: e.target.value })}
                      className="w-full h-7 rounded border border-transparent bg-transparent px-1 text-[12px] text-text-primary focus:border-divider focus:bg-surface focus:outline-none transition-colors"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0.001"
                      step="1"
                      value={line.qty}
                      onChange={e => updateLine(line.tempId, { qty: parseFloat(e.target.value) || 1 })}
                      className="w-full h-7 rounded border border-transparent bg-transparent px-1 text-[12px] text-text-primary focus:border-divider focus:bg-surface focus:outline-none text-right transition-colors"
                    />
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {getUnitLabel(line.unit_of_measure)}
                  </td>
                  <td className="px-3 py-2">
                    {line.item_type ? (
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', TYPE_COLOURS[line.item_type] ?? 'bg-gray-100 text-gray-600')}>
                        {line.item_type.charAt(0).toUpperCase() + line.item_type.slice(1)}
                      </span>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(line.item_type === 'service' || line.item_type === 'labour') && (
                      <ServiceDeliveryToggle
                        value={line.service_delivery ?? 'self'}
                        onChange={v => updateLine(line.tempId, { service_delivery: v as ServiceDelivery })}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(line.tempId)}
                      className="text-text-secondary hover:text-red-500 transition-colors"
                    >
                      <span className="material-icons text-[16px]">close</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Search / add line */}
      <div className="relative mb-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-icons text-[15px] text-text-secondary">search</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => query && setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              placeholder="Search part number, name, or SKU to add a line…"
              className="h-9 w-full rounded-lg border border-divider bg-surface pl-8 pr-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          {query.trim() && (
            <button
              type="button"
              onMouseDown={addFreeText}
              className="h-9 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors whitespace-nowrap"
            >
              Add as free-text
            </button>
          )}
        </div>

        {/* Search dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-divider rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
            {results.map(item => (
              <button
                key={item.id}
                type="button"
                onMouseDown={() => addFromCatalogue(item)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-surface-elevated text-left border-b border-divider last:border-0"
              >
                <div>
                  <span className="text-[13px] font-medium text-text-primary">{item.name}</span>
                  {item.sku && <span className="ml-2 text-[11px] text-text-secondary font-mono">{item.sku}</span>}
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {item.variant_group_id && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">variants</span>
                  )}
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', TYPE_COLOURS[item.item_type] ?? 'bg-gray-100 text-gray-600')}>
                    {item.item_type}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end mt-auto pt-2 border-t border-divider">
        <button
          type="button"
          onClick={() => void onProcess()}
          disabled={lines.length === 0 || processing}
          className="flex items-center gap-2 h-9 px-6 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {processing ? 'Processing…' : 'Process items'}
          {!processing && <span className="material-icons text-[16px]">arrow_forward</span>}
        </button>
      </div>

      {/* Variant picker modal */}
      {variantBase && (
        <VariantPickerModal
          baseItem={variantBase}
          companyId={companyId}
          onSelect={item => { addLine(item); setVariantBase(null) }}
          onClose={() => setVariantBase(null)}
        />
      )}
    </div>
  )
}
