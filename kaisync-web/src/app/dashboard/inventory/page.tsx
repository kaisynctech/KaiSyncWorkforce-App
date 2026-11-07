'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getUnitLabel } from '@/lib/units'
import ItemFormDrawer from '@/components/inventory/ItemFormDrawer'
import StockAdjustmentModal from '@/components/inventory/StockAdjustmentModal'
import type { CatalogueCondition, CatalogueItem, ItemType } from '@/types/inventory'
import {
  StatusFilterTabs,
  MONEY_TH,
  MONEY_TD,
  TAB_ALL,
  type StatusTabDef,
} from '@/components/ui/StatusFilterTabs'
import {
  TextHeaderFilter,
  MoneyHeaderFilter,
  ResetFiltersButton,
  matchText,
  matchMoney,
  statusTab,
} from '@/components/ui/MoneyListFilters'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'parts' | 'services' | 'materials' | 'labour' | 'brands' | 'conditions'

const TYPE_BY_TAB: Partial<Record<Tab, ItemType>> = {
  parts: 'part',
  services: 'service',
  materials: 'material',
  labour: 'labour',
}

const TYPE_TABS: StatusTabDef[] = [
  TAB_ALL,
  statusTab('parts', 'Parts', ['part'], 'blue'),
  statusTab('services', 'Services', ['service'], 'purple'),
  statusTab('materials', 'Materials', ['material'], 'green'),
  statusTab('labour', 'Labour', ['labour'], 'amber'),
]

type ColFilters = {
  name: string
  sku: string
  brand: string
  condition: string
  costMin: string
  costMax: string
  sellMin: string
  sellMax: string
}

const EMPTY_COLS: ColFilters = {
  name: '',
  sku: '',
  brand: '',
  condition: '',
  costMin: '',
  costMax: '',
  sellMin: '',
  sellMax: '',
}

function colsActive(c: ColFilters) {
  return !!(c.name || c.sku || c.brand || c.condition || c.costMin || c.costMax || c.sellMin || c.sellMax)
}

