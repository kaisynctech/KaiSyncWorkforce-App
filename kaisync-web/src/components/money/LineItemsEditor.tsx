'use client'

/**
 * The items on a quote or invoice: slim rows (one line each) and an "Add item" picker that searches
 * services, the catalogue and inventory, or adds the user's own line. Every price can be changed here;
 * the change applies to this document only.
 */

import { useMemo, useRef, useState } from 'react'
import {
  ITEM_KIND, blankEditorLine, filterPicks, formatRand, lineFromPick, lineTotal,
  type EditorLine, type ItemType, type PickItem,
} from '@/lib/line-items'

type Props = {
  lines: EditorLine[]
  onChange: (lines: EditorLine[]) => void
  items: PickItem[]
  itemsLoading?: boolean
  readOnly?: boolean
}

const TABS: { key: ItemType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'service', label: 'Services' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'inventory', label: 'Inventory' },
]

function parseMoney(text: string): number {
  const n = parseFloat(text.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

export function LineItemsEditor({ lines, onChange, items, itemsLoading, readOnly }: Props) {
  const [pickerOpen, setPickerOpen] = useState(lines.length === 0 && !readOnly)
  const [tab, setTab] = useState<ItemType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const searchRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => filterPicks(items, tab, query).slice(0, 80), [items, tab, query])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, service: 0, catalogue: 0, inventory: 0 }
    for (const i of items) c[i.type] = (c[i.type] ?? 0) + 1
    return c
  }, [items])

  function update(key: string, patch: Partial<EditorLine>) {
    onChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }
  function remove(key: string) {
    onChange(lines.filter(l => l.key !== key))
  }
  function add(line: EditorLine) {
    onChange([...lines, line])
    setQuery('')
  }
  function openPicker() {
    setPickerOpen(true)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  return (
    <div className="bg-surface-card border border-divider rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold text-text-primary">Items</h2>
        <span className="text-[12px] text-text-secondary">{lines.length} {lines.length === 1 ? 'item' : 'items'}</span>
      </div>

      {lines.map(l => {
        const kind = ITEM_KIND[l.type]
        const isService = l.type === 'service'
        const draft = priceDraft[l.key]
        return (
          <div key={l.key} className="flex flex-wrap items-center gap-2.5 px-5 py-2 border-t border-divider/70 min-h-[52px]">
            <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: kind.dot }} title={kind.label} aria-hidden />
            <div className="flex-1 basis-[220px] min-w-0 flex items-center gap-2">
              {l.type === 'custom' && !readOnly ? (
                <input
                  value={l.description}
                  onChange={e => update(l.key, { description: e.target.value })}
                  placeholder="Describe the work or item"
                  aria-label="Description"
                  className="flex-1 min-w-0 h-[34px] rounded-lg border border-divider px-2.5 text-[13px] text-text-primary bg-background focus:outline-none focus:border-primary/60"
                />
              ) : (
                <>
                  <span className="text-[13.5px] font-medium text-text-primary truncate">{l.description || '—'}</span>
                  {l.hint && <span className="text-[11.5px] text-text-secondary/80 whitespace-nowrap">{l.hint}</span>}
                </>
              )}
            </div>

            {isService ? (
              <span className="text-[11.5px] px-2 py-1 rounded-md whitespace-nowrap" style={{ color: kind.fg, background: kind.bg }}>Fixed price</span>
            ) : (
              <>
                <div className="flex items-center h-8 rounded-lg border border-divider overflow-hidden">
                  <button type="button" disabled={readOnly} aria-label="Fewer" onClick={() => update(l.key, { qty: Math.max(1, (Number(l.qty) || 1) - 1) })}
                    className="w-7 h-8 bg-surface-elevated text-[14px] text-text-secondary hover:text-text-primary disabled:opacity-40">−</button>
                  <input
                    value={String(l.qty)}
                    disabled={readOnly}
                    inputMode="decimal"
                    aria-label="Quantity"
                    onChange={e => {
                      const n = parseFloat(e.target.value.replace(',', '.'))
                      update(l.key, { qty: Number.isFinite(n) && n >= 0 ? n : 0 })
                    }}
                    className="w-10 h-8 text-center text-[13px] font-semibold text-text-primary bg-transparent focus:outline-none"
                  />
                  <button type="button" disabled={readOnly} aria-label="More" onClick={() => update(l.key, { qty: (Number(l.qty) || 0) + 1 })}
                    className="w-7 h-8 bg-surface-elevated text-[14px] text-text-secondary hover:text-text-primary disabled:opacity-40">+</button>
                </div>
                <span className="text-[12px] text-text-secondary/70">×</span>
              </>
            )}

            <label className="flex items-center gap-1 h-8 rounded-lg border border-divider px-2 text-[12.5px] text-text-secondary bg-background focus-within:border-primary/60">
              R
              <input
                value={draft ?? (l.unitPrice ? l.unitPrice.toFixed(2) : '')}
                disabled={readOnly}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Unit price"
                onChange={e => {
                  setPriceDraft(d => ({ ...d, [l.key]: e.target.value }))
                  update(l.key, { unitPrice: parseMoney(e.target.value) })
                }}
                onBlur={() => setPriceDraft(d => { const n = { ...d }; delete n[l.key]; return n })}
                className="w-[76px] text-right text-[13px] text-text-primary bg-transparent focus:outline-none"
              />
            </label>

            <span className="w-[104px] text-right text-[13.5px] font-semibold text-text-primary tabular-nums whitespace-nowrap">{formatRand(lineTotal(l))}</span>
            {!readOnly && (
              <button type="button" aria-label="Remove line" onClick={() => remove(l.key)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary/60 hover:text-error hover:bg-error/10">
                <span className="material-icons text-[16px]">close</span>
              </button>
            )}
          </div>
        )
      })}

      {!readOnly && (
        <div className="px-5 pt-3 pb-5 border-t border-divider/70">
          {!pickerOpen ? (
            <button type="button" onClick={openPicker}
              className="w-full h-12 rounded-xl border-[1.5px] border-dashed border-primary/40 bg-primary/[0.03] text-primary text-[14px] font-semibold flex items-center justify-center gap-2 hover:bg-primary/[0.06]">
              <span className="material-icons text-[18px]">add</span>
              Add item
            </button>
          ) : (
            <div className="rounded-2xl border border-primary/30 bg-surface-card shadow-[0_10px_30px_rgba(30,58,138,0.08)] overflow-hidden">
              <div className="p-3.5 flex flex-col gap-3 border-b border-divider/70">
                <div className="flex items-center gap-2.5 h-11 rounded-xl border border-divider px-3 focus-within:border-primary/60">
                  <span className="material-icons text-[18px] text-text-secondary">search</span>
                  <input
                    ref={searchRef}
                    autoFocus={lines.length > 0}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search services, catalogue and stock…"
                    aria-label="Search items"
                    className="flex-1 min-w-0 h-10 text-[14px] text-text-primary bg-transparent focus:outline-none"
                  />
                  {lines.length > 0 && (
                    <button type="button" onClick={() => setPickerOpen(false)} className="text-[13px] text-text-secondary hover:text-text-primary">Close</button>
                  )}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {TABS.map(t => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                      className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium border transition-colors ${tab === t.key ? 'bg-primary border-primary text-white' : 'bg-surface-card border-divider text-text-secondary hover:text-text-primary'}`}>
                      {t.label}{counts[t.key] ? <span className={tab === t.key ? 'opacity-80' : 'opacity-60'}> · {counts[t.key]}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {itemsLoading && <p className="px-4 py-4 text-[13px] text-text-secondary">Loading your items…</p>}
                {!itemsLoading && results.map(r => {
                  const kind = ITEM_KIND[r.type]
                  return (
                    <button key={r.key} type="button" onClick={() => add(lineFromPick(r))}
                      className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-divider/60 text-left hover:bg-primary/[0.04]">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap" style={{ color: kind.fg, background: kind.bg }}>{kind.label}</span>
                      <span className="flex-1 min-w-0 flex flex-col">
                        <span className="text-[13.5px] font-medium text-text-primary truncate">{r.name}</span>
                        <span className="text-[11.5px] text-text-secondary truncate">{r.detail}</span>
                      </span>
                      <span className="text-[13.5px] font-semibold text-text-primary tabular-nums whitespace-nowrap">{formatRand(r.price)}</span>
                      <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <span className="material-icons text-[16px]">add</span>
                      </span>
                    </button>
                  )
                })}
                {!itemsLoading && results.length === 0 && (
                  <p className="px-4 py-4 text-[13px] text-text-secondary">
                    {items.length === 0
                      ? 'No services, catalogue or stock items yet. Write your own line below.'
                      : 'Nothing matches. Write it as your own line below.'}
                  </p>
                )}
              </div>
              <button type="button"
                onClick={() => {
                  const l = blankEditorLine()
                  if (query.trim()) l.description = query.trim()
                  add(l)
                  setPickerOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-4 py-3 bg-surface-elevated text-[13px] font-semibold text-text-primary text-left hover:bg-surface-elevated/70">
                <span className="material-icons text-[16px] text-text-secondary">edit</span>
                {query.trim() ? `Add “${query.trim()}” as your own line` : 'Write your own line (description, quantity, price)'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
