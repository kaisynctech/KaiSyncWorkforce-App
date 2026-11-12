'use client'

/**
 * The items on a quote or invoice.
 * Writing your own line comes first: there is always an empty "Describe the work or item" row at the bottom,
 * ready to type in. While you type, matching services, catalogue and stock items are offered under the row;
 * pick one to use its price, or just keep typing. "Browse services, catalogue and stock" at the bottom opens
 * a search for when you want to look things up. Every price can be changed; the change applies to this
 * document only.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ITEM_KIND, blankEditorLine, filterPicks, formatRand, lineFromPick, lineQty, lineTotal, linesProfit,
  type EditorLine, type ItemType, type PickItem,
} from '@/lib/line-items'
import { currencySymbol, formatCurrency } from '@/lib/currencies'

type Props = {
  lines: EditorLine[]
  onChange: (lines: EditorLine[]) => void
  items: PickItem[]
  itemsLoading?: boolean
  readOnly?: boolean
  /** Put the cursor in the empty line straight away (a new document). */
  startOpen?: boolean
  /** The document's currency, for the line totals (catalogue prices stay in the company currency). */
  currency?: string
  /** Office only: a cost per line and the profit and margin it leaves (never printed or shown to the client). */
  showCost?: boolean
}

function marginText(pct: number): string {
  return `${pct.toLocaleString('en-ZA', { maximumFractionDigits: 1 })}%`
}

const TABS: { key: ItemType; label: string }[] = [
  { key: 'service', label: 'Services' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'inventory', label: 'Inventory' },
]

const SUGGEST_MAX = 6
const BROWSE_MAX = 50

function parseMoney(text: string): number {
  const n = parseFloat(text.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

function KindChip({ type }: { type: ItemType }) {
  const k = ITEM_KIND[type]
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap" style={{ color: k.fg, background: k.bg }}>{k.label}</span>
}

function PickRow({ item, onPick, compact }: { item: PickItem; onPick: () => void; compact?: boolean }) {
  return (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onPick}
      className={`w-full flex items-center gap-3 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} border-b border-divider/60 last:border-b-0 text-left hover:bg-primary/[0.05]`}>
      <KindChip type={item.type} />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13.5px] font-medium text-text-primary truncate">{item.name}</span>
        {!compact && <span className="text-[11.5px] text-text-secondary truncate">{item.detail}</span>}
      </span>
      {compact && <span className="text-[11.5px] text-text-secondary truncate max-w-[40%] hidden sm:inline">{item.detail}</span>}
      <span className="text-[13.5px] font-semibold text-text-primary tabular-nums whitespace-nowrap">{formatRand(item.price)}</span>
      <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <span className="material-icons text-[16px]">add</span>
      </span>
    </button>
  )
}

