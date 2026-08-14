'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { UNITS_OF_MEASURE } from '@/lib/units'
import type { CatalogueCondition, CatalogueItem, CatalogueItemAlias, CatalogueItemSupplier, AliasType, ItemType } from '@/types/inventory'

// ─── Local draft types ─────────────────────────────────────────────────────────

interface AliasDraft {
  id?: string
  alias_type: AliasType
  alias_value: string
  notes: string
  _delete?: boolean
}

interface SupplierDraft {
  id?: string
  supplier_id: string
  supplier_name: string
  supplier_sku: string
  unit_cost: string
  lead_time_days: string
  is_preferred: boolean
  notes: string
  _delete?: boolean
}

interface Contractor {
  id: string
  name: string
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const FORM_TABS = [
  { id: 'details',      label: 'Details' },
  { id: 'pricing',      label: 'Pricing' },
  { id: 'stock',        label: 'Stock & Suppliers' },
  { id: 'alternatives', label: 'Alternative numbers' },
] as const

type FormTab = typeof FORM_TABS[number]['id']

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALIAS_TYPE_LABELS: Record<AliasType, string> = {
  part_number:        'Part number',
  oem_number:         'OEM number',
  manufacturer_code:  'Manufacturer code',
  barcode:            'Barcode',
  name:               'Alternative name',
  superseded_number:  'Superseded number',
}

const ITEM_TYPES: { value: ItemType; label: string; icon: string }[] = [
  { value: 'part',     label: 'Part',     icon: 'build' },
  { value: 'service',  label: 'Service',  icon: 'miscellaneous_services' },
  { value: 'material', label: 'Material', icon: 'layers' },
  { value: 'labour',   label: 'Labour',   icon: 'person_pin_circle' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function calcMarkup(cost: number, sell: number): number {
  return cost > 0 ? ((sell - cost) / cost) * 100 : 0
}
function calcMargin(cost: number, sell: number): number {
  return sell > 0 ? ((sell - cost) / sell) * 100 : 0
}
function calcSellFromMarkup(cost: number, markupPct: number): number {
  return cost * (1 + markupPct / 100)
}

function stockable(type: ItemType) { return type === 'part' || type === 'material' }
function hasBrand(type: ItemType)  { return type === 'part' || type === 'material' }

// ─── Props ──────────────────────────────────────────────────────────────────────

interface ItemFormDrawerProps {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit' | 'duplicate'
  item?: CatalogueItem
  companyId: string
  conditions: CatalogueCondition[]
  onSaved: () => void
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ItemFormDrawer({
  open, onClose, mode, item, companyId, conditions, onSaved,
}: ItemFormDrawerProps) {
  const supabase = createClient()

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<FormTab>('details')
  const [tabError, setTabError]   = useState<Partial<Record<FormTab, boolean>>>({})

  // ── Core form fields ──────────────────────────────────────────────────────
  const [itemType,      setItemType]      = useState<ItemType>('part')
  const [name,          setName]          = useState('')
  const [sku,           setSku]           = useState('')
  const [description,   setDescription]   = useState('')
  const [brand,         setBrand]         = useState('')
  const [conditionId,   setConditionId]   = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('each')
  const [costPrice,     setCostPrice]     = useState('0.00')
  const [sellPrice,     setSellPrice]     = useState('0.00')
  const [markupPct,     setMarkupPct]     = useState('0.00')
  const [isStockable,   setIsStockable]   = useState(false)
  const [qtyOnHand,     setQtyOnHand]     = useState('0')
  const [reorderPoint,  setReorderPoint]  = useState('')
  const [reorderQty,    setReorderQty]    = useState('')
  const [binLocation,   setBinLocation]   = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  // ── Derived display field ─────────────────────────────────────────────────
  const marginDisplay = (() => {
    const c = parseFloat(costPrice) || 0
    const s = parseFloat(sellPrice) || 0
    return calcMargin(c, s).toFixed(1)
  })()

  // ── Alternatives (aliases) & suppliers ───────────────────────────────────
  const [aliases,   setAliases]   = useState<AliasDraft[]>([])
  const [suppliers, setSuppliers] = useState<SupplierDraft[]>([])

  // ── Brand autocomplete ────────────────────────────────────────────────────
  const [brandSuggestions, setBrandSuggestions] = useState<string[]>([])
  const [showBrandDrop,    setShowBrandDrop]    = useState(false)
  const brandDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Contractors for supplier dropdown ─────────────────────────────────────
  const [contractors, setContractors] = useState<Contractor[]>([])

  // ── Save state ────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // ── Populate form when opening ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setError(null)
    setTabError({})
    setActiveTab('details')

    if (item && (mode === 'edit' || mode === 'duplicate')) {
      setItemType((item.item_type as ItemType) ?? 'part')
      setName(mode === 'duplicate' ? `${item.name} (copy)` : item.name)
      setSku(item.sku ?? '')
      setDescription(item.description ?? '')
      setBrand(item.brand ?? '')
      setConditionId(item.condition_id ?? '')
      setUnitOfMeasure(item.unit_of_measure ?? item.unit ?? 'each')
      setCostPrice(String(item.cost_price ?? '0.00'))
      setSellPrice(String(item.sell_price ?? '0.00'))
      setMarkupPct(String(item.markup_percent ?? '0.00'))
      setIsStockable(item.is_stockable ?? false)
      setQtyOnHand(mode === 'duplicate' ? '0' : String(item.qty_on_hand ?? 0))
      setReorderPoint(item.reorder_point != null ? String(item.reorder_point) : '')
      setReorderQty(item.reorder_qty   != null ? String(item.reorder_qty)   : '')
      setBinLocation(item.bin_location ?? '')
      setInternalNotes(item.internal_notes ?? '')
      setAliases(
        (item.aliases ?? []).map(a => ({
          id: mode === 'duplicate' ? undefined : a.id,
          alias_type: a.alias_type, alias_value: a.alias_value, notes: a.notes ?? '',
        }))
      )
      setSuppliers(
        (item.suppliers ?? []).map(s => ({
          id: mode === 'duplicate' ? undefined : s.id,
          supplier_id: s.supplier_id, supplier_name: s.supplier?.name ?? '',
          supplier_sku: s.supplier_sku ?? '',
          unit_cost: s.unit_cost != null ? String(s.unit_cost) : '',
          lead_time_days: s.lead_time_days != null ? String(s.lead_time_days) : '',
          is_preferred: s.is_preferred, notes: s.notes ?? '',
        }))
      )
    } else {
      setItemType('part'); setName(''); setSku(''); setDescription('')
      setBrand(''); setConditionId(''); setUnitOfMeasure('each')
      setCostPrice('0.00'); setSellPrice('0.00'); setMarkupPct('0.00')
      setIsStockable(false); setQtyOnHand('0'); setReorderPoint(''); setReorderQty('')
      setBinLocation(''); setInternalNotes(''); setAliases([]); setSuppliers([])
    }
  }, [open, item, mode])

  // ── Load contractors once on open ─────────────────────────────────────────
  useEffect(() => {
    if (!open || contractors.length > 0) return
    supabase
      .from('contractors')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setContractors(data ?? []))
  }, [open, companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Brand autocomplete ────────────────────────────────────────────────────
  function onBrandChange(val: string) {
    setBrand(val)
    if (brandDebounce.current) clearTimeout(brandDebounce.current)
    brandDebounce.current = setTimeout(async () => {
      const { data } = await supabase.rpc('get_brand_suggestions', {
        p_company_id: companyId, p_query: val, p_limit: 10,
      })
      setBrandSuggestions((data ?? []).map((r: { brand: string }) => r.brand))
      setShowBrandDrop(true)
    }, 300)
  }

  // ── Pricing auto-calc ─────────────────────────────────────────────────────
  function onCostChange(val: string) {
    setCostPrice(val)
    const c = parseFloat(val) || 0
    const s = parseFloat(sellPrice) || 0
    setMarkupPct(calcMarkup(c, s).toFixed(2))
  }
  function onSellChange(val: string) {
    setSellPrice(val)
    const c = parseFloat(costPrice) || 0
    const s = parseFloat(val) || 0
    setMarkupPct(calcMarkup(c, s).toFixed(2))
  }
  function onMarkupChange(val: string) {
    setMarkupPct(val)
    const c = parseFloat(costPrice) || 0
    const m = parseFloat(val) || 0
    setSellPrice(calcSellFromMarkup(c, m).toFixed(2))
  }

  // ── Alternatives (aliases) ────────────────────────────────────────────────
  function addAlternative() {
    setAliases(prev => [...prev, { alias_type: 'part_number', alias_value: '', notes: '' }])
  }
  function updateAlias(i: number, patch: Partial<AliasDraft>) {
    setAliases(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }
  function removeAlias(i: number) {
    setAliases(prev => prev.map((a, idx) => idx === i ? { ...a, _delete: true } : a))
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────
  function addSupplier() {
    setSuppliers(prev => [...prev, {
      supplier_id: '', supplier_name: '', supplier_sku: '', unit_cost: '',
      lead_time_days: '', is_preferred: false, notes: '',
    }])
  }
  function updateSupplier(i: number, patch: Partial<SupplierDraft>) {
    setSuppliers(prev => prev.map((s, idx) => idx !== i ? s : { ...s, ...patch }))
  }
  function setPreferred(i: number) {
    setSuppliers(prev => prev.map((s, idx) => ({ ...s, is_preferred: idx === i })))
  }
  function removeSupplier(i: number) {
    setSuppliers(prev => prev.map((s, idx) => idx === i ? { ...s, _delete: true } : s))
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    // Validate
    const errors: Partial<Record<FormTab, boolean>> = {}
    if (!name.trim()) errors.details = true
    if (Object.keys(errors).length > 0) {
      setTabError(errors)
      // Switch to first erroring tab
      const firstError = FORM_TABS.find(t => errors[t.id])
      if (firstError) setActiveTab(firstError.id)
      setError('Please fill in required fields.')
      return
    }

    setSaving(true); setError(null); setTabError({})
    try {
      let normalizedBrand: string | null = null
      if (brand.trim()) {
        const { data: nb } = await supabase.rpc('normalize_brand', { p_brand: brand.trim() })
        normalizedBrand = nb as string ?? brand.trim()
      }

      const payload = {
        company_id:     companyId,
        name:           name.trim(),
        description:    description.trim() || null,
        item_type:      itemType,
        sku:            sku.trim() || null,
        brand:          normalizedBrand,
        condition_id:   conditionId || null,
        unit_of_measure: unitOfMeasure,
        cost_price:     parseFloat(costPrice) || 0,
        sell_price:     parseFloat(sellPrice) || 0,
        markup_percent: parseFloat(markupPct) || 0,
        is_stockable:   isStockable,
        qty_on_hand:    parseFloat(qtyOnHand) || 0,
        reorder_point:  reorderPoint ? parseFloat(reorderPoint) : null,
        reorder_qty:    reorderQty   ? parseFloat(reorderQty)   : null,
        bin_location:   binLocation.trim() || null,
        internal_notes: internalNotes.trim() || null,
        is_active:      true,
      }

      let itemId: string
      if (mode === 'edit' && item) {
        const { error: updateErr } = await supabase
          .from('quote_catalogue_items').update(payload).eq('id', item.id)
        if (updateErr) throw updateErr
        itemId = item.id
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('quote_catalogue_items').insert(payload).select('id').single()
        if (insertErr) throw insertErr
        itemId = inserted.id as string
      }

      // Sync alternatives (aliases)
      const toDeleteAliases = aliases.filter(a => a._delete && a.id).map(a => a.id!)
      if (toDeleteAliases.length > 0)
        await supabase.from('catalogue_item_aliases').delete().in('id', toDeleteAliases)
      for (const a of aliases.filter(a => !a._delete && a.alias_value.trim())) {
        if (a.id) {
          await supabase.from('catalogue_item_aliases')
            .update({ alias_type: a.alias_type, alias_value: a.alias_value.trim(), notes: a.notes || null })
            .eq('id', a.id)
        } else {
          await supabase.from('catalogue_item_aliases').insert({
            company_id: companyId, catalogue_item_id: itemId,
            alias_type: a.alias_type, alias_value: a.alias_value.trim(), notes: a.notes || null,
          })
        }
      }

      // Sync suppliers
      const toDeleteSuppliers = suppliers.filter(s => s._delete && s.id).map(s => s.id!)
      if (toDeleteSuppliers.length > 0)
        await supabase.from('catalogue_item_suppliers').delete().in('id', toDeleteSuppliers)
      for (const s of suppliers.filter(s => !s._delete && s.supplier_id)) {
        const sp = {
          company_id: companyId, catalogue_item_id: itemId, supplier_id: s.supplier_id,
          supplier_sku: s.supplier_sku.trim() || null,
          unit_cost: s.unit_cost ? parseFloat(s.unit_cost) : null,
          lead_time_days: s.lead_time_days ? parseInt(s.lead_time_days) : null,
          is_preferred: s.is_preferred, notes: s.notes.trim() || null,
        }
        if (s.id) await supabase.from('catalogue_item_suppliers').update(sp).eq('id', s.id)
        else await supabase.from('catalogue_item_suppliers').insert(sp)
      }

      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeAliases   = aliases.filter(a => !a._delete)
  const activeSuppliers = suppliers.filter(s => !s._delete)

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <h2 className="text-[16px] font-semibold text-text-primary">
            {mode === 'edit' ? 'Edit Item' : mode === 'duplicate' ? 'Duplicate Item' : 'Add Item'}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">close</span>
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex border-b border-divider px-6 shrink-0">
          {FORM_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {tab.label}
              {tabError[tab.id] && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ══ Details ══ */}
          {activeTab === 'details' && (
            <div className="space-y-5 max-w-2xl">
              {/* Type */}
              <div>
                <Label>Type</Label>
                <div className="grid grid-cols-4 gap-2 mt-1.5">
                  {ITEM_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setItemType(t.value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-lg py-3 border text-[12px] font-medium transition-colors',
                        itemType === t.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-divider text-text-secondary hover:border-primary/50 hover:text-text-primary',
                      )}
                    >
                      <span className="material-icons text-[20px]">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Name *" error={tabError.details && !name.trim()}>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); if (tabError.details) setTabError(p => ({ ...p, details: false })) }}
                  placeholder="e.g. Oil filter, Labour – Installation"
                  className={cn(inputCls, tabError.details && !name.trim() ? 'border-red-400' : '')}
                />
              </Field>

              <Field label="SKU / Code">
                <input value={sku} onChange={e => setSku(e.target.value)} placeholder="Optional internal code" className={inputCls} />
              </Field>

              <Field label="Description">
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Optional" className={inputCls + ' resize-none h-auto py-2'} />
              </Field>

              {hasBrand(itemType) && (
                <Field label="Brand">
                  <div className="relative">
                    <input
                      value={brand}
                      onChange={e => onBrandChange(e.target.value)}
                      onFocus={() => onBrandChange(brand)}
                      onBlur={() => setTimeout(() => setShowBrandDrop(false), 150)}
                      placeholder="e.g. Bosch, Toyota OEM"
                      className={inputCls}
                    />
                    {showBrandDrop && brandSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-divider rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                        {brandSuggestions.map(b => (
                          <button key={b} type="button"
                            onMouseDown={() => { setBrand(b); setShowBrandDrop(false) }}
                            className="flex w-full items-center px-3 py-2 text-[12px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary text-left">
                            {b}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
              )}

              {itemType === 'part' && (
                <Field label="Condition">
                  <select value={conditionId} onChange={e => setConditionId(e.target.value)} className={inputCls}>
                    <option value="">— None —</option>
                    {conditions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Unit of measure">
                <select value={unitOfMeasure} onChange={e => setUnitOfMeasure(e.target.value)} className={inputCls}>
                  {Object.entries(
                    UNITS_OF_MEASURE.reduce<Record<string, typeof UNITS_OF_MEASURE>>((acc, u) => {
                      ;(acc[u.group] ??= []).push(u)
                      return acc
                    }, {})
                  ).map(([group, units]) => (
                    <optgroup key={group} label={group}>
                      {units.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/* ══ Pricing ══ */}
          {activeTab === 'pricing' && (
            <div className="max-w-lg">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Cost price">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-[13px]">R</span>
                    <input type="number" min="0" step="0.01" value={costPrice} onChange={e => onCostChange(e.target.value)} className={inputCls + ' pl-7'} />
                  </div>
                </Field>
                <Field label="Sell price">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-[13px]">R</span>
                    <input type="number" min="0" step="0.01" value={sellPrice} onChange={e => onSellChange(e.target.value)} className={inputCls + ' pl-7'} />
                  </div>
                </Field>
                <Field label="Markup %">
                  <div className="relative">
                    <input type="number" min="0" step="0.01" value={markupPct} onChange={e => onMarkupChange(e.target.value)} className={inputCls + ' pr-7'} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary text-[13px]">%</span>
                  </div>
                </Field>
                <Field label="Gross margin %">
                  <div className={cn(inputCls, 'bg-surface-elevated text-text-secondary flex items-center justify-between')}>
                    <span>{marginDisplay}%</span>
                    <span className="material-icons text-[14px] text-divider">lock</span>
                  </div>
                </Field>
              </div>
            </div>
          )}

          {/* ══ Stock & Suppliers ══ */}
          {activeTab === 'stock' && (
            <div className="space-y-6 max-w-2xl">

              {/* Stock section — parts and materials only */}
              {stockable(itemType) && (
                <section>
                  <SectionHeading>Stock</SectionHeading>
                  <label className="flex items-center gap-3 cursor-pointer select-none mt-3">
                    <ToggleSwitch on={isStockable} onToggle={() => setIsStockable(v => !v)} />
                    <span className="text-[13px] text-text-primary">Track stock</span>
                  </label>

                  {isStockable && (
                    <div className="mt-4 grid grid-cols-2 gap-4">
                      <Field label="Qty on hand">
                        <input type="number" min="0" step="0.001" value={qtyOnHand} onChange={e => setQtyOnHand(e.target.value)} className={inputCls} />
                      </Field>
                      <Field label="Reorder point">
                        <input type="number" min="0" step="0.001" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} placeholder="—" className={inputCls} />
                      </Field>
                      <Field label="Reorder qty">
                        <input type="number" min="0" step="0.001" value={reorderQty} onChange={e => setReorderQty(e.target.value)} placeholder="—" className={inputCls} />
                      </Field>
                      <Field label="Bin / Location">
                        <input value={binLocation} onChange={e => setBinLocation(e.target.value)} placeholder="e.g. A-12-3" className={inputCls} />
                      </Field>
                    </div>
                  )}
                </section>
              )}

              {/* Suppliers section */}
              <section>
                <SectionHeading>Suppliers</SectionHeading>
                <div className="mt-3 space-y-3">
                  {activeSuppliers.map((s, i) => {
                    const realIdx = suppliers.indexOf(s)
                    return (
                      <div key={i} className="border border-divider rounded-lg p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={s.supplier_id}
                            onChange={e => {
                              const c = contractors.find(c => c.id === e.target.value)
                              updateSupplier(realIdx, { supplier_id: e.target.value, supplier_name: c?.name ?? '' })
                            }}
                            className={cn(inputCls, 'flex-1')}
                          >
                            <option value="">— Select supplier —</option>
                            {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => setPreferred(realIdx)}
                            title={s.is_preferred ? 'Preferred supplier' : 'Set as preferred'}
                            className={cn('transition-colors shrink-0', s.is_preferred ? 'text-amber-400' : 'text-text-secondary hover:text-amber-400')}
                          >
                            <span className="material-icons text-[22px]">{s.is_preferred ? 'star' : 'star_outline'}</span>
                          </button>
                          <button type="button" onClick={() => removeSupplier(realIdx)} className="text-text-secondary hover:text-red-500 shrink-0">
                            <span className="material-icons text-[20px]">close</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <Field label="Their SKU">
                            <input value={s.supplier_sku} onChange={e => updateSupplier(realIdx, { supplier_sku: e.target.value })} placeholder="—" className={inputCls} />
                          </Field>
                          <Field label="Unit cost">
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary text-[12px]">R</span>
                              <input type="number" min="0" step="0.01" value={s.unit_cost} onChange={e => updateSupplier(realIdx, { unit_cost: e.target.value })} className={cn(inputCls, 'pl-6')} />
                            </div>
                          </Field>
                          <Field label="Lead (days)">
                            <input type="number" min="0" value={s.lead_time_days} onChange={e => updateSupplier(realIdx, { lead_time_days: e.target.value })} placeholder="—" className={inputCls} />
                          </Field>
                        </div>
                      </div>
                    )
                  })}
                  <button type="button" onClick={addSupplier}
                    className="text-[13px] text-primary hover:underline flex items-center gap-1">
                    <span className="material-icons text-[16px]">add</span>
                    Add supplier
                  </button>
                </div>
              </section>

              {/* Notes */}
              <section>
                <SectionHeading>Notes</SectionHeading>
                <div className="mt-3">
                  <textarea
                    value={internalNotes}
                    onChange={e => setInternalNotes(e.target.value)}
                    rows={4}
                    placeholder="Not visible on quotes or invoices"
                    className={inputCls + ' resize-none h-auto py-2'}
                  />
                  <p className="text-[11px] text-text-secondary mt-1">Not visible on quotes or invoices</p>
                </div>
              </section>
            </div>
          )}

          {/* ══ Alternative numbers ══ */}
          {activeTab === 'alternatives' && (
            <div className="max-w-2xl">
              <p className="text-[13px] text-text-secondary mb-4">
                Store alternative part numbers, OEM codes, barcodes or superseded numbers for easier lookup.
              </p>

              {activeAliases.length > 0 && (
                <div className="border border-divider rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-divider bg-surface-elevated text-text-secondary text-left">
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Notes</th>
                        <th className="px-3 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {activeAliases.map((a, i) => {
                        const realIdx = aliases.indexOf(a)
                        return (
                          <tr key={i} className="border-b border-divider last:border-0">
                            <td className="px-3 py-2">
                              <select
                                value={a.alias_type}
                                onChange={e => updateAlias(realIdx, { alias_type: e.target.value as AliasType })}
                                className="h-8 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary w-full"
                              >
                                {(Object.entries(ALIAS_TYPE_LABELS) as [AliasType, string][]).map(([v, l]) => (
                                  <option key={v} value={v}>{l}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={a.alias_value}
                                onChange={e => updateAlias(realIdx, { alias_value: e.target.value })}
                                placeholder="Value"
                                className="h-8 w-full rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={a.notes}
                                onChange={e => updateAlias(realIdx, { notes: e.target.value })}
                                placeholder="—"
                                className="h-8 w-full rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button type="button" onClick={() => removeAlias(realIdx)} className="text-text-secondary hover:text-red-500">
                                <span className="material-icons text-[18px]">close</span>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <button type="button" onClick={() => { addAlternative(); }}
                className="text-[13px] text-primary hover:underline flex items-center gap-1">
                <span className="material-icons text-[16px]">add</span>
                Add alternative number
              </button>
            </div>
          )}

        </div>{/* end tab content */}

        {/* ── Footer ── */}
        {error && (
          <div className="mx-6 mb-1 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-[12px] border border-red-200 shrink-0">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-divider shrink-0">
          <button
            onClick={onClose}
            type="button"
            className="h-9 px-5 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            type="button"
            disabled={saving}
            className="h-9 px-6 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add item'}
          </button>
        </div>

      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Field({
  label, children, error,
}: {
  label: string; children: React.ReactNode; error?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={cn('text-[12px] font-medium', error ? 'text-red-500' : 'text-text-secondary')}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-medium text-text-secondary">{children}</p>
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary border-b border-divider pb-2">
      {children}
    </p>
  )
}

function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0', on ? 'bg-primary' : 'bg-divider')}
    >
      <span className={cn(
        'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
        on ? 'left-[18px]' : 'left-0.5',
      )} />
    </button>
  )
}

const inputCls = 'h-9 w-full rounded-md border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors'