type DrawerMode = 'create' | 'edit' | 'duplicate'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtQty(n: number | null | undefined) {
  if (n == null) return '—'
  return n % 1 === 0 ? String(n) : n.toFixed(3)
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${n.toFixed(1)}%`
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [items, setItems]           = useState<CatalogueItem[]>([])
  const [conditions, setConditions] = useState<CatalogueCondition[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<Tab>('all')

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search,      setSearch]      = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all')
  const [showInactive,setShowInactive]= useState(false)
  const [cols, setCols] = useState<ColFilters>(EMPTY_COLS)
  const patchCols = (patch: Partial<ColFilters>) => setCols(c => ({ ...c, ...patch }))

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen]   = useState(false)
  const [drawerMode, setDrawerMode]   = useState<DrawerMode>('create')
  const [drawerItem, setDrawerItem]   = useState<CatalogueItem | undefined>(undefined)

  // ── Adjust stock modal ─────────────────────────────────────────────────────
  const [adjustingItem,   setAdjustingItem]   = useState<CatalogueItem | null>(null)
  const [showAdjustModal, setShowAdjustModal] = useState(false)

  // ── Conditions tab ─────────────────────────────────────────────────────────
  const [newCondName, setNewCondName] = useState('')
  const [condSaving,  setCondSaving]  = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member?.companyId) return
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const [itemsRes, condRes] = await Promise.all([
      supabase
        .from('quote_catalogue_items')
        .select(`
          *,
          condition:catalogue_conditions(id, name, is_standard, sort_order, is_active, company_id),
          aliases:catalogue_item_aliases(*),
          suppliers:catalogue_item_suppliers(
            *,
            supplier:contractors(id, name)
          )
        `)
        .eq('company_id', member.companyId)
        .order('name'),
      supabase
        .from('catalogue_conditions')
        .select('*')
        .or(`company_id.is.null,company_id.eq.${member.companyId}`)
        .eq('is_active', true)
        .order('sort_order'),
    ])

    const rawItems = (itemsRes.data ?? []) as CatalogueItem[]
    // compute qty_available
    setItems(rawItems.map(i => ({
      ...i,
      qty_available: Math.max((i.qty_on_hand ?? 0) - (i.qty_reserved ?? 0), 0),
    })))
    setConditions((condRes.data ?? []) as CatalogueCondition[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Filtered items ─────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    const typeFilter = TYPE_BY_TAB[tab]
    return items.filter(item => {
      if (!showInactive && !item.is_active) return false
      if (typeFilter && item.item_type !== typeFilter) return false
      if (stockFilter === 'low' && !(item.is_stockable && (item.qty_on_hand ?? 0) <= (item.reorder_point ?? Infinity))) return false
      if (!matchText(item.name, cols.name)) return false
      if (!matchText(item.sku ?? item.code, cols.sku)) return false
      if (!matchText(item.brand, cols.brand)) return false
      if (!matchText(item.condition?.name, cols.condition)) return false
      if (!matchMoney(item.cost_price, cols.costMin, cols.costMax)) return false
      if (!matchMoney(item.sell_price, cols.sellMin, cols.sellMax)) return false
      if (search) {
        const q = search.toLowerCase()
        const hit = [item.name, item.sku, item.code, item.brand, item.description]
          .filter(Boolean).some(f => f!.toLowerCase().includes(q))
        if (!hit) return false
      }
      return true
    })
  }, [items, tab, search, stockFilter, showInactive, cols])

  // Counts per type tab (active catalogue only unless Show inactive)
  const counts = useMemo(() => {
    const base = showInactive ? items : items.filter(i => i.is_active)
    return {
      all:       base.length,
      parts:     base.filter(i => i.item_type === 'part').length,
      services:  base.filter(i => i.item_type === 'service').length,
      materials: base.filter(i => i.item_type === 'material').length,
      labour:    base.filter(i => i.item_type === 'labour').length,
    }
  }, [items, showInactive])

  const isMetaTab = tab === 'brands' || tab === 'conditions'
  const hasFilters = colsActive(cols) || !!search || stockFilter !== 'all' || showInactive

  // ── Brands tab data ────────────────────────────────────────────────────────
  const brands = useMemo(() => {
    const map = new Map<string, number>()
    items.filter(i => i.is_active || showInactive).forEach(i => {
      if (i.brand) map.set(i.brand, (map.get(i.brand) ?? 0) + 1)
    })
    return Array.from(map.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => a.brand.localeCompare(b.brand))
  }, [items, showInactive])

  // ── Conditions tab data ────────────────────────────────────────────────────
  const conditionCounts = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach(i => { if (i.condition_id) map.set(i.condition_id, (map.get(i.condition_id) ?? 0) + 1) })
    return map
  }, [items])

  // ── Drawer actions ─────────────────────────────────────────────────────────
  function openCreate() { setDrawerMode('create'); setDrawerItem(undefined); setDrawerOpen(true) }
  function openEdit(item: CatalogueItem) { setDrawerMode('edit'); setDrawerItem(item); setDrawerOpen(true) }
  function openDuplicate(item: CatalogueItem) { setDrawerMode('duplicate'); setDrawerItem(item); setDrawerOpen(true) }

  async function deactivateItem(item: CatalogueItem) {
    if (!confirm(`Deactivate "${item.name}"?`)) return
    const supabase = createClient()
    await supabase.from('quote_catalogue_items').update({ is_active: false }).eq('id', item.id)
    void load()
  }

  // ── Add custom condition ───────────────────────────────────────────────────
  async function addCondition() {
    if (!newCondName.trim() || !companyId) return
    const dupe = conditions.some(
      c => c.company_id === companyId && c.name.toLowerCase() === newCondName.trim().toLowerCase()
    )
    if (dupe) { alert('Condition already exists'); return }
    setCondSaving(true)
    const supabase = createClient()
    await supabase.from('catalogue_conditions').insert({ company_id: companyId, name: newCondName.trim() })
    setNewCondName('')
    setCondSaving(false)
    void load()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px] gap-2">
        <span className="material-icons animate-spin text-primary text-[20px]">refresh</span>
        Loading…
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary leading-tight">Inventory &amp; Services</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">Parts, services, materials and labour in one catalogue</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary h-8 px-3 text-[12px] flex items-center gap-1"
        >
          <span className="material-icons text-[16px]">add</span>
          Add Item
        </button>
      </div>

      {/* ── Toolbar: search + reset + type tabs (+ meta views) ── */}
      <div className="flex gap-2 px-4 py-2 border-b border-divider shrink-0 flex-wrap bg-surface items-center">
        {!isMetaTab && (
          <>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, SKU, brand…"
              className="form-input h-8 flex-1 min-w-[180px] text-[12px]"
            />
            <select
              value={stockFilter}
              onChange={e => setStockFilter(e.target.value as typeof stockFilter)}
              className="h-8 rounded-md border border-divider bg-surface px-2.5 text-[11px] text-text-primary"
            >
              <option value="all">All stock</option>
              <option value="low">Low / reorder</option>
            </select>
            <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none whitespace-nowrap">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
              Inactive
            </label>
            <ResetFiltersButton
              disabled={!hasFilters}
              onReset={() => {
                setCols(EMPTY_COLS)
                setSearch('')
                setStockFilter('all')
                setShowInactive(false)
              }}
            />
          </>
        )}
        <StatusFilterTabs
          tabs={TYPE_TABS}
          value={isMetaTab ? '' : tab}
          counts={counts}
          onChange={id => setTab(id as Tab)}
        />
        <button
          type="button"
          onClick={() => setTab('brands')}
          className={cn(
            'h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors bg-surface',
            tab === 'brands'
              ? 'bg-slate-800 text-white border-slate-800'
              : 'border-divider text-text-primary hover:bg-surface-elevated',
          )}
        >
          Brands
        </button>
        <button
          type="button"
          onClick={() => setTab('conditions')}
          className={cn(
            'h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors bg-surface',
            tab === 'conditions'
              ? 'bg-slate-800 text-white border-slate-800'
              : 'border-divider text-text-primary hover:bg-surface-elevated',
          )}
        >
          Conditions
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">

      {/* ══ Brands tab ══ */}
      {tab === 'brands' && (
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          {brands.length === 0 ? (
            <EmptyState icon="label_off" title="No brands yet" sub="Brands are set when creating parts or materials." />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-surface-elevated border-b border-divider text-left">
                  <th className={`${MONEY_TH} text-left`}>Brand</th>
                  <th className={`${MONEY_TH} text-right`}>Items</th>
                  <th className={MONEY_TH} />
                </tr>
              </thead>
              <tbody>
                {brands.map(b => (
                  <tr key={b.brand} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                    <td className={`${MONEY_TD} font-medium text-text-primary`}>{b.brand}</td>
                    <td className={`${MONEY_TD} text-right text-text-secondary`}>{b.count}</td>
                    <td className={`${MONEY_TD} text-right`}>
                      <button
                        onClick={() => {
                          setTab('all')
                          setCols(c => ({ ...c, brand: b.brand }))
                          setSearch('')
                        }}
                        className="text-primary text-[11px] hover:underline"
                      >
                        Filter items →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══ Conditions tab ══ */}
      {tab === 'conditions' && (
        <div className="space-y-4">
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            {conditions.length === 0 ? (
              <EmptyState icon="new_label" title="No conditions" sub="Standard conditions will appear here." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider text-left">
                    <th className={`${MONEY_TH} text-left`}>Name</th>
                    <th className={`${MONEY_TH} text-left`}>Type</th>
                    <th className={`${MONEY_TH} text-right`}>Items using</th>
                    <th className={MONEY_TH} />
                  </tr>
                </thead>
                <tbody>
                  {conditions.map(c => {
                    const usedCount = conditionCounts.get(c.id) ?? 0
                    const canDelete = !c.is_standard && usedCount === 0
                    return (
                      <tr key={c.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className={`${MONEY_TD} font-medium text-text-primary`}>{c.name}</td>
                        <td className={MONEY_TD}>
                          {c.is_standard ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Standard</span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-elevated text-text-secondary">Custom</span>
                          )}
                        </td>
                        <td className={`${MONEY_TD} text-right text-text-secondary`}>{usedCount}</td>
                        <td className={`${MONEY_TD} text-right`}>
                          {canDelete && (
                            <button
                              onClick={async () => {
                                if (!confirm('Delete this condition?')) return
                                const supabase = createClient()
                                await supabase.from('catalogue_conditions').delete().eq('id', c.id)
                                void load()
                              }}
                              className="text-red-500 hover:text-red-700 text-[11px]"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Add custom condition */}
          <div className="bg-surface border border-divider rounded-xl p-4">
            <p className="text-[12px] font-medium text-text-primary mb-3">Add custom condition</p>
            <div className="flex gap-2">
              <input
                value={newCondName}
                onChange={e => setNewCondName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void addCondition()}
                placeholder="e.g. Ex-demo, Returned"
                className="flex-1 h-8 rounded-md border border-divider bg-surface px-2.5 text-[12px] text-text-primary focus:outline-none focus:border-primary"
              />
              <button
                onClick={() => void addCondition()}
                disabled={!newCondName.trim() || condSaving}
                className="h-8 px-4 rounded-md bg-primary text-white text-[12px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {condSaving ? '…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Item table ══ */}
      {tab !== 'brands' && tab !== 'conditions' && (
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          {filteredItems.length === 0 ? (
            <EmptyState
              icon="inventory_2"
              title={search || colsActive(cols) ? 'No items match' : 'No items yet'}
              sub={search || colsActive(cols) ? 'Try clearing filters.' : 'Click "Add Item" to create your first catalogue entry.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 860 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider text-left sticky top-0 z-10">
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter label="Name" value={cols.name} onChange={v => patchCols({ name: v })} placeholder="Item name…" />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter label="SKU" value={cols.sku} onChange={v => patchCols({ sku: v })} placeholder="SKU / code…" />
                    </th>
                    {tab !== 'services' && tab !== 'labour' && (
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter label="Brand" value={cols.brand} onChange={v => patchCols({ brand: v })} placeholder="Brand…" />
                      </th>
                    )}
                    {(tab === 'parts' || tab === 'all') && (
                      <th className={`${MONEY_TH} text-left`}>
                        <TextHeaderFilter label="Condition" value={cols.condition} onChange={v => patchCols({ condition: v })} placeholder="Condition…" />
                      </th>
                    )}
                    <th className={`${MONEY_TH} text-left`}>Unit</th>
                    <th className={`${MONEY_TH} text-right`}>
                      <MoneyHeaderFilter
                        label="Cost"
                        min={cols.costMin}
                        max={cols.costMax}
                        onChange={({ min, max }) => patchCols({ costMin: min, costMax: max })}
                      />
                    </th>
                    <th className={`${MONEY_TH} text-right`}>
                      <MoneyHeaderFilter
                        label="Sell"
                        min={cols.sellMin}
                        max={cols.sellMax}
                        onChange={({ min, max }) => patchCols({ sellMin: min, sellMax: max })}
                      />
                    </th>
                    <th className={`${MONEY_TH} text-right`}>Margin</th>
                    {tab !== 'services' && tab !== 'labour' && (
                      <th className={`${MONEY_TH} text-right`}>On Hand</th>
                    )}
                    <th className={`${MONEY_TH} text-right`}>Suppliers</th>
                    <th className={MONEY_TH} />
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => {
                    const isLowStock = item.is_stockable && item.reorder_point != null &&
                      (item.qty_on_hand ?? 0) <= item.reorder_point
                    const margin = item.sell_price > 0
                      ? ((item.sell_price - item.cost_price) / item.sell_price) * 100
                      : 0
                    return (
                      <tr key={item.id} className={cn(
                        'border-b border-divider last:border-0 hover:bg-surface-elevated group',
                        !item.is_active && 'opacity-50',
                      )}>
                        <td className={MONEY_TD}>
                          <div className="font-medium text-text-primary flex items-center gap-1.5">
                            <TypeBadge type={item.item_type} />
                            {item.name}
                          </div>
                          {item.description && (
                            <div className="text-text-secondary truncate max-w-[200px] mt-0.5 text-[11px]">{item.description}</div>
                          )}
                        </td>
                        <td className={`${MONEY_TD} text-text-secondary font-mono`}>
                          {item.sku ?? item.code ?? '—'}
                        </td>
                        {tab !== 'services' && tab !== 'labour' && (
                          <td className={`${MONEY_TD} text-text-secondary`}>{item.brand ?? '—'}</td>
                        )}
                        {(tab === 'parts' || tab === 'all') && (
                          <td className={`${MONEY_TD} text-text-secondary`}>
                            {item.condition?.name ?? '—'}
                          </td>
                        )}
                        <td className={`${MONEY_TD} text-text-secondary`}>
                          {getUnitLabel(item.unit_of_measure ?? item.unit ?? 'each')}
                        </td>
                        <td className={`${MONEY_TD} text-right text-text-secondary`}>{fmtMoney(item.cost_price)}</td>
                        <td className={`${MONEY_TD} text-right font-medium text-text-primary`}>{fmtMoney(item.sell_price)}</td>
                        <td className={`${MONEY_TD} text-right text-text-secondary`}>{fmtPct(margin)}</td>
                        {tab !== 'services' && tab !== 'labour' && (
                          <td className={`${MONEY_TD} text-right`}>
                            {item.is_stockable ? (
                              <span className={cn('flex items-center justify-end gap-1', isLowStock ? 'text-red-500' : 'text-text-secondary')}>
                                {isLowStock && <span className="material-icons text-[14px]">warning</span>}
                                {fmtQty(item.qty_on_hand)}
                              </span>
                            ) : (
                              <span className="text-text-secondary">—</span>
                            )}
                          </td>
                        )}
                        <td className={`${MONEY_TD} text-right`}>
                          {(item.suppliers?.length ?? 0) > 0 ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                              {item.suppliers!.length}
                            </span>
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </td>
                        <td className={`${MONEY_TD} text-right`}>
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEdit(item)}
                              title="Edit"
                              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-elevated text-text-secondary hover:text-text-primary transition-colors"
                            >
                              <span className="material-icons text-[15px]">edit</span>
                            </button>
                            <button
                              onClick={() => openDuplicate(item)}
                              title="Duplicate"
                              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-elevated text-text-secondary hover:text-text-primary transition-colors"
                            >
                              <span className="material-icons text-[15px]">content_copy</span>
                            </button>
                            {item.is_stockable && (
                              <button
                                onClick={() => { setAdjustingItem(item); setShowAdjustModal(true) }}
                                title="Adjust stock"
                                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-elevated text-text-secondary hover:text-primary transition-colors"
                              >
                                <span className="material-icons text-[15px]">tune</span>
                              </button>
                            )}
                            {item.is_active && (
                              <button
                                onClick={() => void deactivateItem(item)}
                                title="Deactivate"
                                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 text-text-secondary hover:text-red-500 transition-colors"
                              >
                                <span className="material-icons text-[15px]">remove_circle_outline</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      </div>

      {/* ── Item form drawer ── */}
      {companyId && employeeId && (
        <ItemFormDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          mode={drawerMode}
          item={drawerItem}
          companyId={companyId}
          employeeId={employeeId}
          conditions={conditions}
          onSaved={() => { setDrawerOpen(false); void load() }}
        />
      )}

      {/* ── Adjust stock modal (row quick-action) ── */}
      {showAdjustModal && adjustingItem && companyId && employeeId && (
        <StockAdjustmentModal
          item={adjustingItem}
          companyId={companyId}
          employeeId={employeeId}
          onClose={() => { setShowAdjustModal(false); setAdjustingItem(null) }}
          onSaved={(newQty) => {
            setItems(prev => prev.map(i =>
              i.id === adjustingItem.id ? { ...i, qty_on_hand: newQty } : i
            ))
            setShowAdjustModal(false)
            setAdjustingItem(null)
          }}
        />
      )}

    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  part:     'bg-blue-50 text-blue-600',
  service:  'bg-purple-50 text-purple-600',
  material: 'bg-green-50 text-green-600',
  labour:   'bg-amber-50 text-amber-600',
}
const TYPE_ICONS: Record<string, string> = {
  part: 'build', service: 'miscellaneous_services', material: 'layers', labour: 'person_pin_circle',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center w-4 h-4 rounded-sm', TYPE_COLOURS[type] ?? 'bg-surface-elevated text-text-secondary')}>
      <span className="material-icons text-[11px]">{TYPE_ICONS[type] ?? 'help_outline'}</span>
    </span>
  )
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="material-icons text-[40px] text-divider mb-3">{icon}</span>
      <p className="text-[14px] font-medium text-text-primary">{title}</p>
      <p className="text-[12px] text-text-secondary mt-1">{sub}</p>
    </div>
  )
}
