'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RateCardItem {
  id:         string
  name:       string
  item_type:  string
  unit:       string
  sell_price: number | null
  cost_price: number | null
}

export interface RateCardSelection {
  name:               string
  unit:               string
  unit_price:         number
  catalogue_item_id:  string
}

interface Props {
  companyId: string
  onSelect:  (item: RateCardSelection) => void
  onClose:   () => void
}

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

type TypeFilter = 'all' | 'part' | 'service' | 'material' | 'labour'

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'service',  label: 'Services' },
  { value: 'material', label: 'Materials' },
  { value: 'labour',   label: 'Labour' },
  { value: 'part',     label: 'Parts' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function RateCardPicker({ companyId, onSelect, onClose }: Props) {
  const supabase = createClient()

  const [query,      setQuery]      = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [items,      setItems]      = useState<RateCardItem[]>([])
  const [loading,    setLoading]    = useState(false)
  const [addedIds,   setAddedIds]   = useState<Set<string>>(new Set())

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Search ────────────────────────────────────────────────────────────────

  async function runSearch(q: string, tf: TypeFilter) {
    setLoading(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dbq: any = supabase
      .from('quote_catalogue_items')
      .select('id, name, item_type, unit, sell_price, cost_price')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')
      .limit(60)

    if (tf !== 'all') dbq = dbq.eq('item_type', tf)
    if (q.trim())     dbq = dbq.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)

    const { data } = await dbq
    setItems((data ?? []) as RateCardItem[])
    setLoading(false)
  }

  function scheduleSearch(q: string, tf: TypeFilter) {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => void runSearch(q, tf), 300)
  }

  useEffect(() => { void runSearch('', 'all') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add ───────────────────────────────────────────────────────────────────

  function handleAdd(item: RateCardItem) {
    onSelect({
      name:              item.name,
      unit:              item.unit,
      unit_price:        Number(item.sell_price ?? item.cost_price ?? 0),
      catalogue_item_id: item.id,
    })
    setAddedIds(prev => new Set([...prev, item.id]))
    setTimeout(() => {
      setAddedIds(prev => { const n = new Set(prev); n.delete(item.id); return n })
    }, 1500)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg bg-surface rounded-xl shadow-2xl flex flex-col max-h-[75vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary">Add from rate card</h2>
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
              placeholder="Search services, materials, labour rates…"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                scheduleSearch(e.target.value, typeFilter)
              }}
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-divider bg-surface text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setTypeFilter(f.value)
                  scheduleSearch(query, f.value)
                }}
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
        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3 animate-pulse">
                <div className="flex-1 h-4 bg-surface-elevated rounded" />
                <div className="w-20 h-3 bg-surface-elevated rounded" />
                <div className="w-14 h-7 bg-surface-elevated rounded-md" />
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary">
              <span className="material-icons text-[36px] mb-2 opacity-30">search_off</span>
              <p className="text-[13px]">
                {query.trim() ? `Nothing found for "${query}"` : 'No catalogue items found'}
              </p>
            </div>
          ) : (
            items.map(item => {
              const added = addedIds.has(item.id)
              const price = Number(item.sell_price ?? item.cost_price ?? 0)
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-surface-elevated transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] text-text-primary font-medium">
                        {item.name}
                      </p>
                      <span className={cn(
                        'shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                        TYPE_COLOURS[item.item_type] ?? 'bg-gray-100 text-gray-600',
                      )}>
                        {TYPE_LABELS[item.item_type] ?? item.item_type}
                      </span>
                    </div>
                  </div>

                  <span className="text-[12px] text-text-secondary shrink-0 tabular-nums">
                    {price > 0 ? `R ${price.toFixed(2)} / ${item.unit}` : `— / ${item.unit}`}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleAdd(item)}
                    className={cn(
                      'shrink-0 h-7 px-3 rounded-md text-[11px] font-medium transition-all whitespace-nowrap',
                      added
                        ? 'bg-green-50 text-green-600 border border-green-200'
                        : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20',
                    )}
                  >
                    {added ? '✓ Added' : '+ Add'}
                  </button>
                </div>
              )
            })
          )}
        </div>

      </div>
    </div>
  )
}
