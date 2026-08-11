'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import type { QuoteCatalogueItem } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemType = QuoteCatalogueItem['item_type']
type FilterType = 'all' | ItemType

const ITEM_TYPES: ItemType[] = ['material', 'labour', 'equipment', 'subcontractor', 'other']

const TYPE_BADGE: Record<ItemType, string> = {
  material:      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  labour:        'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  equipment:     'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  subcontractor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  other:         'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

const UNIT_OPTIONS = ['each', 'm²', 'm', 'kg', 'l', 'hrs', 'day', 'item']

const VAT_OPTIONS = [
  { label: 'Standard 15%', value: 0.15 },
  { label: 'Zero Rated',   value: 0 },
  { label: 'Exempt',       value: -1 },   // sentinel for null
]

// ─── Drawer form state ────────────────────────────────────────────────────────

type DrawerState = {
  id:            string | null
  name:          string
  code:          string
  category:      string
  item_type:     ItemType
  unit:          string
  cost_price:    string
  markup_percent: string
  sell_price:    string
  vat_rate:      string       // '0.15' | '0' | '-1'
  is_active:     boolean
  description:   string
}

const EMPTY_DRAWER: DrawerState = {
  id:             null,
  name:           '',
  code:           '',
  category:       '',
  item_type:      'material',
  unit:           'each',
  cost_price:     '',
  markup_percent: '0',
  sell_price:     '',
  vat_rate:       '0.15',
  is_active:      true,
  description:    '',
}

// ─── Pricing helpers ──────────────────────────────────────────────────────────

function calcSell(cost: number, markup: number): number {
  return cost * (1 + markup / 100)
}

function calcMarkup(cost: number, sell: number): number {
  if (cost === 0) return 0
  return ((sell - cost) / cost) * 100
}

function calcMargin(cost: number, sell: number): number {
  if (sell === 0) return 0
  return ((sell - cost) / sell) * 100
}

function toNum(s: string): number {
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

// ─── MarginBar ────────────────────────────────────────────────────────────────

function MarginBar({ cost, markup, sell }: { cost: number; markup: number; sell: number }) {
  const margin = calcMargin(cost, sell)
  return (
    <div className="rounded-lg bg-surface-elevated border border-divider p-3 text-[12px] space-y-1">
      <div className="flex items-center gap-4 flex-wrap text-text-secondary">
        <span>Cost: <strong className="text-text-primary">{fmtMoney(cost)}</strong></span>
        <span>Markup: <strong className="text-text-primary">{markup.toFixed(2)}%</strong></span>
        <span>Sell: <strong className="text-text-primary">{fmtMoney(sell)}</strong></span>
        <span>Margin: <strong className="text-green-600 dark:text-green-400">{margin.toFixed(1)}%</strong></span>
      </div>
      <p className="text-text-disabled italic">
        Markup {markup.toFixed(0)}% ≠ Margin {markup.toFixed(0)}%. Margin = profit ÷ sell price.
      </p>
    </div>
  )
}

// ─── TypeBadge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${TYPE_BADGE[type]}`}>
      {type}
    </span>
  )
}

// ─── VatLabel ─────────────────────────────────────────────────────────────────

function vatLabel(rate: number | null): string {
  if (rate == null || rate < 0) return 'Exempt'
  if (rate === 0)               return 'Zero'
  return `${(rate * 100).toFixed(0)}%`
}

// ─── INPUT_CLS ────────────────────────────────────────────────────────────────

const INPUT_CLS =
  'bg-surface border border-border text-text-primary placeholder:text-text-disabled ' +
  'rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 w-full'

// ─── Drawer ───────────────────────────────────────────────────────────────────

