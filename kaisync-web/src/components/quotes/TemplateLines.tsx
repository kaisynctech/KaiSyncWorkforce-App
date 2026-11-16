'use client'

/**
 * The lines of a quotation made from a template (piece 7, boards C–F and the phone board).
 * Phone first: each line is a card; "Add a line" opens a sheet to search your products & stock and set the
 * quantity with big + / − buttons; tapping a line opens it with only the fields its template uses ("+ more" adds
 * one for that line). On a bigger screen the same lines show as a table in the template's columns.
 * Cost and margin are for the team only: shown here with a lock, never printed or shown to the client.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/currencies'
import { priceForMargin, type PickItem } from '@/lib/line-items'
import {
  engineLineTotal, orderedForDisplay, PERIOD_LABEL, sectionTotal, type EngineLine, type RecurringPeriod,
} from '@/lib/quote-engine'
import type { QuoteTemplate, TemplateColumn } from '@/lib/quote-templates'

/** The line fields this component works with (a SimpleQuoteLine has all of these). */
export type TLine = {
  id: string | null
  tempId: string
  description: string
  qty: number
  unit: string
  unit_price: number
  total: number
  item_type: 'service' | 'catalogue' | 'inventory' | 'custom'
  source_id: string | null
  hint?: string | null
  unit_cost?: number | null
  discount_pct?: number | null
  section?: string | null
  extra?: Record<string, string>
  option_of?: string | null
  recurring?: RecurringPeriod | null
  is_contingency?: boolean
}

/** Columns that are part of every line (not extra fields). */
const CORE = new Set(['item', 'qty', 'price', 'rate', 'total', 'cost', 'margin', 'unit', 'days'])
const EXTRA_KNOWN: { key: string; label: string }[] = [
  { key: 'part_no', label: 'Part no.' }, { key: 'brand', label: 'Brand' }, { key: 'condition', label: 'Condition' },
  { key: 'warranty', label: 'Warranty' }, { key: 'note', label: 'Note' },
]
const CONDITIONS = ['New', 'Used', 'Remanufactured', 'Aftermarket']
const KIND_LABEL: Record<string, string> = {
  part: 'Products', material: 'Materials', service: 'Services', labour: 'Labour', package: 'Packages', fee: 'Fees', hire: 'Hire',
}

export function engineOf(l: TLine): EngineLine {
  return {
    key: l.id ?? l.tempId, description: l.description, qty: l.qty, unitPrice: l.unit_price, discountPct: l.discount_pct ?? null,
    unitCost: l.unit_cost ?? null, section: l.section ?? null, optionOf: l.option_of ?? null, recurring: l.recurring ?? null,
    isContingency: !!l.is_contingency,
  }
}

function money(n: number, currency?: string) { return formatCurrency(n, currency) }
const n2 = (v: string) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : 0 }

