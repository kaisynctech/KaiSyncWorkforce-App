'use client'

/**
 * The quotation's lines as a slim, editable table (bigger screens). Every value is a box you can click and type in;
 * a bin removes the line, and ⋯ opens the line's extras (discount, repeats, section, notes, an option for the
 * client) in a row under it. The last row adds a line: type or search the item, then quantity, unit, rate and cost;
 * Enter adds it. Cost and margin are shaded: only the team sees them.
 */

import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/currencies'
import { priceForMargin, type PickItem } from '@/lib/line-items'
import { engineLineTotal, PERIOD_LABEL, type RecurringPeriod } from '@/lib/quote-engine'
import type { QuoteTemplate, TemplateColumn } from '@/lib/quote-templates'
import type { TLine } from '@/components/quotes/TemplateLines'

const n2 = (v: string) => { const x = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0 }
const fix2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const CORE = new Set(['item', 'qty', 'price', 'rate', 'total', 'cost', 'margin', 'unit', 'days'])
const EXTRA_KNOWN: { key: string; label: string }[] = [
  { key: 'part_no', label: 'Part no.' }, { key: 'brand', label: 'Brand' }, { key: 'condition', label: 'Condition' },
  { key: 'warranty', label: 'Warranty' }, { key: 'note', label: 'Note' },
]
const UNITS = ['each', 'job', 'hour', 'day', 'm', 'm²', 'm³', 'kg', 'litre', 'set', 'lot', 'box', 'bag', 'pack', 'trip', 'person']

/** A number box that keeps what you type until you leave it (so "1," doesn't jump to "1"). */
function NumBox({ value, onCommit, label, className, placeholder, disabled, money }: {
  value: number | null; onCommit: (n: number | null) => void; label: string; className?: string; placeholder?: string; disabled?: boolean
  /** Show as an amount: 1 800,00. */
  money?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const plain = value == null || Number.isNaN(value) ? '' : money
    ? value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toLocaleString('en-ZA', { maximumFractionDigits: 2 })
  const shown = text ?? plain
  return (
    <input inputMode="decimal" aria-label={label} value={shown} placeholder={placeholder} disabled={disabled}
      onFocus={e => { setText(shown); e.currentTarget.select() }}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text != null) { onCommit(text.trim() === '' ? null : n2(text)) } setText(null) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
      className={cn('ql-cell text-right', className)} />
  )
}

export type LinesTableProps = {
  template: QuoteTemplate
  lines: TLine[]
  groups: { section: string | null; lines: { key: string; line: TLine }[] }[]
  items: PickItem[]
  itemsLoading?: boolean
  currency?: string
  showCost: boolean
  hasDays: boolean
  sections: string[]
  newSection: string | null
  onPatch: (key: string, p: Partial<TLine>) => void
  onRemove: (key: string) => void
  onAdd: (pick: PickItem | null, qty: number, extra?: Partial<TLine>) => TLine
  onAddOption?: (main: TLine) => void
  lineExtra?: (l: TLine) => ReactNode
}