function CatalogueDrawer({
  open,
  form,
  categories,
  saving,
  onClose,
  onChange,
  onSave,
}: {
  open:       boolean
  form:       DrawerState
  categories: string[]
  saving:     boolean
  onClose:    () => void
  onChange:   (patch: Partial<DrawerState>) => void
  onSave:     () => void
}) {
  const cost   = toNum(form.cost_price)
  const markup = toNum(form.markup_percent)
  const sell   = toNum(form.sell_price)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-96 bg-surface shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
          <h2 className="text-[16px] font-semibold text-text-primary">
            {form.id ? 'Edit Item' : 'New Catalogue Item'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-elevated transition-colors">
            <span className="material-icons text-[20px] text-text-secondary">close</span>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Name <span className="text-red-500">*</span></label>
            <input
              className={INPUT_CLS}
              placeholder="e.g. PVC Pipe 110mm"
              value={form.name}
              onChange={e => onChange({ name: e.target.value })}
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Code</label>
            <input
              className={INPUT_CLS}
              placeholder="e.g. MAT-001"
              value={form.code}
              onChange={e => onChange({ code: e.target.value })}
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Category</label>
            <input
              className={INPUT_CLS}
              list="cat-list"
              placeholder="e.g. Plumbing"
              value={form.category}
              onChange={e => onChange({ category: e.target.value })}
            />
            <datalist id="cat-list">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>

          {/* Type */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Type</label>
            <select
              className={INPUT_CLS}
              value={form.item_type}
              onChange={e => onChange({ item_type: e.target.value as ItemType })}
            >
              {ITEM_TYPES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Unit */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Unit</label>
            <select
              className={INPUT_CLS}
              value={form.unit}
              onChange={e => onChange({ unit: e.target.value })}
            >
              {UNIT_OPTIONS.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          {/* Cost Price */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Cost Price (R)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={INPUT_CLS}
              placeholder="0.00"
              value={form.cost_price}
              onChange={e => {
                const newCost = toNum(e.target.value)
                const newSell = calcSell(newCost, toNum(form.markup_percent))
                onChange({ cost_price: e.target.value, sell_price: newSell.toFixed(2) })
              }}
            />
          </div>

          {/* Markup % */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Markup %</label>
            <input
              type="number"
              min={0}
              step="0.1"
              className={INPUT_CLS}
              placeholder="0"
              value={form.markup_percent}
              onChange={e => {
                const newMarkup = toNum(e.target.value)
                const newSell   = calcSell(toNum(form.cost_price), newMarkup)
                onChange({ markup_percent: e.target.value, sell_price: newSell.toFixed(2) })
              }}
            />
          </div>

          {/* Sell Price */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Sell Price (R)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={INPUT_CLS}
              placeholder="0.00"
              value={form.sell_price}
              onChange={e => {
                const newSell   = toNum(e.target.value)
                const newMarkup = calcMarkup(toNum(form.cost_price), newSell)
                onChange({ sell_price: e.target.value, markup_percent: newMarkup.toFixed(2) })
              }}
            />
          </div>

          {/* Margin display */}
          <MarginBar cost={cost} markup={markup} sell={sell} />

          {/* VAT Rate */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">VAT Rate</label>
            <select
              className={INPUT_CLS}
              value={form.vat_rate}
              onChange={e => onChange({ vat_rate: e.target.value })}
            >
              {VAT_OPTIONS.map(o => (
                <option key={o.value} value={String(o.value)}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Active */}
          <div className="flex items-center gap-2">
            <input
              id="is-active"
              type="checkbox"
              className="h-4 w-4 rounded border border-border accent-primary"
              checked={form.is_active}
              onChange={e => onChange({ is_active: e.target.checked })}
            />
            <label htmlFor="is-active" className="text-[14px] text-text-primary select-none">
              Active
            </label>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">Description</label>
            <textarea
              rows={3}
              className={`${INPUT_CLS} resize-none`}
              placeholder="Optional notes or spec…"
              value={form.description}
              onChange={e => onChange({ description: e.target.value })}
            />
          </div>

        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-divider flex gap-2">
          <button
            className="flex-1 btn-primary h-10 text-[14px] disabled:opacity-50"
            disabled={saving || !form.name.trim()}
            onClick={onSave}
          >
            {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Create Item'}
          </button>
          <button
            className="h-10 px-4 rounded-lg border border-border text-[14px] text-text-secondary hover:bg-surface-elevated transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingCataloguePage() {
  const [companyId,    setCompanyId]    = useState<string | null>(null)
  const [items,        setItems]        = useState<QuoteCatalogueItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [filterType,   setFilterType]   = useState<FilterType>('all')
  const [search,       setSearch]       = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [form,         setForm]         = useState<DrawerState>(EMPTY_DRAWER)
  const [saving,       setSaving]       = useState(false)
  const [archiving,    setArchiving]    = useState<string | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  // Derived: unique categories from items
  const categories = Array.from(
    new Set(items.map(i => i.category).filter(Boolean) as string[])
  ).sort()

  // ── Resolve company ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function resolve() {
      const supabase = createClient()
      const member   = await resolveCurrentMember(supabase)
      if (member) setCompanyId(member.companyId)
    }
    resolve()
  }, [])

  // ── Fetch items ──────────────────────────────────────────────────────────────
  const fetchItems = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('quote_catalogue_items')
      .select('*')
      .eq('company_id', companyId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
    if (err) {
      setError(err.message)
    } else {
      setItems((data as QuoteCatalogueItem[]) ?? [])
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { fetchItems() }, [fetchItems])

  // ── Filter ───────────────────────────────────────────────────────────────────
  const filtered = items.filter(item => {
    if (!showArchived && !item.is_active) return false
    if (filterType !== 'all' && item.item_type !== filterType) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        (item.code ?? '').toLowerCase().includes(q) ||
        (item.category ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // ── Open drawer ──────────────────────────────────────────────────────────────
  function openNew() {
    setForm(EMPTY_DRAWER)
    setDrawerOpen(true)
  }

  function openEdit(item: QuoteCatalogueItem) {
    const vatRaw = item.vat_rate
    const vatStr = vatRaw == null ? '-1' : String(vatRaw)
    setForm({
      id:             item.id,
      name:           item.name,
      code:           item.code ?? '',
      category:       item.category ?? '',
      item_type:      item.item_type,
      unit:           item.unit,
      cost_price:     String(item.cost_price),
      markup_percent: String(item.markup_percent),
      sell_price:     String(item.sell_price),
      vat_rate:       vatStr,
      is_active:      item.is_active,
      description:    item.description ?? '',
    })
    setDrawerOpen(true)
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!companyId || !form.name.trim()) return
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const vatRaw = parseFloat(form.vat_rate)
    const vatVal = vatRaw < 0 ? null : vatRaw

    const payload: Partial<QuoteCatalogueItem> & { company_id: string; updated_at: string } = {
      company_id:     companyId,
      name:           form.name.trim(),
      code:           form.code.trim() || null,
      category:       form.category.trim() || null,
      item_type:      form.item_type,
      unit:           form.unit,
      cost_price:     toNum(form.cost_price),
      markup_percent: toNum(form.markup_percent),
      sell_price:     toNum(form.sell_price),
      vat_rate:       vatVal ?? 0,
      is_active:      form.is_active,
      description:    form.description.trim() || null,
      updated_at:     new Date().toISOString(),
    }

    if (form.id) {
      const { error: err } = await supabase
        .from('quote_catalogue_items')
        .update(payload)
        .eq('id', form.id)
        .eq('company_id', companyId)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase
        .from('quote_catalogue_items')
        .insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    setDrawerOpen(false)
    fetchItems()
  }

  // ── Archive ──────────────────────────────────────────────────────────────────
  async function handleArchive(item: QuoteCatalogueItem) {
    if (!companyId) return
    setArchiving(item.id)
    const supabase = createClient()
    await supabase
      .from('quote_catalogue_items')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('company_id', companyId)
    setArchiving(null)
    fetchItems()
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Pricing Catalogue</h1>
        <button className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1.5" onClick={openNew}>
          <span className="material-icons text-[16px]">add</span>
          New Item
        </button>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2.5 border-b border-divider bg-surface shrink-0 space-y-2">
        {/* Type chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(['all', ...ITEM_TYPES] as FilterType[]).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className="h-[30px] px-3 rounded-full text-[11px] font-semibold shrink-0 border transition-colors"
              style={
                filterType === t
                  ? { background: 'var(--color-primary, #1E3A5F)', color: '#fff', borderColor: 'transparent' }
                  : { background: 'var(--color-surface-elevated)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-divider)' }
              }
            >
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Search + archived toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-disabled">
              search
            </span>
            <input
              className={`${INPUT_CLS} pl-8`}
              placeholder="Search name, code or category…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary cursor-pointer whitespace-nowrap select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border accent-primary"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-[14px] text-text-secondary">Loading catalogue…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="material-icons text-[40px] text-text-disabled">receipt_long</span>
            <p className="text-[14px] text-text-secondary font-semibold">
              {items.length === 0 ? 'No catalogue items yet' : 'No items match your filters'}
            </p>
            {items.length === 0 && (
              <button className="btn-primary h-9 px-4 text-[13px] mt-2" onClick={openNew}>
                Add first item
              </button>
            )}
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated">
                <th className="data-th text-left whitespace-nowrap">Code</th>
                <th className="data-th text-left">Name</th>
                <th className="data-th text-left whitespace-nowrap">Category</th>
                <th className="data-th text-left whitespace-nowrap">Type</th>
                <th className="data-th text-left whitespace-nowrap">Unit</th>
                <th className="data-th text-right whitespace-nowrap">Cost</th>
                <th className="data-th text-right whitespace-nowrap">Markup %</th>
                <th className="data-th text-right whitespace-nowrap">Sell Price</th>
                <th className="data-th text-right whitespace-nowrap">VAT</th>
                <th className="data-th text-center whitespace-nowrap">Status</th>
                <th className="data-th text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr
                  key={item.id}
                  className={`bg-surface border-b border-divider last:border-0 hover:bg-surface-elevated transition-colors ${
                    !item.is_active ? 'opacity-50' : ''
                  }`}
                >
                  <td className="data-td text-[12px] text-text-disabled font-mono whitespace-nowrap">
                    {item.code ?? '—'}
                  </td>
                  <td className="data-td text-[13px] text-text-primary font-medium">
                    {item.name}
                    {item.description && (
                      <p className="text-[11px] text-text-disabled font-normal truncate max-w-[200px]">
                        {item.description}
                      </p>
                    )}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary whitespace-nowrap">
                    {item.category ?? '—'}
                  </td>
                  <td className="data-td whitespace-nowrap">
                    <TypeBadge type={item.item_type} />
                  </td>
                  <td className="data-td text-[13px] text-text-secondary whitespace-nowrap">
                    {item.unit}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary text-right whitespace-nowrap">
                    {fmtMoney(item.cost_price)}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary text-right whitespace-nowrap">
                    {item.markup_percent.toFixed(1)}%
                  </td>
                  <td className="data-td text-[13px] text-text-primary font-semibold text-right whitespace-nowrap">
                    {fmtMoney(item.sell_price)}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary text-right whitespace-nowrap">
                    {vatLabel(item.vat_rate)}
                  </td>
                  <td className="data-td text-center whitespace-nowrap">
                    {item.is_active ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="data-td text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        title="Edit"
                        onClick={() => openEdit(item)}
                        className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <span className="material-icons text-[16px]">edit</span>
                      </button>
                      {item.is_active && (
                        <button
                          title="Archive"
                          disabled={archiving === item.id}
                          onClick={() => handleArchive(item)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-text-disabled hover:text-red-500 transition-colors disabled:opacity-50"
                        >
                          <span className="material-icons text-[16px]">
                            {archiving === item.id ? 'hourglass_empty' : 'delete'}
                          </span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer count */}
      {!loading && filtered.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-divider bg-surface">
          <p className="text-[11px] text-text-disabled">
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
            {filterType !== 'all' || search ? ` (filtered from ${items.length})` : ''}
          </p>
        </div>
      )}

      {/* Drawer */}
      <CatalogueDrawer
        open={drawerOpen}
        form={form}
        categories={categories}
        saving={saving}
        onClose={() => setDrawerOpen(false)}
        onChange={patch => setForm(prev => ({ ...prev, ...patch }))}
        onSave={handleSave}
      />
    </div>
  )
}
