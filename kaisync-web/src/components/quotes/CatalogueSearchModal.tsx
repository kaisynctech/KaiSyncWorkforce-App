'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CatalogueSearchResult {
  id: string
  variant_id: string | null
  name: string
  sku: string | null
  item_type: 'part' | 'service' | 'material' | 'labour'
  unit_of_measure: string
  qty_on_hand: number
  is_stockable: boolean
  brand: string | null
  condition_name: string | null
  is_variant: boolean
  has_variants: boolean
}

interface Props {
  companyId: string
  onSelect: (item: CatalogueSearchResult) => void
  onClose: () => void
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface RawRow {
  id: string
  name: string
  sku: string | null
  item_type: string
  unit_of_measure: string
  qty_on_hand: number
  is_stockable: boolean
  brand: string | null
  variant_group_id: string | null
  is_variant_primary: boolean
  condition_id: string | null
  catalogue_conditions: { name: string } | null
}

type DisplayRow =
  | { kind: 'item';  item: RawRow }
  | { kind: 'group'; primary: RawRow; variants: RawRow[] }

type TypeFilter = 'all' | 'part' | 'service' | 'material' | 'labour'

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  part:     'bg-blue-50 text-blue-600',
  service:  'bg-purple-50 text-purple-600',
  material: 'bg-green-50 text-green-600',
  labour:   'bg-amber-50 text-amber-600',
}