export function QuoteLinesTable(p: LinesTableProps) {
  const { template, currency, showCost, hasDays } = p
  const f = new Set(template.features)
  const keyOf = (l: TLine) => l.id ?? l.tempId
  const vis = template.columns.filter(c => c.visible && (showCost || !c.team_only))
  const has = (k: string) => vis.some(c => c.key === k)
  const extras: TemplateColumn[] = vis.filter(c => !CORE.has(c.key))
  const priceCol = vis.find(c => c.key === 'rate' || c.key === 'price')
  const cols = {
    qty: true, days: hasDays, unit: has('unit') || !has('days'), price: true,
    cost: showCost, margin: showCost,
  }
  // # · item · extras · qty · days · unit · rate · cost · margin · total · actions
  const grid = [
    '30px', 'minmax(180px,1fr)', ...extras.map(() => '96px'), '62px', ...(cols.days ? ['56px'] : []), ...(cols.unit ? ['74px'] : []),
    '96px', ...(cols.cost ? ['86px'] : []), ...(cols.margin ? ['64px'] : []), '108px', '52px',
  ].join(' ')
  const minW = 30 + 180 + extras.length * 96 + 62 + (cols.days ? 56 : 0) + (cols.unit ? 74 : 0) + 96 + (cols.cost ? 86 : 0) + (cols.margin ? 64 : 0) + 108 + 52 + 40
  const [open, setOpen] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ line: TLine; at: number } | null>(null)
  let n = 0

  function marginOf(l: TLine): number | null {
    const cost = Number(l.unit_cost) || 0
    const net = l.qty > 0 ? l.total / l.qty : 0
    return cost > 0 && net > 0 ? ((net - cost) / net) * 100 : null
  }
  function units(l: TLine) { const d = hasDays ? Number(l.extra?.days) || 0 : 0; return { u: d ? Math.round((l.qty / d) * 100) / 100 : l.qty, d } }
  function setUnitsDays(l: TLine, u: number, d: number | null) {
    if (!hasDays) return p.onPatch(keyOf(l), { qty: u })
    const e = { ...(l.extra ?? {}) }
    if (d && d > 0) { e.days = String(d); e.units = String(u) } else { delete e.days; delete e.units }
    p.onPatch(keyOf(l), { qty: d && d > 0 ? Math.round(u * d * 100) / 100 : u, extra: e })
  }
  function setTotal(l: TLine, total: number) {
    if (!(l.qty > 0)) return
    const d = Math.min(99.99, Math.max(0, Number(l.discount_pct) || 0)) / 100
    p.onPatch(keyOf(l), { unit_price: Math.round((total / l.qty / (1 - d)) * 100) / 100 })
  }
  function remove(l: TLine) {
    p.onRemove(keyOf(l)); setOpen(null)
    setUndo({ line: l, at: Date.now() })
    window.setTimeout(() => setUndo(u => (u && Date.now() - u.at >= 5900 ? null : u)), 6000)
  }

  return (
    <div className="rounded-[14px] border border-divider bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: minW }} className="text-[13px]">
          {/* Header */}
          <div className="grid items-center h-8 px-3.5 bg-surface-elevated border-b border-divider text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary" style={{ gridTemplateColumns: grid }}>
            <span>#</span><span>{vis.find(c => c.key === 'item')?.label ?? 'Item'}</span>
            {extras.map(c => <span key={c.key} className="pl-1.5">{c.label}</span>)}
            <span className="text-right">{vis.find(c => c.key === 'qty')?.label ?? 'Qty'}</span>
            {cols.days && <span className="text-right">Days</span>}
            {cols.unit && <span className="pl-2">Unit</span>}
            <span className="text-right">{priceCol?.label ?? 'Rate'}</span>
            {cols.cost && <span className="ql-team h-8 flex items-center justify-end pr-2">Cost</span>}
            {cols.margin && <span className="ql-team h-8 flex items-center justify-end pr-2">Margin</span>}
            <span className="text-right">Total</span><span />
          </div>

          {p.lines.length === 0 && (
            <p className="px-4 py-5 text-center text-[13px] text-text-secondary border-b border-divider">Nothing on this quotation yet. Type the first item in the row below.</p>
          )}

          {p.groups.map(g => (
            <Fragment key={g.section ?? '__none'}>
              {g.section && (
                <div className="flex items-center justify-between h-[30px] px-3.5 bg-surface-elevated/70 border-b border-divider text-[12.5px] font-bold text-text-primary">
                  <span className="truncate">{g.section}</span>
                  <span className="text-text-secondary font-semibold">{formatCurrency(Math.round(g.lines.filter(x => !x.line.option_of).reduce((s, x) => s + x.line.total, 0) * 100) / 100, currency)}</span>
                </div>
              )}
              {g.lines.map(el => {
                const l = el.line
                const opt = !!l.option_of
                const contingency = !!l.is_contingency
                if (!opt && !contingency) n++
                const { u, d } = units(l)
                const mg = marginOf(l)
                const isOpen = open === el.key
                const extraNode = p.lineExtra?.(l)
                return (
                  <Fragment key={el.key}>
                    <div className={cn('ql-row grid items-center min-h-[34px] px-3.5 border-b border-divider', n % 2 === 0 && 'bg-surface-elevated/30', opt && 'bg-sky-50/60 dark:bg-sky-950/20')}
                      style={{ gridTemplateColumns: grid }}>
                      <span className="text-text-secondary">{opt ? '' : contingency ? '' : n}</span>
                      <span className={cn('pr-2 min-w-0 py-1', opt && 'pl-4')}>
                        {opt && <span className="block text-[10px] font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wide">Option for the client · not in total</span>}
                        {contingency
                          ? <span className="text-text-secondary">{l.description}</span>
                          : <input aria-label="Item" value={l.description} placeholder="Describe the item"
                              onChange={e => p.onPatch(el.key, { description: e.target.value })} className="ql-cell w-full" />}
                        {(l.recurring || l.hint || Number(l.discount_pct) > 0) && (
                          <span className="block text-[11px] text-text-secondary pl-1.5">
                            {[l.recurring ? `every ${PERIOD_LABEL[l.recurring]}` : null, Number(l.discount_pct) > 0 ? `−${l.discount_pct}% discount` : null, l.hint].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                      {extras.map(c => (
                        <span key={c.key} className="pr-1.5">
                          <input aria-label={c.label} value={l.extra?.[c.key] ?? ''} disabled={contingency}
                            onChange={e => p.onPatch(el.key, { extra: { ...(l.extra ?? {}), [c.key]: e.target.value } })} className="ql-cell w-full" />
                        </span>
                      ))}
                      <NumBox label="Quantity" value={u} disabled={contingency} onCommit={v => setUnitsDays(l, Math.max(0, v ?? 0), d || null)} />
                      {cols.days && <span className="pl-1.5"><NumBox label="Days" value={d || null} disabled={contingency} onCommit={v => setUnitsDays(l, u, v)} /></span>}
                      {cols.unit && (
                        <span className="pl-1.5">
                          <input aria-label="Unit" list="ql-units" value={l.unit} disabled={contingency} maxLength={20}
                            onChange={e => p.onPatch(el.key, { unit: e.target.value })} onBlur={e => { if (!e.target.value.trim()) p.onPatch(el.key, { unit: 'each' }) }}
                            className="ql-cell w-full text-text-secondary" />
                        </span>
                      )}
                      <span className="pl-1.5"><NumBox money label={priceCol?.label ?? 'Rate'} value={l.unit_price} disabled={contingency} onCommit={v => p.onPatch(el.key, { unit_price: Math.max(0, v ?? 0) })} /></span>
                      {cols.cost && (
                        <span className="ql-team h-full flex items-center px-1">
                          <NumBox money label="Cost (team only)" value={l.unit_cost ?? null} disabled={contingency} placeholder="—"
                            onCommit={v => p.onPatch(el.key, { unit_cost: v && v > 0 ? v : null })} className="ql-team-cell" />
                        </span>
                      )}
                      {cols.margin && (
                        <span className="ql-team h-full flex items-center px-1">
                          <NumBox label="Margin % (team only)" value={mg == null ? null : Math.round(mg * 10) / 10} disabled={contingency || !(Number(l.unit_cost) > 0)} placeholder="—"
                            onCommit={v => { if (v == null) return; const pr = priceForMargin(Number(l.unit_cost) || 0, v, l.discount_pct); if (pr != null) p.onPatch(el.key, { unit_price: pr }) }}
                            className="ql-team-cell" />
                        </span>
                      )}
                      <span className="pl-1.5">
                        <NumBox money label="Total" value={Math.round(l.total * 100) / 100} disabled={contingency} onCommit={v => { if (v != null) setTotal(l, v) }}
                          className={cn('font-semibold', opt && 'font-normal text-text-secondary')} />
                      </span>
                      <span className="flex items-center justify-end gap-0.5">
                        {!contingency && (
                          <>
                            <button type="button" aria-label={`More for line ${n}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : el.key)}
                              className={cn('ql-act w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-elevated', isOpen && 'ql-on')}>
                              <span className="material-icons !text-[16px]">more_horiz</span>
                            </button>
                            <button type="button" aria-label={`Remove line ${n}`} onClick={() => remove(l)}
                              className="ql-act w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300">
                              <span className="material-icons !text-[16px]">delete_outline</span>
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                    {isOpen && (
                      <LineMore line={l} template={template} sections={p.sections} hasDays={hasDays} supply={extraNode}
                        onPatch={x => p.onPatch(el.key, x)} onAddOption={p.onAddOption && !opt && f.has('options') ? () => { p.onAddOption!(l); setOpen(null) } : undefined}
                        onClose={() => setOpen(null)} />
                    )}
                  </Fragment>
                )
              })}
            </Fragment>
          ))}

          <AddRow grid={grid} extras={extras} cols={cols} items={p.items} loading={p.itemsLoading} currency={currency} newSection={p.newSection} onAdd={p.onAdd} />
          <datalist id="ql-units">{UNITS.map(x => <option key={x} value={x} />)}</datalist>
        </div>
      </div>
      {undo && (
        <div role="status" className="flex items-center gap-3 px-3.5 py-2 border-t border-divider bg-surface-elevated text-[12.5px]">
          <span className="flex-1">Line removed: <b>{undo.line.description || 'no description'}</b></span>
          <button type="button" className="text-primary font-semibold" onClick={() => { p.onAdd(null, undo.line.qty, { ...undo.line }); setUndo(null) }}>Undo</button>
        </div>
      )}
    </div>
  )
}

/** The new line at the bottom: small boxes; the item box searches your products & stock as you type. */
function AddRow({ grid, extras, cols, items, loading, currency, newSection, onAdd }: {
  grid: string; extras: TemplateColumn[]; cols: { days: boolean; unit: boolean; cost: boolean; margin: boolean }
  items: PickItem[]; loading?: boolean; currency?: string; newSection: string | null
  onAdd: (pick: PickItem | null, qty: number, extra?: Partial<TLine>) => TLine
}) {
  const [text, setText] = useState('')
  const [pick, setPick] = useState<PickItem | null>(null)
  const [qty, setQty] = useState('')
  const [days, setDays] = useState('')
  const [unit, setUnit] = useState('')
  const [rate, setRate] = useState('')
  const [cost, setCost] = useState('')
  const [total, setTotal] = useState('')
  const [ex, setEx] = useState<Record<string, string>>({})
  const [drop, setDrop] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const itemRef = useRef<HTMLInputElement>(null)
  const place = () => { const r = itemRef.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: r.left }) }
  const list = useMemo(() => {
    const t = text.trim().toLowerCase()
    if (!t || pick) return []
    return items.filter(i => i.name.toLowerCase().includes(t) || i.detail.toLowerCase().includes(t) || (i.sku ?? '').toLowerCase().includes(t) || (i.brand ?? '').toLowerCase().includes(t)).slice(0, 8)
  }, [items, text, pick])
  const q = n2(qty) || 1
  const r = rate.trim() ? n2(rate) : pick?.price ?? 0
  const shownTotal = total.trim() ? total : (text.trim() || pick) && r ? fix2(q * r) : ''
  const c = cost.trim() ? n2(cost) : pick?.cost ?? 0
  const margin = c > 0 && r > 0 ? `${(((r - c) / r) * 100).toFixed(1)}%` : '—'

  function choose(i: PickItem) {
    setPick(i); setText(i.name); setDrop(false)
    setUnit(i.unit || 'each'); setRate(String(i.price)); if (i.cost) setCost(String(i.cost))
    const nx: Record<string, string> = {}
    if (i.sku) nx.part_no = i.sku
    if (i.brand) nx.brand = i.brand
    setEx(e => ({ ...nx, ...e }))
  }
  function reset() { setText(''); setPick(null); setQty(''); setDays(''); setUnit(''); setRate(''); setCost(''); setTotal(''); setEx({}); setDrop(false); setHi(0); itemRef.current?.focus() }
  function commit() {
    if (!text.trim() && !pick) return
    const d = cols.days ? n2(days) : 0
    const realQty = d > 0 ? Math.round(q * d * 100) / 100 : q
    let price = r
    if (total.trim() && realQty > 0) price = Math.round((n2(total) / realQty) * 100) / 100
    const extra: Record<string, string> = { ...ex }
    if (d > 0) { extra.days = String(d); extra.units = String(q) }
    onAdd(pick, realQty, {
      description: text.trim() || pick?.name || '', qty: pick?.type === 'service' && !qty.trim() ? 1 : realQty,
      unit: unit.trim() || pick?.unit || 'each', unit_price: price, unit_cost: c > 0 ? c : null, extra,
      ...(newSection ? { section: newSection } : {}),
    })
    reset()
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }

  return (
    <div className="px-3.5 py-1.5 bg-primary/[0.03] border-b border-divider">
      <div className="grid items-center" style={{ gridTemplateColumns: grid }}>
        <button type="button" aria-label="Add this line" onClick={commit}
          className="w-[22px] h-[22px] rounded-md bg-primary text-white flex items-center justify-center hover:bg-primary/90">
          <span className="material-icons !text-[15px]">add</span>
        </button>
        <span className="relative pr-2">
          <input ref={itemRef} aria-label="Item: type or search" value={text} placeholder={loading ? 'Loading your items…' : 'Type or search an item'}
            onChange={e => { setText(e.target.value); setPick(null); setDrop(true); setHi(0); place() }}
            onFocus={() => { setDrop(true); place() }} onBlur={() => window.setTimeout(() => setDrop(false), 150)}
            onKeyDown={e => {
              if (drop && list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setHi(h => (h + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length); return }
              if (e.key === 'Enter' && drop && list.length) { e.preventDefault(); choose(list[hi]); return }
              if (e.key === 'Escape') { setDrop(false); return }
              onKey(e)
            }}
            className="ql-add w-full" />
          {drop && text.trim() && !pick && pos && (
            <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-50 w-[min(420px,80vw)] max-h-[320px] overflow-y-auto rounded-[10px] border border-divider bg-surface shadow-[0_12px_28px_rgba(15,23,42,0.16)] overflow-hidden">
              {list.map((i, ix) => (
                <button key={i.key} type="button" onMouseDown={e => { e.preventDefault(); choose(i) }}
                  className={cn('w-full text-left flex items-center gap-3 px-3 py-2 border-b border-divider', ix === hi && 'bg-primary/5')}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-text-primary truncate">{i.name}</span>
                    <span className="block text-[11.5px] text-text-secondary truncate">{[i.brand, i.detail].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-[13px] font-semibold text-text-primary">{formatCurrency(i.price, currency)}</span>
                </button>
              ))}
              <button type="button" onMouseDown={e => { e.preventDefault(); setDrop(false) }}
                className="w-full text-left px-3 py-2 text-[13px] text-primary font-medium">+ Add “{text.trim()}” as your own line</button>
            </div>
          )}
        </span>
        {extras.map(cx => (
          <span key={cx.key} className="pr-1.5">
            <input aria-label={cx.label} value={ex[cx.key] ?? ''} onChange={e => setEx(x => ({ ...x, [cx.key]: e.target.value }))} onKeyDown={onKey} className="ql-add w-full" />
          </span>
        ))}
        <input aria-label="Quantity" inputMode="decimal" value={qty} placeholder="1" onChange={e => setQty(e.target.value)} onKeyDown={onKey} className="ql-add w-full text-right" />
        {cols.days && <span className="pl-1.5"><input aria-label="Days" inputMode="decimal" value={days} placeholder="—" onChange={e => setDays(e.target.value)} onKeyDown={onKey} className="ql-add w-full text-right" /></span>}
        {cols.unit && <span className="pl-1.5"><input aria-label="Unit" list="ql-units" value={unit} placeholder="each" onChange={e => setUnit(e.target.value)} onKeyDown={onKey} className="ql-add w-full" /></span>}
        <span className="pl-1.5"><input aria-label="Rate" inputMode="decimal" value={rate} placeholder="0,00" onChange={e => { setRate(e.target.value); setTotal('') }} onKeyDown={onKey} className="ql-add w-full text-right" /></span>
        {cols.cost && <span className="pl-1.5"><input aria-label="Cost (team only)" inputMode="decimal" value={cost} placeholder="0,00" onChange={e => setCost(e.target.value)} onKeyDown={onKey} className="ql-add ql-team-cell w-full text-right" /></span>}
        {cols.margin && <span className="text-right pr-2 text-[12.5px] ql-team-text">{margin}</span>}
        <span className="pl-1.5"><input aria-label="Total (type it and the rate works itself out)" inputMode="decimal" value={shownTotal} placeholder="0,00"
          onChange={e => setTotal(e.target.value)} onKeyDown={onKey} className="ql-add w-full text-right font-semibold" /></span>
        <span />
      </div>
    </div>
  )
}

/** The line's extras, in a row under it: discount, repeats, section, other fields, an option for the client. */
function LineMore({ line, template, sections, supply, onPatch, onAddOption, onClose }: {
  line: TLine; template: QuoteTemplate; sections: string[]; hasDays: boolean; supply?: ReactNode
  onPatch: (p: Partial<TLine>) => void; onAddOption?: () => void; onClose: () => void
}) {
  const f = new Set(template.features)
  const templateExtra = template.columns.filter(c => c.visible && !CORE.has(c.key)).map(c => c.key)
  const own = Object.keys(line.extra ?? {}).filter(k => !['days', 'units'].includes(k) && !templateExtra.includes(k))
  const more = EXTRA_KNOWN.filter(e => !templateExtra.includes(e.key) && !own.includes(e.key))
  const setExtra = (k: string, v: string) => onPatch({ extra: { ...(line.extra ?? {}), [k]: v } })
  const box = 'h-9 px-2.5 rounded-lg border border-divider bg-surface text-[13px] text-text-primary'
  return (
    <div className="px-3.5 py-3 border-b border-divider bg-surface-elevated/60 flex flex-wrap items-end gap-3 text-[12px] text-text-secondary">
      {supply && <div className="flex flex-col gap-1">How it’s supplied<div className="min-h-9 flex items-center">{supply}</div></div>}
      <label className="flex flex-col gap-1">Discount %
        <input type="number" inputMode="decimal" min={0} max={100} value={line.discount_pct || ''} placeholder="0" className={cn(box, 'w-24 text-right')}
          onChange={e => onPatch({ discount_pct: Math.min(100, Math.max(0, n2(e.target.value))) || null })} />
      </label>
      {f.has('recurring') && (
        <label className="flex flex-col gap-1">Repeats
          <select className={box} value={line.recurring ?? ''} onChange={e => onPatch({ recurring: (e.target.value || null) as RecurringPeriod | null })}>
            <option value="">Once-off</option><option value="week">Every week</option><option value="month">Every month</option><option value="year">Every year</option>
          </select>
        </label>
      )}
      {f.has('sections') && (
        <label className="flex flex-col gap-1">Section
          <input list="ql-sections" className={cn(box, 'w-44')} value={line.section ?? ''} placeholder="None" maxLength={80} onChange={e => onPatch({ section: e.target.value || null })} />
          <datalist id="ql-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
        </label>
      )}
      {own.map(k => (
        <label key={k} className="flex flex-col gap-1">{EXTRA_KNOWN.find(e => e.key === k)?.label ?? k}
          <input className={cn(box, k === 'note' ? 'w-72' : 'w-40')} value={line.extra?.[k] ?? ''} maxLength={120} onChange={e => setExtra(k, e.target.value)} />
        </label>
      ))}
      {more.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5 pb-1">
          {more.map(m => <button key={m.key} type="button" onClick={() => setExtra(m.key, '')} className="h-8 px-2.5 rounded-full border border-divider text-[12px] text-text-secondary hover:text-text-primary">+ {m.label}</button>)}
        </span>
      )}
      {onAddOption && (
        <button type="button" onClick={onAddOption} className="h-9 px-3 rounded-lg border border-divider bg-surface text-[13px] text-text-primary flex items-center gap-1.5">
          <span className="material-icons !text-[16px]">alt_route</span>Add an option for the client
        </button>
      )}
      <button type="button" onClick={onClose} className="ml-auto h-9 px-3 rounded-lg text-[13px] text-primary font-medium">Done</button>
    </div>
  )
}

export { engineLineTotal }