export function LineItemsEditor({ lines, onChange, items, itemsLoading, readOnly, startOpen, currency, showCost }: Props) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [tab, setTab] = useState<ItemType | null>(null)
  const [query, setQuery] = useState('')
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [costDraft, setCostDraft] = useState<Record<string, string>>({})
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map())
  const ghostRef = useRef<HTMLInputElement>(null)
  const browseRef = useRef<HTMLInputElement>(null)

  // Move the cursor into a line that was just created from the empty row.
  useEffect(() => {
    if (!focusKey) return
    const el = inputs.current.get(focusKey)
    if (el) {
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
      setFocusKey(null)
    }
  }, [focusKey, lines])

  useEffect(() => {
    if (startOpen && !readOnly) ghostRef.current?.focus()
  }, [startOpen, readOnly])

  const counts = useMemo(() => {
    const c: Record<ItemType, number> = { service: 0, catalogue: 0, inventory: 0, custom: 0 }
    for (const i of items) c[i.type] += 1
    return c
  }, [items])

  // Browse: nothing is listed until you search or choose a list, so thousands of items never crowd the screen.
  const browseResults = useMemo(() => {
    if (!query.trim() && !tab) return []
    return filterPicks(items, tab ?? 'all', query).slice(0, BROWSE_MAX)
  }, [items, tab, query])

  const activeLine = lines.find(l => l.key === activeKey && l.type === 'custom') ?? null
  const suggestions = useMemo(() => {
    const q = activeLine?.description.trim() ?? ''
    if (q.length < 2) return []
    return filterPicks(items, 'all', q).slice(0, SUGGEST_MAX)
  }, [items, activeLine?.description])

  function update(key: string, patch: Partial<EditorLine>) {
    onChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }
  function remove(key: string) {
    onChange(lines.filter(l => l.key !== key))
  }
  function pickFor(key: string, item: PickItem) {
    const picked = lineFromPick(item)
    onChange(lines.map(l => (l.key === key ? { ...picked, key, qty: l.qty || 1, unitCost: picked.unitCost ?? l.unitCost ?? null } : l)))
    setActiveKey(null)
    setTimeout(() => ghostRef.current?.focus(), 0)
  }
  function startLine(text: string) {
    const l = blankEditorLine()
    l.description = text
    onChange([...lines, l])
    setActiveKey(l.key)
    setFocusKey(l.key)
  }
  function addFromBrowse(item: PickItem) {
    onChange([...lines, lineFromPick(item)])
  }

  const total = lines.length

  const TH = 'px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary whitespace-nowrap'
  const moneyInput = (value: string, onText: (t: string) => void, onBlur: () => void, label: string) => (
    <label className="inline-flex items-center gap-1 h-8 w-full rounded-lg border border-divider px-2 text-[12px] text-text-secondary bg-background focus-within:border-primary/60">
      {currencySymbol(currency)}
      <input value={value} inputMode="decimal" placeholder="0.00" aria-label={label}
        onChange={e => onText(e.target.value)} onBlur={onBlur}
        className="w-full min-w-0 text-right text-[13px] text-text-primary bg-transparent focus:outline-none" />
    </label>
  )

  const costSum = showCost ? linesProfit(lines) : null


  return (
    <div className="bg-surface-card border border-divider rounded-2xl">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold text-text-primary">Items</h2>
        <span className="text-[12px] text-text-secondary">{total} {total === 1 ? 'item' : 'items'}</span>
      </div>

      {/* Quotes: the items as a table: item, qty, cost price, selling price, margin, profit, line total. */}
      {showCost ? (lines.length === 0 ? null : (
      <div className="overflow-x-auto border-t border-divider/70">
        <table className="w-full text-[13px]" style={{ minWidth: 820 }}>
          <colgroup>
            <col />
            <col style={{ width: 118 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 76 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 120 }} />
            {!readOnly && <col style={{ width: 40 }} />}
          </colgroup>
          <thead>
            <tr className="bg-surface-elevated/60 border-b border-divider">
              <th className={`${TH} text-left pl-5`}>Item</th>
              <th className={`${TH} text-center`}>Qty</th>
              <th className={`${TH} text-right`} title="Only your team sees this">
                <span className="inline-flex items-center gap-1"><span className="material-icons !text-[12px] !leading-none">lock</span>Cost price</span>
              </th>
              <th className={`${TH} text-right`}>Selling price</th>
              <th className={`${TH} text-right`} title="Only your team sees this">Margin</th>
              <th className={`${TH} text-right`} title="Only your team sees this">Profit</th>
              <th className={`${TH} text-right pr-5`}>Total</th>
              {!readOnly && <th className={TH} />}
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const kind = ITEM_KIND[l.type]
              const isService = l.type === 'service'
              const cost = Number(l.unitCost) || 0
              const sell = lineTotal(l)
              const profit = Math.round((sell - lineQty(l) * cost) * 100) / 100
              const showSuggest = !readOnly && l.key === activeKey && l.type === 'custom' && suggestions.length > 0
              return (
                <Fragment key={l.key}>
                  <tr className="border-b border-divider/60 align-middle">
                    <td className="py-1.5 pl-5 pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: kind.dot }} title={kind.label} aria-hidden />
                        {l.type === 'custom' && !readOnly ? (
                          <input
                            ref={el => { if (el) inputs.current.set(l.key, el); else inputs.current.delete(l.key) }}
                            value={l.description}
                            onChange={e => { update(l.key, { description: e.target.value }); setActiveKey(l.key) }}
                            onFocus={() => setActiveKey(l.key)}
                            onBlur={() => setTimeout(() => setActiveKey(k => (k === l.key ? null : k)), 120)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setActiveKey(null); ghostRef.current?.focus() } }}
                            placeholder="Describe the work or item"
                            aria-label="Description"
                            className="flex-1 min-w-0 h-8 rounded-lg border border-divider px-2.5 text-[13px] text-text-primary bg-background focus:outline-none focus:border-primary/60"
                          />
                        ) : (
                          <span className="min-w-0 truncate" title={l.description}>
                            <span className="font-medium text-text-primary">{l.description || '—'}</span>
                            {l.hint && <span className="ml-1.5 text-[11.5px] text-text-secondary/80">{l.hint}</span>}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      {isService ? (
                        <span className="block text-center text-[11.5px] px-2 py-1 rounded-md whitespace-nowrap" style={{ color: kind.fg, background: kind.bg }}>Fixed price</span>
                      ) : (
                        <div className="flex items-center h-8 rounded-lg border border-divider overflow-hidden mx-auto w-fit">
                          <button type="button" disabled={readOnly} aria-label="Fewer" onClick={() => update(l.key, { qty: Math.max(1, (Number(l.qty) || 1) - 1) })}
                            className="w-7 h-8 bg-surface-elevated text-[14px] text-text-secondary hover:text-text-primary disabled:opacity-40">−</button>
                          <input value={String(l.qty)} disabled={readOnly} inputMode="decimal" aria-label="Quantity"
                            onChange={e => { const n = parseFloat(e.target.value.replace(',', '.')); update(l.key, { qty: Number.isFinite(n) && n >= 0 ? n : 0 }) }}
                            className="w-10 h-8 text-center text-[13px] font-semibold text-text-primary bg-transparent focus:outline-none" />
                          <button type="button" disabled={readOnly} aria-label="More" onClick={() => update(l.key, { qty: (Number(l.qty) || 0) + 1 })}
                            className="w-7 h-8 bg-surface-elevated text-[14px] text-text-secondary hover:text-text-primary disabled:opacity-40">+</button>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {readOnly ? (cost > 0 ? formatCurrency(cost, currency) : '—') : moneyInput(
                        costDraft[l.key] ?? (cost ? cost.toFixed(2) : ''),
                        t => { setCostDraft(d => ({ ...d, [l.key]: t })); update(l.key, { unitCost: parseMoney(t) || null }) },
                        () => setCostDraft(d => { const n = { ...d }; delete n[l.key]; return n }),
                        'Cost price',
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {readOnly ? formatCurrency(l.unitPrice, currency) : moneyInput(
                        priceDraft[l.key] ?? (l.unitPrice ? l.unitPrice.toFixed(2) : ''),
                        t => { setPriceDraft(d => ({ ...d, [l.key]: t })); update(l.key, { unitPrice: parseMoney(t) }) },
                        () => setPriceDraft(d => { const n = { ...d }; delete n[l.key]; return n }),
                        'Selling price',
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-text-secondary">
                      {cost > 0 && sell > 0 ? marginText((profit / sell) * 100) : '—'}
                    </td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${cost > 0 ? (profit < 0 ? 'text-error' : 'text-emerald-700') : 'text-text-secondary'}`}>
                      {cost > 0 ? formatCurrency(profit, currency) : '—'}
                    </td>
                    <td className="py-1.5 pl-2 pr-5 text-right tabular-nums font-semibold text-text-primary whitespace-nowrap">{formatCurrency(sell, currency)}</td>
                    {!readOnly && (
                      <td className="py-1.5 pr-3 text-center">
                        <button type="button" aria-label="Remove line" onClick={() => remove(l.key)}
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-text-secondary/60 hover:text-error hover:bg-error/10">
                          <span className="material-icons text-[16px]">close</span>
                        </button>
                      </td>
                    )}
                  </tr>
                  {showSuggest && (
                    <tr>
                      <td colSpan={readOnly ? 7 : 8} className="px-5 pb-2.5">
                        <div className="rounded-xl border border-primary/25 bg-surface-card shadow-[0_8px_24px_rgba(30,58,138,0.08)] overflow-hidden">
                          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Use one of yours instead?</p>
                          {suggestions.map(sg => <PickRow key={sg.key} item={sg} compact onPick={() => pickFor(l.key, sg)} />)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="bg-surface-elevated/60 border-b border-divider font-semibold">
                <td className="py-2.5 pl-5 pr-2 text-text-primary">Total <span className="font-normal text-[11.5px] text-text-secondary">(excl. VAT)</span></td>
                <td />
                <td className="py-2.5 px-2 text-right tabular-nums text-text-primary">{costSum!.costed ? formatCurrency(costSum!.cost, currency) : '—'}</td>
                <td />
                <td className="py-2.5 px-2 text-right tabular-nums text-text-primary">{costSum!.costed ? marginText(costSum!.marginPct) : '—'}</td>
                <td className={`py-2.5 px-2 text-right tabular-nums ${costSum!.costed ? (costSum!.profit < 0 ? 'text-error' : 'text-emerald-700') : 'text-text-secondary'}`}>{costSum!.costed ? formatCurrency(costSum!.profit, currency) : '—'}</td>
                <td className="py-2.5 pl-2 pr-5 text-right tabular-nums text-text-primary whitespace-nowrap">{formatCurrency(costSum!.sell, currency)}</td>
                {!readOnly && <td />}
              </tr>
              <tr>
                <td colSpan={readOnly ? 7 : 8} className="px-5 py-1.5 text-[11.5px] text-text-secondary">
                  <span className="inline-flex items-center gap-1"><span className="material-icons !text-[13px] !leading-none">lock</span>Cost price, margin and profit are only for your team. They never show on the quote PDF or the client&apos;s page.</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )) : (
        <>
        {lines.map(l => {
          const kind = ITEM_KIND[l.type]
          const isService = l.type === 'service'
          const draft = priceDraft[l.key]
          const showSuggest = !readOnly && l.key === activeKey && l.type === 'custom' && suggestions.length > 0
          return (
            <div key={l.key} className="border-t border-divider/70">
              <div className="flex flex-wrap items-center gap-2.5 px-5 py-2 min-h-[52px]">
                <span className="w-2 h-2 rounded-[3px] shrink-0" style={{ background: kind.dot }} title={kind.label} aria-hidden />
                <div className="flex-1 basis-[220px] min-w-0 flex items-center gap-2">
                  {l.type === 'custom' && !readOnly ? (
                    <input
                      ref={el => { if (el) inputs.current.set(l.key, el); else inputs.current.delete(l.key) }}
                      value={l.description}
                      onChange={e => { update(l.key, { description: e.target.value }); setActiveKey(l.key) }}
                      onFocus={() => setActiveKey(l.key)}
                      onBlur={() => setTimeout(() => setActiveKey(k => (k === l.key ? null : k)), 120)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setActiveKey(null); ghostRef.current?.focus() } }}
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
                  {currencySymbol(currency)}
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

                <span className="w-[104px] text-right text-[13.5px] font-semibold text-text-primary tabular-nums whitespace-nowrap">{formatCurrency(lineTotal(l), currency)}</span>
                {!readOnly && (
                  <button type="button" aria-label="Remove line" onClick={() => remove(l.key)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary/60 hover:text-error hover:bg-error/10">
                    <span className="material-icons text-[16px]">close</span>
                  </button>
                )}
              </div>

              {showSuggest && (
                <div className="mx-5 mb-2.5 -mt-0.5 rounded-xl border border-primary/25 bg-surface-card shadow-[0_8px_24px_rgba(30,58,138,0.08)] overflow-hidden">
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Use one of yours instead?</p>
                  {suggestions.map(s => <PickRow key={s.key} item={s} compact onPick={() => pickFor(l.key, s)} />)}
                </div>
              )}
            </div>
          )
        })}

        </>
      )}

      {!readOnly && (
        <>
          {/* The empty line: always ready to type in. */}
          <div className="border-t border-divider/70 flex items-center gap-2.5 px-5 py-2 min-h-[52px]">
            <span className="material-icons text-[16px] text-primary/70" aria-hidden>add</span>
            <input
              ref={ghostRef}
              value=""
              onChange={e => { if (e.target.value) startLine(e.target.value) }}
              placeholder={lines.length ? 'Add another line — describe the work or item' : 'Describe the work or item'}
              aria-label="New line description"
              className="flex-1 min-w-0 h-[34px] rounded-lg border border-dashed border-primary/35 bg-primary/[0.02] px-2.5 text-[13px] text-text-primary placeholder:text-text-secondary/80 focus:outline-none focus:border-primary/60 focus:border-solid"
            />
          </div>

          {/* Browse: tucked away at the bottom. */}
          <div className="border-t border-divider/70 px-5 py-3">
            {!browseOpen ? (
              <button type="button"
                onClick={() => { setBrowseOpen(true); setTimeout(() => browseRef.current?.focus(), 0) }}
                className="flex items-center gap-2 text-[13px] font-medium text-primary hover:underline">
                <span className="material-icons text-[17px]">search</span>
                Browse services, catalogue and stock
                {!itemsLoading && items.length > 0 && <span className="text-text-secondary font-normal">({items.length})</span>}
              </button>
            ) : (
              <div className="rounded-2xl border border-divider overflow-hidden">
                <div className="p-3 flex flex-col gap-2.5 border-b border-divider/70 bg-surface-elevated/40">
                  <div className="flex items-center gap-2.5 h-10 rounded-xl border border-divider bg-surface-card px-3 focus-within:border-primary/60">
                    <span className="material-icons text-[18px] text-text-secondary">search</span>
                    <input
                      ref={browseRef}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Search by name or code…"
                      aria-label="Search services, catalogue and stock"
                      className="flex-1 min-w-0 h-9 text-[13.5px] text-text-primary bg-transparent focus:outline-none"
                    />
                    <button type="button" onClick={() => { setBrowseOpen(false); setQuery(''); setTab(null) }}
                      className="text-[12.5px] text-text-secondary hover:text-text-primary">Close</button>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {TABS.map(t => (
                      <button key={t.key} type="button" onClick={() => setTab(cur => (cur === t.key ? null : t.key))}
                        className={`h-7 px-3 rounded-full text-[12px] font-medium border transition-colors ${tab === t.key ? 'bg-primary border-primary text-white' : 'bg-surface-card border-divider text-text-secondary hover:text-text-primary'}`}>
                        {t.label} <span className="opacity-70">· {counts[t.key]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[280px] overflow-y-auto">
                  {itemsLoading && <p className="px-4 py-3 text-[13px] text-text-secondary">Loading your items…</p>}
                  {!itemsLoading && !query.trim() && !tab && (
                    <p className="px-4 py-3 text-[12.5px] text-text-secondary">Type to search, or choose Services, Catalogue or Inventory.</p>
                  )}
                  {!itemsLoading && browseResults.map(r => <PickRow key={r.key} item={r} onPick={() => addFromBrowse(r)} />)}
                  {!itemsLoading && (query.trim() || tab) && browseResults.length === 0 && (
                    <p className="px-4 py-3 text-[12.5px] text-text-secondary">Nothing matches.</p>
                  )}
                  {!itemsLoading && browseResults.length === BROWSE_MAX && (
                    <p className="px-4 py-2 text-[11.5px] text-text-secondary">Showing the first {BROWSE_MAX}. Type to narrow it down.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