const TYPE_LABELS: Record<string, string> = {
  part: 'Part', service: 'Service', material: 'Material', labour: 'Labour',
}

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'part',     label: 'Parts' },
  { value: 'service',  label: 'Services' },
  { value: 'material', label: 'Materials' },
  { value: 'labour',   label: 'Labour' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function processResults(rows: RawRow[]): DisplayRow[] {
  const groups = new Map<string, RawRow[]>()
  const standalone: RawRow[] = []

  for (const row of rows) {
    if (row.variant_group_id) {
      const g = groups.get(row.variant_group_id) ?? []
      g.push(row)
      groups.set(row.variant_group_id, g)
    } else {
      standalone.push(row)
    }
  }

  const display: DisplayRow[] = []
  for (const row of standalone) {
    display.push({ kind: 'item', item: row })
  }
  for (const [, members] of groups) {
    const primary = members.find(m => m.is_variant_primary) ?? members[0]
    display.push({ kind: 'group', primary, variants: members })
  }
  return display
}

function toResult(row: RawRow, isVariant: boolean, hasVariants: boolean): CatalogueSearchResult {
  return {
    id:              row.id,
    variant_id:      isVariant ? row.id : null,
    name:            row.name,
    sku:             row.sku,
    item_type:       row.item_type as CatalogueSearchResult['item_type'],
    unit_of_measure: row.unit_of_measure,
    qty_on_hand:     row.qty_on_hand,
    is_stockable:    row.is_stockable,
    brand:           row.brand,
    condition_name:  row.catalogue_conditions?.name ?? null,
    is_variant:      isVariant,
    has_variants:    hasVariants,
  }
}

function StockLabel({ row }: { row: RawRow }) {
  if (row.item_type === 'service' || row.item_type === 'labour') return null
  if (!row.is_stockable) return <span className="text-[11px] text-text-secondary">—</span>
  if (row.qty_on_hand > 0) {
    return <span className="text-[11px] text-green-600 font-medium">{row.qty_on_hand} in stock</span>
  }
  return <span className="text-[11px] text-amber-600 font-medium">Out of stock</span>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CatalogueSearchModal({ companyId, onSelect, onClose }: Props) {
  const supabase = createClient()

  const [query,       setQuery]       = useState('')
  const [typeFilter,  setTypeFilter]  = useState<TypeFilter>('all')
  const [results,     setResults]     = useState<DisplayRow[]>([])
  const [loading,     setLoading]     = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [addedIds,    setAddedIds]    = useState<Set<string>>(new Set())

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Search ────────────────────────────────────────────────────────────────

  async function runSearch(q: string, tf: TypeFilter) {
    setLoading(true)
    setHasSearched(true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dbq: any = supabase
      .from('quote_catalogue_items')
      .select(`
        id,
        name,
        sku,
        item_type,
        unit_of_measure,
        qty_on_hand,
        is_stockable,
        brand,
        variant_group_id,
        is_variant_primary,
        condition_id,
        catalogue_conditions ( name )
      `)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')
      .limit(50)

    if (tf !== 'all') dbq = dbq.eq('item_type', tf)
    if (q.trim())     dbq = dbq.or(`name.ilike.%${q}%,sku.ilike.%${q}%,brand.ilike.%${q}%`)

    const { data } = await dbq
    setResults(processResults((data ?? []) as RawRow[]))
    setLoading(false)
  }

  function scheduleSearch(q: string, tf: TypeFilter) {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => void runSearch(q, tf), 300)
  }

  // Initial load
  useEffect(() => {
    void runSearch('', 'all')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleQueryChange(q: string) {
    setQuery(q)
    scheduleSearch(q, typeFilter)
  }

  function handleTypeFilter(tf: TypeFilter) {
    setTypeFilter(tf)
    scheduleSearch(query, tf)
  }

  // ── Add ───────────────────────────────────────────────────────────────────

  function handleAdd(result: CatalogueSearchResult, flashId: string) {
    onSelect(result)
    setAddedIds(prev => new Set([...prev, flashId]))
    setTimeout(() => {
      setAddedIds(prev => { const n = new Set(prev); n.delete(flashId); return n })
    }, 1500)
  }

  // ── Sub-components ────────────────────────────────────────────────────────

  function AddButton({ result, flashId }: { result: CatalogueSearchResult; flashId: string }) {
    const added = addedIds.has(flashId)
    return (
      <button
        type="button"
        onClick={() => handleAdd(result, flashId)}
        className={cn(
          'shrink-0 h-7 px-3 rounded-md text-[11px] font-medium transition-all whitespace-nowrap',
          added
            ? 'bg-green-50 text-green-600 border border-green-200'
            : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20',
        )}
      >
        {added ? '✓ Added' : '+ Add'}
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl bg-surface rounded-xl shadow-2xl flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary">Add from catalogue</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>

        {/* Search + type filters */}
        <div className="px-5 pt-4 pb-3 border-b border-divider shrink-0 space-y-3">
          <div className="relative">
            <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-secondary select-none">
              search
            </span>
            <input
              autoFocus
              type="text"
              placeholder="Search parts, services, materials..."
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-divider bg-surface text-[13px] text-text-primary placeholder-text-secondary focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => handleTypeFilter(f.value)}
                className={cn(
                  'h-7 px-3 rounded-full text-[12px] font-medium transition-colors border',
                  typeFilter === f.value
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-surface-elevated text-text-secondary border-divider hover:border-primary/30 hover:text-primary',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">

          {loading ? (
            // Skeletons
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-divider p-3 animate-pulse space-y-2">
                <div className="flex justify-between items-center">
                  <div className="h-3 w-24 bg-surface-elevated rounded" />
                  <div className="h-5 w-14 bg-surface-elevated rounded-full" />
                </div>
                <div className="h-4 w-52 bg-surface-elevated rounded" />
                <div className="h-3 w-32 bg-surface-elevated rounded" />
              </div>
            ))
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-text-secondary">
              {!hasSearched || (!query.trim() && typeFilter === 'all') ? (
                <>
                  <span className="material-icons text-[40px] mb-3 opacity-30">inventory_2</span>
                  <p className="text-[13px]">Search your parts, services, materials and labour above</p>
                </>
              ) : (
                <>
                  <span className="material-icons text-[40px] mb-3 opacity-30">search_off</span>
                  <p className="text-[13px] font-medium mb-1">
                    Nothing found{query.trim() ? ` for "${query}"` : ''}
                  </p>
                  <p className="text-[12px]">
                    Try a different term, or add it manually using the entry row
                  </p>
                </>
              )}
            </div>
          ) : (
            results.map((row, i) => {

              if (row.kind === 'item') {
                const { item } = row
                const result = toResult(item, false, false)
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-divider p-3 hover:border-primary/30 hover:bg-primary/[0.03] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {item.sku && (
                            <span className="font-mono text-[11px] text-text-secondary">
                              {item.sku}
                            </span>
                          )}
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                            TYPE_COLOURS[item.item_type] ?? 'bg-gray-100 text-gray-600',
                          )}>
                            {TYPE_LABELS[item.item_type] ?? item.item_type}
                          </span>
                        </div>
                        <p className="text-[13px] font-medium text-text-primary truncate">
                          {item.name}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          {(item.item_type === 'part' || item.item_type === 'material') &&
                            (item.brand || item.catalogue_conditions?.name) && (
                              <span className="text-[11px] text-text-secondary">
                                {[item.brand, item.catalogue_conditions?.name]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          <StockLabel row={item} />
                        </div>
                      </div>
                      <AddButton result={result} flashId={item.id} />
                    </div>
                  </div>
                )
              }

              // Variant group
              const { primary, variants } = row
              return (
                <div
                  key={primary.variant_group_id ?? primary.id}
                  className="rounded-lg border border-divider overflow-hidden"
                >
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                    {primary.sku && (
                      <span className="font-mono text-[11px] text-text-secondary">
                        {primary.sku}
                      </span>
                    )}
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                      TYPE_COLOURS[primary.item_type] ?? 'bg-gray-100 text-gray-600',
                    )}>
                      {TYPE_LABELS[primary.item_type] ?? primary.item_type}
                    </span>
                    <span className="ml-auto text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded-full">
                      {variants.length} variant{variants.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="px-3 pb-2 text-[13px] font-medium text-text-primary">
                    {primary.name}
                  </p>

                  {/* Variant children */}
                  <div className="border-t border-divider divide-y divide-divider">
                    {variants.map(v => {
                      const vResult = toResult(v, true, true)
                      const label = [v.brand, v.catalogue_conditions?.name]
                        .filter(Boolean)
                        .join(' · ') || v.name
                      return (
                        <div
                          key={v.id}
                          className="flex items-center gap-3 pl-6 pr-3 py-2 bg-surface-elevated/50 hover:bg-primary/[0.04] transition-colors"
                        >
                          <span className="text-[11px] text-text-secondary shrink-0 select-none">└</span>
                          <span className="flex-1 text-[12px] text-text-secondary truncate">
                            {label}
                          </span>
                          <StockLabel row={v} />
                          <AddButton result={vResult} flashId={v.id} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

      </div>
    </div>
  )
}
