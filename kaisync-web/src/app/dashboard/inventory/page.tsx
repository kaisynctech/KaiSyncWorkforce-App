'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getUnitLabel } from '@/lib/units'
import ItemFormDrawer from '@/components/inventory/ItemFormDrawer'
import type { CatalogueCondition, CatalogueItem, ItemType } from '@/types/inventory'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'parts' | 'services' | 'materials' | 'labour' | 'brands' | 'conditions'

const TABS: { key: Tab; label: string; type?: ItemType }[] = [
  { key: 'all',       label: 'All' },
  { key: 'parts',     label: 'Parts',     type: 'part' },
  { key: 'services',  label: 'Services',  type: 'service' },
  { key: 'materials', label: 'Materials', type: 'material' },
  { key: 'labour',    label: 'Labour',    type: 'labour' },
  { key: 'brands',    label: 'Brands' },
  { key: 'conditions',label: 'Conditions' },
]

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
  const [companyId, setCompanyId]   = useState<string | null>(null)
  const [items, setItems]           = useState<CatalogueItem[]>([])
  const [conditions, setConditions] = useState<CatalogueCondition[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<Tab>('all')

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search,      setSearch]      = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all')
  const [showInactive,setShowInactive]= useState(false)

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen]   = useState(false)
  const [drawerMode, setDrawerMode]   = useState<DrawerMode>('create')
  const [drawerItem, setDrawerItem]   = useState<CatalogueItem | undefined>(undefined)

  // ── Conditions tab ─────────────────────────────────────────────────────────
  const [newCondName, setNewCondName] = useState('')
  const [condSaving,  setCondSaving]  = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member?.companyId) return
    setCompanyId(member.companyId)

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
    const typeFilter = TABS.find(t => t.key === tab)?.type
    return items.filter(item => {
      if (!showInactive && !item.is_active) return false
      if (typeFilter && item.item_type !== typeFilter) return false
      if (stockFilter === 'low' && !(item.is_stockable && (item.qty_on_hand ?? 0) <= (item.reorder_point ?? Infinity))) return false
      if (search) {
        const q = search.toLowerCase()
        const hit = [item.name, item.sku, item.code, item.brand, item.description]
          .filter(Boolean).some(f => f!.toLowerCase().includes(q))
        if (!hit) return false
      }
      return true
    })
  }, [items, tab, search, stockFilter, showInactive])

  // Counts per tab
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
    <div className="p-6 max-w-7xl mx-auto">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-text-primary">Inventory &amp; Services</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">Parts, services, materials and labour in one catalogue</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors"
        >
          <span className="material-icons text-[16px]">add</span>
          Add Item
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-0 border-b border-divider mb-4 overflow-x-auto">
        {TABS.map(t => {
          const count = t.type ? counts[t.key as keyof typeof counts] : undefined
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 whitespace-nowrap transition-colors',
                tab === t.key
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {t.label}
              {count !== undefined && (
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full',
                  tab === t.key ? 'bg-primary/10 text-primary' : 'bg-surface-elevated text-text-secondary',
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Filters (item tabs only) ── */}
      {tab !== 'brands' && tab !== 'conditions' && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-icons text-[16px] text-text-secondary">search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, SKU, brand…"
              className="h-8 w-full rounded-md border border-divider bg-surface pl-8 pr-3 text-[12px] text-text-primary focus:outline-none focus:border-primary"
            />
          </div>

          <select
            value={stockFilter}
            onChange={e => setStockFilter(e.target.value as typeof stockFilter)}
            className="h-8 rounded-md border border-divider bg-surface px-2.5 text-[12px] text-text-primary"
          >
            <option value="all">All stock levels</option>
            <option value="low">Low / reorder needed</option>
          </select>

          <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
            Show inactive
          </label>
        </div>
      )}

      {/* ══ Brands tab ══ */}
      {tab === 'brands' && (
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          {brands.length === 0 ? (
            <EmptyState icon="label_off" title="No brands yet" sub="Brands are set when creating parts or materials." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-divider text-text-secondary text-left">
                  <th className="px-4 py-2.5 font-medium">Brand</th>
                  <th className="px-4 py-2.5 font-medium text-right">Items</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {brands.map(b => (
                  <tr key={b.brand} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                    <td className="px-4 py-2.5 font-medium text-text-primary">{b.brand}</td>
                    <td className="px-4 py-2.5 text-right text-text-secondary">{b.count}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => { setTab('all'); setSearch(b.brand) }}
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
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-divider text-text-secondary text-left">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium text-right">Items using</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {conditions.map(c => {
                    const usedCount = conditionCounts.get(c.id) ?? 0
                    const canDelete = !c.is_standard && usedCount === 0
                    return (
                      <tr key={c.id} className="border-b border-divider last:border-0 hover:bg-surface-elevated">
                        <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                        <td className="px-4 py-2.5">
                          {c.is_standard ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Standard</span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-elevated text-text-secondary">Custom</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-secondary">{usedCount}</td>
                        <td className="px-4 py-2.5 text-right">
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
              title={search ? 'No items match' : 'No items yet'}
              sub={search ? 'Try a different search term.' : 'Click "Add Item" to create your first catalogue entry.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-divider text-text-secondary text-left">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">SKU</th>
                    {tab !== 'services' && tab !== 'labour' && (
                      <th className="px-4 py-2.5 font-medium">Brand</th>
                    )}
                    {(tab === 'parts' || tab === 'all') && (
                      <th className="px-4 py-2.5 font-medium">Condition</th>
                    )}
                    <th className="px-4 py-2.5 font-medium">Unit</th>
                    <th className="px-4 py-2.5 font-medium text-right">Cost</th>
                    <th className="px-4 py-2.5 font-medium text-right">Sell</th>
                    <th className="px-4 py-2.5 font-medium text-right">Margin</th>
                    {tab !== 'services' && tab !== 'labour' && (
                      <th className="px-4 py-2.5 font-medium text-right">On Hand</th>
                    )}
                    <th className="px-4 py-2.5 font-medium text-right">Suppliers</th>
                    <th className="px-4 py-2.5 font-medium" />
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
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-text-primary flex items-center gap-1.5">
                            <TypeBadge type={item.item_type} />
                            {item.name}
                          </div>
                          {item.description && (
                            <div className="text-text-secondary truncate max-w-[200px] mt-0.5">{item.description}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary font-mono">
                          {item.sku ?? item.code ?? '—'}
                        </td>
                        {tab !== 'services' && tab !== 'labour' && (
                          <td className="px-4 py-2.5 text-text-secondary">{item.brand ?? '—'}</td>
                        )}
                        {(tab === 'parts' || tab === 'all') && (
                          <td className="px-4 py-2.5 text-text-secondary">
                            {item.condition?.name ?? '—'}
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-text-secondary">
                          {getUnitLabel(item.unit_of_measure ?? item.unit ?? 'each')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-secondary">{fmtMoney(item.cost_price)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-text-primary">{fmtMoney(item.sell_price)}</td>
                        <td className="px-4 py-2.5 text-right text-text-secondary">{fmtPct(margin)}</td>
                        {tab !== 'services' && tab !== 'labour' && (
                          <td className="px-4 py-2.5 text-right">
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
                        <td className="px-4 py-2.5 text-right">
                          {(item.suppliers?.length ?? 0) > 0 ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                              {item.suppliers!.length}
                            </span>
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
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

      {/* ── Item form drawer ── */}
      {companyId && (
        <ItemFormDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          mode={drawerMode}
          item={drawerItem}
          companyId={companyId}
          conditions={conditions}
          onSaved={() => { setDrawerOpen(false); void load() }}
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