export function TemplateLines({
  template, lines, items, itemsLoading, currency, readOnly, team = true, onChange, makeLine, lineExtra,
  contingencyPct, onContingency,
}: {
  template: QuoteTemplate
  lines: TLine[]
  items: PickItem[]
  itemsLoading?: boolean
  currency?: string
  readOnly?: boolean
  /** Show cost and margin (the quotation screen is office only, so on by default). */
  team?: boolean
  onChange: (next: TLine[]) => void
  /** A new line, from a picked item or blank. */
  makeLine: (pick: PickItem | null, qty: number) => TLine
  lineExtra?: (l: TLine) => ReactNode
  contingencyPct: number
  onContingency: (pct: number) => void
}) {
  const f = new Set(template.features)
  const showCost = team && (f.has('cost_margin') || template.columns.some(c => c.key === 'cost' && c.visible))
  const hasDays = template.columns.some(c => c.key === 'days' && c.visible)
  const cols = template.columns.filter(c => c.visible && (team || !c.team_only))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [newSection, setNewSection] = useState<string | null>(null)

  const keyOf = (l: TLine) => l.id ?? l.tempId
  // Without sections in the template, lines show as one list (any section names are kept for later).
  const useSections = f.has('sections')
  const groups = useMemo(() => orderedForDisplay(lines.map(l => ({ ...engineOf(l), section: useSections ? l.section ?? null : null, line: l }))), [lines, useSections])
  const sections = useMemo(() => [...new Set(lines.map(l => l.section?.trim()).filter((s): s is string => !!s))], [lines])
  const editLine = lines.find(l => keyOf(l) === editing) ?? null

  function patch(key: string, p: Partial<TLine>) {
    onChange(lines.map(l => {
      if (keyOf(l) !== key) return l
      const m = { ...l, ...p }
      m.total = engineLineTotal({ qty: m.qty, unitPrice: m.unit_price, discountPct: m.discount_pct })
      return m
    }))
  }
  function remove(key: string) {
    onChange(lines.filter(l => keyOf(l) !== key && l.option_of !== key))
    setEditing(null)
  }
  function add(pick: PickItem | null, qty: number, extra?: Partial<TLine>) {
    const l = { ...makeLine(pick, qty), ...extra }
    if (newSection) l.section = newSection
    l.total = engineLineTotal({ qty: l.qty, unitPrice: l.unit_price, discountPct: l.discount_pct })
    // New lines go before the contingency line.
    const at = lines.findIndex(x => x.is_contingency)
    onChange(at < 0 ? [...lines, l] : [...lines.slice(0, at), l, ...lines.slice(at)])
    return l
  }
  function addOption(main: TLine) {
    const l = add(null, main.qty, {
      description: `${main.description} (option)`, unit: main.unit, unit_price: main.unit_price, section: main.section ?? null,
      option_of: keyOf(main), extra: { ...(main.extra ?? {}) },
    })
    setEditing(keyOf(l))
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 && (
        <div className="rounded-xl border border-dashed border-divider px-4 py-6 text-center">
          <p className="text-[14px] text-text-primary font-medium">Nothing on this quotation yet</p>
          <p className="text-[12.5px] text-text-secondary mt-0.5">Add from your products & stock, or write your own line.</p>
        </div>
      )}

      {groups.map(g => (
        <section key={g.section ?? '__none'} className="flex flex-col gap-2">
          {g.section && (
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <h3 className="text-[13px] font-semibold text-text-primary uppercase tracking-wide truncate">{g.section}</h3>
              <span className="text-[13px] font-semibold text-text-primary shrink-0">{money(sectionTotal(g.lines), currency)}</span>
            </div>
          )}

          {/* Phone: cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {g.lines.map(el => {
              const l = el.line
              return (
                <li key={el.key}>
                  <LineCard l={l} cols={cols} currency={currency} showCost={showCost} hasDays={hasDays}
                    onOpen={readOnly || l.is_contingency ? undefined : () => setEditing(el.key)} extra={lineExtra?.(l)} />
                </li>
              )
            })}
          </ul>

          {/* Bigger screens: the template's columns */}
          <div className="hidden md:block rounded-xl border border-divider overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-elevated text-[11px] uppercase tracking-wide text-text-secondary">
                <tr>
                  {cols.map(c => (
                    <th key={c.key} className={cn('px-3 py-2 font-medium whitespace-nowrap', c.key === 'item' ? 'text-left' : isNumCol(c.key) ? 'text-right' : 'text-left')}>
                      {c.label}{c.team_only && <span className="material-icons !text-[12px] align-[-2px] ml-0.5" title="Team only">lock</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.lines.map(el => {
                  const l = el.line
                  const isOpt = !!l.option_of
                  return (
                    <tr key={el.key} onClick={readOnly || l.is_contingency ? undefined : () => setEditing(el.key)}
                      className={cn('border-t border-divider', !readOnly && !l.is_contingency && 'cursor-pointer hover:bg-surface-elevated', isOpt && 'bg-sky-50/40')}>
                      {cols.map(c => (
                        <td key={c.key} className={cn('px-3 py-2 align-top', isNumCol(c.key) ? 'text-right whitespace-nowrap' : '', c.team_only && 'text-text-secondary')}>
                          {c.key === 'item' ? (
                            <div className={cn('min-w-[180px]', isOpt && 'pl-4')}>
                              {isOpt && <span className="text-[10.5px] font-semibold text-sky-700 uppercase tracking-wide block">Option for the client · not in total</span>}
                              <span className="text-text-primary">{l.description || <i className="text-text-secondary">No description</i>}</span>
                              {l.recurring && <span className="ml-1 text-[11px] text-emerald-700">/ {PERIOD_LABEL[l.recurring]}</span>}
                              {l.hint && <span className="ml-1 text-[11px] text-text-secondary">{l.hint}</span>}
                              {lineExtra?.(l) && <div className="mt-1" onClick={e => e.stopPropagation()}>{lineExtra(l)}</div>}
                            </div>
                          ) : cellText(c, l, currency, hasDays)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAdding(true)} className="btn-primary h-11 px-4 text-[14px] flex-1 sm:flex-none">
            <span className="material-icons text-[18px] mr-1">add</span>Add a line
          </button>
          <button type="button" onClick={() => { const l = add(null, 1); setEditing(keyOf(l)) }} className="btn-outlined h-11 px-4 text-[14px]">
            Own line
          </button>
          {f.has('sections') && (
            <SectionButton sections={sections} current={newSection} onPick={setNewSection} />
          )}
        </div>
      )}
      {f.has('sections') && newSection && !readOnly && (
        <p className="text-[12px] text-text-secondary -mt-1">New lines go into <b>{newSection}</b>. <button type="button" className="text-primary" onClick={() => setNewSection(null)}>Stop</button></p>
      )}

      {f.has('contingency') && !readOnly && (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-divider px-3 py-2 min-h-[48px]">
          <span className="text-[13.5px] text-text-primary">Contingency %</span>
          <input type="number" inputMode="decimal" min={0} max={100} value={contingencyPct || ''} placeholder="0"
            onChange={e => onContingency(Math.min(100, Math.max(0, n2(e.target.value))))}
            className="w-24 h-10 px-2 text-right bg-background border border-border rounded-lg text-[14px]" />
        </label>
      )}

      {adding && (
        <AddSheet items={items} loading={itemsLoading} currency={currency} template={template}
          onClose={() => setAdding(false)}
          onAdd={(p, q) => { add(p, q); setAdding(false) }}
          onOwn={text => { const l = add(null, 1, { description: text }); setAdding(false); setEditing(keyOf(l)) }} />
      )}

      {editLine && (
        <EditSheet line={editLine} template={template} currency={currency} showCost={showCost} hasDays={hasDays}
          sections={sections} main={editLine.option_of ? lines.find(l => keyOf(l) === editLine.option_of) ?? null : null}
          onPatch={p => patch(keyOf(editLine), p)}
          onRemove={() => remove(keyOf(editLine))}
          onAddOption={f.has('options') && !editLine.option_of ? () => addOption(editLine) : undefined}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function isNumCol(k: string) { return ['qty', 'days', 'price', 'rate', 'total', 'cost', 'margin'].includes(k) }

function unitsAndDays(l: TLine, hasDays: boolean): { units: number; days: number | null } {
  const days = hasDays ? Number(l.extra?.days) || null : null
  return { units: days ? Math.round((l.qty / days) * 100) / 100 : l.qty, days }
}

function cellText(c: TemplateColumn, l: TLine, currency: string | undefined, hasDays: boolean): ReactNode {
  const { units, days } = unitsAndDays(l, hasDays)
  switch (c.key) {
    case 'qty': return units.toLocaleString('en-ZA')
    case 'days': return days ?? '—'
    case 'unit': return l.unit || 'each'
    case 'price': case 'rate': return (
      <>{money(l.unit_price, currency)}{Number(l.discount_pct) > 0 && <span className="block text-[11px] text-emerald-700">−{l.discount_pct}%</span>}</>
    )
    case 'total': return <b className={cn(l.option_of && 'font-normal text-text-secondary')}>{money(l.total, currency)}</b>
    case 'cost': return Number(l.unit_cost) > 0 ? money(Number(l.unit_cost), currency) : '—'
    case 'margin': {
      const net = l.qty > 0 ? l.total / l.qty : 0
      const cost = Number(l.unit_cost) || 0
      return cost > 0 && net > 0 ? `${(((net - cost) / net) * 100).toFixed(1)}%` : '—'
    }
    default: return l.extra?.[c.key] || '—'
  }
}

function LineCard({ l, cols, currency, showCost, hasDays, onOpen, extra }: {
  l: TLine; cols: TemplateColumn[]; currency?: string; showCost: boolean; hasDays: boolean; onOpen?: () => void; extra?: ReactNode
}) {
  const { units, days } = unitsAndDays(l, hasDays)
  const details = cols.filter(c => !CORE.has(c.key) && l.extra?.[c.key]).map(c => l.extra![c.key])
  const cost = Number(l.unit_cost) || 0
  const net = l.qty > 0 ? l.total / l.qty : 0
  const Tag = onOpen ? 'button' : 'div'
  return (
    <div className={cn('rounded-xl border bg-surface-card', l.option_of ? 'border-sky-200 bg-sky-50/40 ml-4' : 'border-divider')}>
      <Tag type={onOpen ? 'button' : undefined} onClick={onOpen} className="w-full text-left px-3.5 py-3 flex items-start gap-3 min-h-[56px]">
        <span className="flex-1 min-w-0">
          {l.option_of && <span className="block text-[10.5px] font-semibold text-sky-700 uppercase tracking-wide">Option for the client · not in total</span>}
          <span className="block text-[14.5px] font-medium text-text-primary">{l.description || <i className="text-text-secondary">Tap to describe</i>}</span>
          {details.length > 0 && <span className="block text-[12px] text-text-secondary truncate">{details.join(' · ')}</span>}
          <span className="block text-[12.5px] text-text-secondary">
            {units.toLocaleString('en-ZA')}{days ? ` × ${days} days` : ''} × {money(l.unit_price, currency)}
            {Number(l.discount_pct) > 0 && <span className="text-emerald-700"> · −{l.discount_pct}%</span>}
            {l.recurring && <span className="text-emerald-700"> · every {PERIOD_LABEL[l.recurring]}</span>}
            {l.hint && <span> · {l.hint}</span>}
          </span>
          {showCost && cost > 0 && (
            <span className="block text-[11.5px] text-text-secondary">
              <span className="material-icons !text-[12px] align-[-2px]">lock</span> Cost {money(cost, currency)}
              {net > 0 && ` · margin ${(((net - cost) / net) * 100).toFixed(1)}%`}
            </span>
          )}
        </span>
        <span className={cn('text-[15px] font-semibold shrink-0', l.option_of ? 'text-text-secondary' : 'text-text-primary')}>{money(l.total, currency)}</span>
      </Tag>
      {extra && <div className="px-3.5 pb-2.5 -mt-1">{extra}</div>}
    </div>
  )
}

function SectionButton({ sections, current, onPick }: { sections: string[]; current: string | null; onPick: (s: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="btn-outlined h-11 px-4 text-[14px]">
        <span className="material-icons text-[18px] mr-1">segment</span>Section
      </button>
      {open && (
        <div className="absolute z-30 bottom-full mb-2 left-0 w-72 max-w-[85vw] rounded-xl border border-divider bg-surface shadow-xl p-3 flex flex-col gap-2">
          <p className="text-[12px] text-text-secondary">New lines go into the section you pick.</p>
          {sections.map(s => (
            <button key={s} type="button" onClick={() => { onPick(s); setOpen(false) }}
              className={cn('h-10 px-3 rounded-lg text-left text-[13.5px] border', s === current ? 'border-primary text-primary' : 'border-divider')}>{s}</button>
          ))}
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder={`Phase ${sections.length + 1} · …`} maxLength={80}
              className="flex-1 min-w-0 h-10 px-2 bg-background border border-border rounded-lg text-[13.5px]" />
            <button type="button" disabled={!name.trim()} onClick={() => { onPick(name.trim()); setName(''); setOpen(false) }} className="btn-primary h-10 px-3 text-[13px]">Start</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-background w-full sm:max-w-lg max-h-[92vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <header className="flex items-center gap-2 px-3 h-14 border-b border-divider shrink-0">
          <h2 className="flex-1 text-[16px] font-semibold text-text-primary truncate pl-1">{title}</h2>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="border-t border-divider px-4 py-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(Math.max(0, Math.round((value - 1) * 100) / 100))}
        className="w-12 h-12 rounded-xl border border-divider text-[22px] font-semibold flex items-center justify-center">−</button>
      <input type="number" inputMode="decimal" value={value} onChange={e => onChange(Math.max(0, n2(e.target.value)))}
        className="w-20 h-12 text-center bg-background border border-border rounded-xl text-[17px] font-semibold" aria-label={label} />
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(Math.round((value + 1) * 100) / 100)}
        className="w-12 h-12 rounded-xl border border-divider text-[22px] font-semibold flex items-center justify-center">+</button>
    </div>
  )
}

function AddSheet({ items, loading, currency, template, onClose, onAdd, onOwn }: {
  items: PickItem[]; loading?: boolean; currency?: string; template: QuoteTemplate
  onClose: () => void; onAdd: (p: PickItem, qty: number) => void; onOwn: (text: string) => void
}) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<string>('all')
  const [picked, setPicked] = useState<PickItem | null>(null)
  const [qty, setQty] = useState(1)
  const kinds = useMemo(() => [...new Set(items.map(i => i.kind || 'part'))].filter(k => KIND_LABEL[k]), [items])
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return items.filter(i => (kind === 'all' || (i.kind || 'part') === kind)
      && (!t || i.name.toLowerCase().includes(t) || i.detail.toLowerCase().includes(t) || (i.sku ?? '').toLowerCase().includes(t) || (i.brand ?? '').toLowerCase().includes(t)))
      .slice(0, 60)
  }, [items, q, kind])

  if (picked) {
    return (
      <Sheet title="Add a line" onClose={onClose}
        footer={<button type="button" onClick={() => onAdd(picked, qty)} className="btn-primary w-full h-12 text-[15px]">Add · {money(Math.round(qty * picked.price * 100) / 100, currency)}</button>}>
        <button type="button" onClick={() => setPicked(null)} className="text-[13px] text-primary mb-3"><span className="material-icons text-[16px] align-[-3px]">arrow_back</span> Back to the list</button>
        <p className="text-[16px] font-semibold text-text-primary">{picked.name}</p>
        <p className="text-[12.5px] text-text-secondary mb-4">{[picked.detail, `${money(picked.price, currency)} ${picked.unit && picked.unit !== 'each' ? `per ${picked.unit}` : 'each'}`].filter(Boolean).join(' · ')}</p>
        <p className="text-[12px] font-medium text-text-secondary mb-1.5">Quantity</p>
        <Stepper value={qty} onChange={setQty} label="quantity" />
      </Sheet>
    )
  }

  return (
    <Sheet title={`Add a line · ${template.name}`} onClose={onClose}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search your products & stock"
        className="w-full h-12 px-3 bg-background border border-border rounded-xl text-[15px] mb-2" />
      {kinds.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {['all', ...kinds].map(k => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cn('h-9 px-3 rounded-full border text-[13px] whitespace-nowrap', kind === k ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-divider text-text-secondary')}>
              {k === 'all' ? 'All' : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {q.trim() && (
        <button type="button" onClick={() => onOwn(q.trim())} className="w-full text-left rounded-xl border border-dashed border-divider px-3 py-3 mb-2 min-h-[52px]">
          <span className="block text-[14px] text-text-primary">Write your own: “{q.trim()}”</span>
          <span className="block text-[12px] text-text-secondary">Not in your list. You set the price.</span>
        </button>
      )}
      {loading ? <p className="text-[13px] text-text-secondary py-4">Loading your items…</p>
        : list.length === 0 ? <p className="text-[13px] text-text-secondary py-4">Nothing found. {q.trim() ? 'Write your own line above.' : 'Add items in Products & stock.'}</p>
        : (
          <ul className="flex flex-col divide-y divide-divider">
            {list.map(i => (
              <li key={i.key}>
                <button type="button" onClick={() => { setPicked(i); setQty(1) }} className="w-full text-left flex items-center gap-3 py-3 min-h-[56px]">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] text-text-primary truncate">{i.name}</span>
                    <span className="block text-[12px] text-text-secondary truncate">{[i.brand, i.detail].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-[14px] font-semibold text-text-primary shrink-0">{money(i.price, currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Sheet>
  )
}

function EditSheet({ line, template, currency, showCost, hasDays, sections, main, onPatch, onRemove, onAddOption, onClose }: {
  line: TLine; template: QuoteTemplate; currency?: string; showCost: boolean; hasDays: boolean; sections: string[]
  main: TLine | null
  onPatch: (p: Partial<TLine>) => void; onRemove: () => void; onAddOption?: () => void; onClose: () => void
}) {
  const f = new Set(template.features)
  const { units, days } = unitsAndDays(line, hasDays)
  const templateExtra = template.columns.filter(c => c.visible && !CORE.has(c.key))
  const shownKeys = new Set([...templateExtra.map(c => c.key), ...Object.keys(line.extra ?? {}).filter(k => k !== 'days' && k !== 'units')])
  const moreChoices = EXTRA_KNOWN.filter(e => !shownKeys.has(e.key))
  const extraFields = [
    ...templateExtra.map(c => ({ key: c.key, label: c.label })),
    ...[...shownKeys].filter(k => !templateExtra.some(c => c.key === k)).map(k => ({ key: k, label: EXTRA_KNOWN.find(e => e.key === k)?.label ?? k })),
  ]
  const priceLabel = template.columns.find(c => (c.key === 'rate' || c.key === 'price') && c.visible)?.label ?? 'Price'
  const setExtra = (k: string, v: string) => onPatch({ extra: { ...(line.extra ?? {}), [k]: v } })
  const setUnitsDays = (u: number, d: number | null) => {
    if (!hasDays) return onPatch({ qty: u })
    const e = { ...(line.extra ?? {}) }
    if (d && d > 0) { e.days = String(d); e.units = String(u) } else { delete e.days; delete e.units }
    onPatch({ qty: d && d > 0 ? Math.round(u * d * 100) / 100 : u, extra: e })
  }
  const cost = Number(line.unit_cost) || 0
  const net = line.qty > 0 ? line.total / line.qty : 0
  const margin = cost > 0 && net > 0 ? ((net - cost) / net) * 100 : null
  const input = 'w-full h-11 px-3 bg-background border border-border rounded-lg text-[15px]'

  return (
    <Sheet title={line.option_of ? 'Option for the client' : 'Line'} onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" onClick={onRemove} className="h-12 px-3 rounded-xl text-danger text-[14px] hover:bg-danger/10">
            <span className="material-icons text-[20px] align-[-5px]">delete</span> Remove
          </button>
          <span className="flex-1 text-right text-[15px] font-semibold text-text-primary">{money(line.total, currency)}</span>
          <button type="button" onClick={onClose} className="btn-primary h-12 px-5 text-[15px]">Done</button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        {main && <p className="text-[12.5px] text-sky-800 bg-sky-50 rounded-lg px-3 py-2">Instead of: <b>{main.description}</b>. Shown to the client as a choice; not counted in the total.</p>}
        <label className="text-[12px] font-medium text-text-secondary">What is it?
          <textarea rows={2} value={line.description} onChange={e => onPatch({ description: e.target.value })}
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-lg text-[15px]" />
        </label>

        <div>
          <p className="text-[12px] font-medium text-text-secondary mb-1.5">Quantity</p>
          <Stepper value={units} onChange={v => setUnitsDays(v, days)} label="quantity" />
        </div>
        {hasDays && (
          <div>
            <p className="text-[12px] font-medium text-text-secondary mb-1.5">Days</p>
            <Stepper value={days ?? 0} onChange={v => setUnitsDays(units, v || null)} label="days" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium text-text-secondary">{priceLabel}
            <input type="number" inputMode="decimal" className={`${input} mt-1`} value={line.unit_price || ''}
              onChange={e => onPatch({ unit_price: n2(e.target.value) })} />
          </label>
          <label className="text-[12px] font-medium text-text-secondary">Unit
            <input className={`${input} mt-1`} value={line.unit} maxLength={20} onChange={e => onPatch({ unit: e.target.value || 'each' })} />
          </label>
          <label className="text-[12px] font-medium text-text-secondary">Discount %
            <input type="number" inputMode="decimal" min={0} max={100} className={`${input} mt-1`} value={line.discount_pct || ''} placeholder="0"
              onChange={e => onPatch({ discount_pct: Math.min(100, Math.max(0, n2(e.target.value))) || null })} />
          </label>
          {f.has('recurring') && (
            <label className="text-[12px] font-medium text-text-secondary">Repeats
              <select className={`${input} mt-1`} value={line.recurring ?? ''} onChange={e => onPatch({ recurring: (e.target.value || null) as RecurringPeriod | null })}>
                <option value="">Once-off</option>
                <option value="week">Every week</option>
                <option value="month">Every month</option>
                <option value="year">Every year</option>
              </select>
            </label>
          )}
        </div>

        {extraFields.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {extraFields.map(e => (
              <label key={e.key} className={cn('text-[12px] font-medium text-text-secondary', e.key === 'note' && 'col-span-2')}>{e.label}
                {e.key === 'condition' ? (
                  <select className={`${input} mt-1`} value={line.extra?.condition ?? ''} onChange={ev => setExtra('condition', ev.target.value)}>
                    <option value="">—</option>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input className={`${input} mt-1`} value={line.extra?.[e.key] ?? ''} maxLength={120} onChange={ev => setExtra(e.key, ev.target.value)} />
                )}
              </label>
            ))}
          </div>
        )}
        {moreChoices.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-text-secondary">+ more:</span>
            {moreChoices.map(m => (
              <button key={m.key} type="button" onClick={() => setExtra(m.key, '')} className="h-9 px-3 rounded-full border border-divider text-[13px] text-text-secondary">+ {m.label}</button>
            ))}
          </div>
        )}

        {f.has('sections') && (
          <label className="text-[12px] font-medium text-text-secondary">Section / phase
            <input list="tl-sections" className={`${input} mt-1`} value={line.section ?? ''} placeholder="None" maxLength={80}
              onChange={e => onPatch({ section: e.target.value || null })} />
            <datalist id="tl-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
          </label>
        )}

        {showCost && (
          <div className="rounded-xl bg-surface-elevated px-3 py-3 flex flex-col gap-2">
            <p className="text-[12px] text-text-secondary"><span className="material-icons !text-[14px] align-[-3px]">lock</span> Team only: never printed or shown to the client</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] font-medium text-text-secondary">Cost (each)
                <input type="number" inputMode="decimal" className={`${input} mt-1`} value={line.unit_cost || ''}
                  onChange={e => onPatch({ unit_cost: n2(e.target.value) || null })} />
              </label>
              <label className="text-[12px] font-medium text-text-secondary">Margin %
                <input type="number" inputMode="decimal" className={`${input} mt-1`} key={`m-${line.unit_cost}`} defaultValue={margin != null ? margin.toFixed(1) : ''}
                  disabled={!(cost > 0)} placeholder={cost > 0 ? '' : 'Add a cost'}
                  onBlur={e => { const p = priceForMargin(cost, n2(e.target.value), line.discount_pct); if (p != null) onPatch({ unit_price: p }) }} />
              </label>
            </div>
            {cost > 0 && (
              <div className="flex flex-wrap gap-2">
                {[15, 20, 25, 30].map(m => (
                  <button key={m} type="button" onClick={() => { const p = priceForMargin(cost, m, line.discount_pct); if (p != null) onPatch({ unit_price: p }) }}
                    className="h-9 px-3 rounded-full border border-divider text-[13px]">{m}%</button>
                ))}
              </div>
            )}
          </div>
        )}

        {onAddOption && (
          <button type="button" onClick={onAddOption} className="btn-outlined h-11 px-4 text-[14px] self-start">
            <span className="material-icons text-[18px] mr-1">alt_route</span>Add an option for the client
          </button>
        )}
      </div>
    </Sheet>
  )
}
