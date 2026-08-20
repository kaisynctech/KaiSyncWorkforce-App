'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { isSupplierKind } from '@/lib/partner-kinds'
import { UNITS_OF_MEASURE } from '@/lib/units'
import type {
  AliasType,
  CatalogueCondition,
  CatalogueItem,
  CatalogueItemAlias,
  CatalogueItemSupplier,
  ItemType,
} from '@/types/inventory'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrawerMode = 'create' | 'edit' | 'duplicate'

interface Props {
  open:        boolean
  onClose:     () => void
  mode:        DrawerMode
  item?:       CatalogueItem
  companyId:   string
  employeeId:  string
  conditions:  CatalogueCondition[]
  onSaved:     () => void
}

interface SupplierOption { id: string; name: string }

interface AliasRow extends Partial<CatalogueItemAlias> {
  _tempId: string
  alias_type: AliasType
  alias_value: string
  notes: string
}

interface SupplierRow {
  id?:            string
  _tempId:        string
  supplier_id:    string
  supplier_sku:   string
  unit_cost:      string   // kept as string for input binding
  lead_time_days: string   // kept as string for input binding
  is_preferred:   boolean
  notes:          string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_TYPES: { value: ItemType; label: string; icon: string }[] = [
  { value: 'part',     label: 'Part',     icon: 'build' },
  { value: 'service',  label: 'Service',  icon: 'miscellaneous_services' },
  { value: 'material', label: 'Material', icon: 'layers' },
  { value: 'labour',   label: 'Labour',   icon: 'person_pin_circle' },
]

const ALIAS_TYPES: { value: AliasType; label: string }[] = [
  { value: 'part_number',        label: 'Part number' },
  { value: 'oem_number',         label: 'OEM number' },
  { value: 'manufacturer_code',  label: 'Manufacturer code' },
  { value: 'barcode',            label: 'Barcode' },
  { value: 'name',               label: 'Alternative name' },
  { value: 'superseded_number',  label: 'Superseded number' },
]

function uid() { return crypto.randomUUID() }

// ─── Unit select (grouped) ────────────────────────────────────────────────────

function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const groups = Array.from(new Set(UNITS_OF_MEASURE.map(u => u.group)))
  // preserve unknown unit
  const known = UNITS_OF_MEASURE.some(u => u.value === value)
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-9 rounded-lg border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
    >
      {!known && <option value={value}>{value}</option>}
      {groups.map(g => (
        <optgroup key={g} label={g}>
          {UNITS_OF_MEASURE.filter(u => u.group === g).map(u => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ItemFormDrawer({
  open, onClose, mode, item, companyId, employeeId, conditions, onSaved,
}: Props) {
  const supabase = createClient()

  // ── Classification ─────────────────────────────────────────────────────────
  const [itemType,     setItemType]     = useState<ItemType>('part')
  const [name,         setName]         = useState('')
  const [sku,          setSku]          = useState('')
  const [description,  setDescription]  = useState('')

  // ── Part-specific ──────────────────────────────────────────────────────────
  const [brand,            setBrand]            = useState('')
  const [brandSuggestions, setBrandSuggestions] = useState<string[]>([])
  const [showBrandDrop,    setShowBrandDrop]    = useState(false)
  const [conditionId,      setConditionId]      = useState<string>('')
  const [variantGroupId,   setVariantGroupId]   = useState('')
  const [showVariant,      setShowVariant]      = useState(false)

  // ── Pricing ────────────────────────────────────────────────────────────────
  const [unitOfMeasure, setUnitOfMeasure] = useState('each')
  const [costStr,       setCostStr]       = useState('')
  const [sellStr,       setSellStr]       = useState('')
  const [markupStr,     setMarkupStr]     = useState('')

  // ── Stock ──────────────────────────────────────────────────────────────────
  const [isStockable,    setIsStockable]    = useState(false)
  const [qtyOnHandStr,   setQtyOnHandStr]   = useState('0')
  const [reorderPointStr,setReorderPointStr]= useState('')
  const [reorderQtyStr,  setReorderQtyStr]  = useState('')
  const [binLocation,    setBinLocation]    = useState('')

  // ── Aliases ────────────────────────────────────────────────────────────────
  const [showAliases, setShowAliases] = useState(false)
  const [aliases,     setAliases]     = useState<AliasRow[]>([])

  // ── Suppliers ──────────────────────────────────────────────────────────────
  const [showSuppliers,   setShowSuppliers]   = useState(false)
  const [suppliers,       setSuppliers]       = useState<SupplierRow[]>([])
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([])

  // ── Notes ──────────────────────────────────────────────────────────────────
  const [internalNotes, setInternalNotes] = useState('')

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // ── Brand debounce ─────────────────────────────────────────────────────────
  const brandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Margin (read-only) ────────────────────────────────────────────────────
  const cost   = parseFloat(costStr)  || 0
  const sell   = parseFloat(sellStr)  || 0
  const margin = sell > 0 ? ((sell - cost) / sell) * 100 : 0

  // ── Populate form when item changes ────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    void loadSupplierOptions()

    if (mode === 'create' || !item) {
      // Reset to blank
      setItemType('part'); setName(''); setSku(''); setDescription('')
      setBrand(''); setConditionId(''); setVariantGroupId(''); setShowVariant(false)
      setUnitOfMeasure('each'); setCostStr(''); setSellStr(''); setMarkupStr('')
      setIsStockable(false); setQtyOnHandStr('0'); setReorderPointStr('')
      setReorderQtyStr(''); setBinLocation(''); setInternalNotes('')
      setAliases([]); setSuppliers([])
      setShowAliases(false); setShowSuppliers(false)
      setError(null)
      return
    }

    // edit or duplicate
    setItemType(item.item_type)
    setName(mode === 'duplicate' ? `${item.name} (copy)` : item.name)
    setSku(item.sku ?? '')
    setDescription(item.description ?? '')
    setBrand(item.brand ?? '')
    setConditionId(item.condition_id ?? '')
    setVariantGroupId(item.variant_group_id ?? '')
    setShowVariant(!!item.variant_group_id)
    setUnitOfMeasure(item.unit_of_measure ?? item.unit ?? 'each')
    setCostStr(item.cost_price != null ? String(item.cost_price) : '')
    setSellStr(item.sell_price != null ? String(item.sell_price) : '')
    const mk = item.markup_percent ?? item.markup
    setMarkupStr(mk != null ? String(mk) : '')
    setIsStockable(item.is_stockable ?? false)
    setQtyOnHandStr(mode === 'duplicate' ? '0' : String(item.qty_on_hand ?? 0))
    setReorderPointStr(item.reorder_point != null ? String(item.reorder_point) : '')
    setReorderQtyStr(item.reorder_qty != null ? String(item.reorder_qty) : '')
    setBinLocation(item.bin_location ?? '')
    setInternalNotes(item.internal_notes ?? '')
    setAliases((item.aliases ?? []).map(a => ({
      ...a,
      _tempId: uid(),
      alias_type: a.alias_type,
      alias_value: a.alias_value,
      notes: a.notes ?? '',
    })))
    setSuppliers((item.suppliers ?? []).map(s => ({
      ...s,
      _tempId: uid(),
      supplier_id: s.supplier_id,
      supplier_sku: s.supplier_sku ?? '',
      unit_cost: s.unit_cost != null ? String(s.unit_cost) : '',
      lead_time_days: s.lead_time_days != null ? String(s.lead_time_days) : '',
      is_preferred: s.is_preferred,
      notes: s.notes ?? '',
    })))
    setShowAliases((item.aliases?.length ?? 0) > 0)
    setShowSuppliers((item.suppliers?.length ?? 0) > 0)
    setError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, item])

  // ── Markup ↔ Sell auto-calc ────────────────────────────────────────────────
  function handleCostChange(v: string) {
    setCostStr(v)
    const c = parseFloat(v) || 0
    const mk = parseFloat(markupStr)
    if (Number.isFinite(mk)) {
      setSellStr(String(+(c * (1 + mk / 100)).toFixed(2)))
    }
  }
  function handleSellChange(v: string) {
    setSellStr(v)
    const c = parseFloat(costStr) || 0
    const s = parseFloat(v) || 0
    if (c > 0) setMarkupStr(String(+((s - c) / c * 100).toFixed(2)))
  }
  function handleMarkupChange(v: string) {
    setMarkupStr(v)
    const c = parseFloat(costStr) || 0
    const mk = parseFloat(v) || 0
    setSellStr(String(+(c * (1 + mk / 100)).toFixed(2)))
  }

  // ── Brand autocomplete ─────────────────────────────────────────────────────
  async function loadBrandSuggestions(query: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('get_brand_suggestions', {
      p_company_id: companyId,
      p_query: query,
      p_limit: 10,
    })
    setBrandSuggestions(((data ?? []) as { brand: string }[]).map(r => r.brand))
    setShowBrandDrop(true)
  }

  function scheduleBrandSearch(q: string) {
    if (brandTimer.current) clearTimeout(brandTimer.current)
    brandTimer.current = setTimeout(() => void loadBrandSuggestions(q), 300)
  }

  // ── Supplier options ───────────────────────────────────────────────────────
  async function loadSupplierOptions() {
    const { data } = await supabase
      .from('contractors')
      .select('id, name, partner_kind')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')
    setSupplierOptions(
      ((data ?? []) as { id: string; name: string; partner_kind?: string | null }[])
        .filter(c => isSupplierKind(c.partner_kind))
        .map(c => ({ id: c.id, name: c.name }))
    )
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!name.trim()) { setError('Item name is required.'); return }
    setSaving(true); setError(null)

    // Normalize brand
    let normalizedBrand: string | null = null
    if (brand.trim()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: nb } = await (supabase.rpc as any)('normalize_brand', { p_brand: brand.trim() })
      normalizedBrand = (nb as string | null) ?? brand.trim()
    }

    const payload = {
      company_id:      companyId,
      name:            name.trim(),
      description:     description.trim() || null,
      item_type:       itemType,
      sku:             sku.trim() || null,
      brand:           normalizedBrand,
      condition_id:    conditionId || null,
      variant_group_id: variantGroupId.trim() || null,
      unit_of_measure: unitOfMeasure,
      cost_price:      parseFloat(costStr)  || 0,
      sell_price:      parseFloat(sellStr)  || 0,
      markup_percent:  parseFloat(markupStr) || 0,
      is_stockable:    isStockable,
      qty_on_hand:     parseFloat(qtyOnHandStr) || 0,
      reorder_point:   reorderPointStr ? parseFloat(reorderPointStr) : null,
      reorder_qty:     reorderQtyStr   ? parseFloat(reorderQtyStr)   : null,
      bin_location:    binLocation.trim() || null,
      internal_notes:  internalNotes.trim() || null,
      is_active:       true,
    }

    let savedId: string

    if (mode === 'edit' && item) {
      const { error: e } = await supabase
        .from('quote_catalogue_items')
        .update(payload)
        .eq('id', item.id)
      if (e) { setError(e.message); setSaving(false); return }
      savedId = item.id
    } else {
      // create or duplicate
      const insertPayload = { ...payload, created_by: employeeId }
      const { data: d, error: e } = await supabase
        .from('quote_catalogue_items')
        .insert(insertPayload)
        .select('id')
        .maybeSingle()
      if (e || !d) { setError(e?.message ?? 'Insert failed'); setSaving(false); return }
      savedId = (d as { id: string }).id
    }

    // Aliases: delete existing, insert new
    if (mode === 'edit' && item) {
      await supabase.from('catalogue_item_aliases').delete().eq('catalogue_item_id', item.id)
    }
    const aliasInserts = aliases
      .filter(a => a.alias_value.trim())
      .map(a => ({
        company_id:        companyId,
        catalogue_item_id: savedId,
        alias_type:        a.alias_type,
        alias_value:       a.alias_value.trim(),
        notes:             a.notes.trim() || null,
      }))
    if (aliasInserts.length > 0) {
      await supabase.from('catalogue_item_aliases').insert(aliasInserts)
    }

    // Suppliers: delete existing, insert new
    if (mode === 'edit' && item) {
      await supabase.from('catalogue_item_suppliers').delete().eq('catalogue_item_id', item.id)
    }
    const supplierInserts = suppliers
      .filter(s => s.supplier_id)
      .map(s => ({
        company_id:        companyId,
        catalogue_item_id: savedId,
        supplier_id:       s.supplier_id,
        supplier_sku:      s.supplier_sku.trim() || null,
        unit_cost:         s.unit_cost ? parseFloat(s.unit_cost) : null,
        lead_time_days:    s.lead_time_days ? parseInt(s.lead_time_days) : null,
        is_preferred:      s.is_preferred,
        notes:             s.notes.trim() || null,
      }))
    if (supplierInserts.length > 0) {
      await supabase.from('catalogue_item_suppliers').insert(supplierInserts)
    }

    setSaving(false)
    onSaved()
  }

  // ── Alias helpers ──────────────────────────────────────────────────────────
  function addAlias() {
    setAliases(prev => [...prev, {
      _tempId: uid(), alias_type: 'part_number', alias_value: '', notes: '',
    }])
  }
  function updateAlias(_tempId: string, patch: Partial<AliasRow>) {
    setAliases(prev => prev.map(a => a._tempId === _tempId ? { ...a, ...patch } : a))
  }
  function removeAlias(_tempId: string) {
    setAliases(prev => prev.filter(a => a._tempId !== _tempId))
  }

  // ── Supplier helpers ───────────────────────────────────────────────────────
  function addSupplierRow() {
    setSuppliers(prev => [...prev, {
      _tempId: uid(), supplier_id: '', supplier_sku: '', unit_cost: '',
      lead_time_days: '', is_preferred: prev.length === 0, notes: '',
    }])
  }
  function updateSupplier(_tempId: string, patch: Partial<SupplierRow>) {
    setSuppliers(prev => prev.map(s => {
      if (s._tempId !== _tempId) return s
      const merged = { ...s, ...patch }
      // if setting preferred, unset others
      if (patch.is_preferred) {
        return merged
      }
      return merged
    }))
    // unset preferred on others when one is set preferred
    if (patch.is_preferred) {
      setSuppliers(prev => prev.map(s =>
        s._tempId === _tempId ? s : { ...s, is_preferred: false }
      ))
    }
  }
  function removeSupplier(_tempId: string) {
    setSuppliers(prev => {
      const next = prev.filter(s => s._tempId !== _tempId)
      // if we removed the preferred, make the first one preferred
      if (next.length > 0 && !next.some(s => s.is_preferred)) {
        next[0] = { ...next[0], is_preferred: true }
      }
      return next
    })
  }

  const showPartFields = itemType === 'part' || itemType === 'material'
  const showStockFields = showPartFields

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!open) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[520px] bg-surface shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider shrink-0">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {mode === 'create' ? 'Add item' : mode === 'duplicate' ? 'Duplicate item' : 'Edit item'}
          </h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">

          {/* ── Section 1: Classification ── */}
          <section className="space-y-3">
            <p className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Classification</p>

            {/* Type selector */}
            <div className="grid grid-cols-4 gap-2">
              {ITEM_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setItemType(t.value)}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2.5 rounded-lg border text-[11px] font-medium transition-colors',
                    itemType === t.value
                      ? 'border-primary bg-primary/8 text-primary'
                      : 'border-divider text-text-secondary hover:border-primary/40 hover:text-text-primary',
                  )}
                >
                  <span className="material-icons text-[18px]">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Name */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Name *</label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Brake Pad Set — Toyota Hilux"
                className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
              />
            </div>

            {/* SKU */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">SKU / Code (optional)</label>
              <input
                type="text"
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder="e.g. BP-TOY-001"
                className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Short description shown on quotes…"
                className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary resize-none"
              />
            </div>
          </section>

          {/* ── Section 2: Part-specific ── */}
          {showPartFields && (
            <section className="space-y-3">
              <p className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">
                {itemType === 'part' ? 'Part details' : 'Material details'}
              </p>

              {/* Brand autocomplete */}
              <div className="relative">
                <label className="block text-[11px] text-text-secondary mb-1">Brand (optional)</label>
                <input
                  type="text"
                  value={brand}
                  onFocus={() => void loadBrandSuggestions(brand)}
                  onChange={e => { setBrand(e.target.value); scheduleBrandSearch(e.target.value) }}
                  onBlur={() => setTimeout(() => setShowBrandDrop(false), 150)}
                  placeholder="e.g. Brembo, Bosch, NGK"
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                />
                {showBrandDrop && brandSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface border border-divider rounded-lg shadow-lg overflow-hidden">
                    {brandSuggestions.map(b => (
                      <button
                        key={b}
                        type="button"
                        onMouseDown={() => { setBrand(b); setShowBrandDrop(false) }}
                        className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-surface-elevated transition-colors"
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Condition */}
              <div>
                <label className="block text-[11px] text-text-secondary mb-1">Condition (optional)</label>
                <select
                  value={conditionId}
                  onChange={e => setConditionId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-2 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                >
                  <option value="">— None —</option>
                  {conditions.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Variant group (advanced, collapsed) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowVariant(v => !v)}
                  className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary"
                >
                  <span className="material-icons text-[14px]">{showVariant ? 'expand_less' : 'expand_more'}</span>
                  Variant group (advanced)
                </button>
                {showVariant && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={variantGroupId}
                      onChange={e => setVariantGroupId(e.target.value)}
                      placeholder="Shared UUID to link related variants"
                      className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[12px] text-text-primary focus:outline-none focus:border-primary font-mono"
                    />
                    <p className="text-[11px] text-text-secondary mt-1">Leave blank unless this item is one variant of a group.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Section 3: Pricing ── */}
          <section className="space-y-3">
            <p className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Pricing</p>

            <div>
              <label className="block text-[11px] text-text-secondary mb-1">Unit of measure</label>
              <UnitSelect value={unitOfMeasure} onChange={setUnitOfMeasure} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-secondary mb-1">Cost price (R)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costStr}
                  onChange={e => handleCostChange(e.target.value)}
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-secondary mb-1">Sell price (R)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={sellStr}
                  onChange={e => handleSellChange(e.target.value)}
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-secondary mb-1">Markup %</label>
                <input
                  type="number"
                  step="0.01"
                  value={markupStr}
                  onChange={e => handleMarkupChange(e.target.value)}
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <span className="material-icons text-[14px]">info_outline</span>
              Gross margin: <span className="font-medium text-text-primary">{margin.toFixed(1)}%</span>
            </div>
          </section>

          {/* ── Section 4: Stock ── */}
          {showStockFields && (
            <section className="space-y-3">
              <p className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Stock</p>

              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  role="switch"
                  aria-checked={isStockable}
                  onClick={() => setIsStockable(v => !v)}
                  className={cn(
                    'w-10 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0',
                    isStockable ? 'bg-primary' : 'bg-divider',
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded-full bg-white shadow mt-0.5 transition-transform',
                    isStockable ? 'translate-x-4.5' : 'translate-x-0.5',
                  )} />
                </div>
                <span className="text-[13px] text-text-primary">Track stock for this item</span>
              </label>

              {isStockable && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-text-secondary mb-1">
                      {mode === 'create' || mode === 'duplicate' ? 'Opening qty on hand' : 'Qty on hand'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={qtyOnHandStr}
                      onChange={e => setQtyOnHandStr(e.target.value)}
                      readOnly={mode === 'edit'}
                      className={cn(
                        'w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary',
                        mode === 'edit' && 'opacity-60 cursor-default',
                      )}
                    />
                    {mode === 'edit' && (
                      <p className="text-[11px] text-text-secondary mt-1">Use the Adjust icon on the table row to change stock.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-secondary mb-1">Reorder point</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={reorderPointStr}
                      onChange={e => setReorderPointStr(e.target.value)}
                      className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-secondary mb-1">Reorder qty</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={reorderQtyStr}
                      onChange={e => setReorderQtyStr(e.target.value)}
                      className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-secondary mb-1">Bin location</label>
                    <input
                      type="text"
                      value={binLocation}
                      onChange={e => setBinLocation(e.target.value)}
                      placeholder="e.g. A3-S2"
                      className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Section 5: Aliases ── */}
          <section>
            <button
              type="button"
              onClick={() => setShowAliases(v => !v)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary hover:text-text-primary w-full"
            >
              <span className="material-icons text-[16px]">{showAliases ? 'expand_less' : 'expand_more'}</span>
              Alternative numbers &amp; names
              {aliases.length > 0 && (
                <span className="ml-1 text-[10px] bg-surface-elevated px-1.5 py-0.5 rounded-full">{aliases.length}</span>
              )}
            </button>

            {showAliases && (
              <div className="mt-3 space-y-2">
                {aliases.map(a => (
                  <div key={a._tempId} className="grid grid-cols-[120px_1fr_1fr_auto] gap-2 items-center">
                    <select
                      value={a.alias_type}
                      onChange={e => updateAlias(a._tempId, { alias_type: e.target.value as AliasType })}
                      className="h-8 rounded-md border border-divider bg-surface px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-primary"
                    >
                      {ALIAS_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={a.alias_value}
                      onChange={e => updateAlias(a._tempId, { alias_value: e.target.value })}
                      placeholder="Value"
                      className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                    />
                    <input
                      type="text"
                      value={a.notes}
                      onChange={e => updateAlias(a._tempId, { notes: e.target.value })}
                      placeholder="Notes (opt)"
                      className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => removeAlias(a._tempId)}
                      className="text-text-secondary hover:text-red-500 transition-colors"
                    >
                      <span className="material-icons text-[16px]">close</span>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addAlias}
                  className="text-[12px] text-primary hover:underline mt-1"
                >
                  + Add alias
                </button>
              </div>
            )}
          </section>

          {/* ── Section 6: Suppliers ── */}
          <section>
            <button
              type="button"
              onClick={() => setShowSuppliers(v => !v)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary hover:text-text-primary w-full"
            >
              <span className="material-icons text-[16px]">{showSuppliers ? 'expand_less' : 'expand_more'}</span>
              Suppliers
              {suppliers.length > 0 && (
                <span className="ml-1 text-[10px] bg-surface-elevated px-1.5 py-0.5 rounded-full">{suppliers.length}</span>
              )}
            </button>

            {showSuppliers && (
              <div className="mt-3 space-y-2">
                {suppliers.map(s => (
                  <div key={s._tempId} className="p-3 rounded-lg border border-divider space-y-2">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                      <select
                        value={s.supplier_id}
                        onChange={e => updateSupplier(s._tempId, { supplier_id: e.target.value })}
                        className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                      >
                        <option value="">Select supplier…</option>
                        {supplierOptions.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title={s.is_preferred ? 'Preferred supplier' : 'Set as preferred'}
                        onClick={() => updateSupplier(s._tempId, { is_preferred: true })}
                        className={cn(
                          'text-[18px] transition-colors',
                          s.is_preferred ? 'text-amber-400' : 'text-divider hover:text-amber-300',
                        )}
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSupplier(s._tempId)}
                        className="text-text-secondary hover:text-red-500 transition-colors"
                      >
                        <span className="material-icons text-[16px]">close</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={s.supplier_sku}
                        onChange={e => updateSupplier(s._tempId, { supplier_sku: e.target.value })}
                        placeholder="Their SKU"
                        className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={s.unit_cost}
                        onChange={e => updateSupplier(s._tempId, { unit_cost: e.target.value })}
                        placeholder="Unit cost (R)"
                        className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                      />
                      <input
                        type="number"
                        min="0"
                        value={s.lead_time_days}
                        onChange={e => updateSupplier(s._tempId, { lead_time_days: e.target.value })}
                        placeholder="Lead days"
                        className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addSupplierRow}
                  className="text-[12px] text-primary hover:underline"
                >
                  + Add supplier
                </button>
              </div>
            )}
          </section>

          {/* ── Section 7: Notes ── */}
          <section className="space-y-2">
            <label className="block text-[11px] text-text-secondary">Internal notes (not shown on quotes)</label>
            <textarea
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Notes for your team only…"
              className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary resize-none"
            />
          </section>

        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-divider shrink-0 space-y-2">
          {error && <p className="text-[12px] text-red-500">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-9 rounded-lg border border-divider text-[13px] text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex-1 h-9 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Add item' : mode === 'duplicate' ? 'Duplicate' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
