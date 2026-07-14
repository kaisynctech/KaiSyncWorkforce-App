'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { Toggle } from '@/components/Toggle'
import type { InventoryItem } from '@/types/database'

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Supplier { id: string; name: string }

export default function InventoryDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const itemId = params.id
  const isNew = itemId === 'new'

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [description, setDescription] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [quantityOnHand, setQuantityOnHand] = useState('')
  const [reorderLevel, setReorderLevel] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [supplierId, setSupplierId] = useState('')

  const stockValuePreview = (() => {
    const qty = parseFloat(quantityOnHand) || 0
    const cost = parseFloat(unitCost) || 0
    return `Stock value: ${fmtR(qty * cost)}`
  })()

  useEffect(() => {
    loadSuppliers()
    if (!isNew) loadItem()
  }, [itemId])

  async function loadSuppliers() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    setCompanyId(member.companyId)
    const { data } = await supabase.from('suppliers').select('id, name').eq('company_id', member.companyId).order('name')
    setSuppliers((data ?? []) as Supplier[])
  }

  async function loadItem() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('inventory_items')
      .select('*, supplier:suppliers(id, name)')
      .eq('id', itemId)
      .single()

    if (!data) { router.push('/dashboard/inventory'); return }

    const item = data as InventoryItem
    setName(item.name)
    setSku(item.sku ?? '')
    setDescription(item.description ?? '')
    setUnitOfMeasure(item.unit_of_measure ?? '')
    setUnitCost(String(item.unit_cost ?? ''))
    setSellingPrice(String(item.selling_price ?? ''))
    setQuantityOnHand(String(item.quantity_on_hand ?? ''))
    setReorderLevel(String(item.reorder_level ?? ''))
    setIsActive(item.is_active ?? true)
    setSupplierId(item.supplier_id ?? '')
    setLoading(false)
  }

  async function save() {
    if (!name.trim()) { setError('Item name is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      name: name.trim(),
      sku: sku.trim() || null,
      description: description.trim() || null,
      unit_of_measure: unitOfMeasure.trim() || null,
      unit_cost: parseFloat(unitCost) || 0,
      selling_price: sellingPrice ? parseFloat(sellingPrice) : null,
      quantity_on_hand: parseInt(quantityOnHand) || 0,
      reorder_level: parseInt(reorderLevel) || 0,
      is_active: isActive,
      supplier_id: supplierId || null,
    }

    if (isNew) {
      const { data: nc, error: e } = await supabase
        .from('inventory_items')
        .insert({ ...payload, company_id: companyId })
        .select()
        .single()
      if (e) { setError(e.message); setSaving(false); return }
      router.push(`/dashboard/inventory/${nc.id}`)
    } else {
      const { error: e } = await supabase.from('inventory_items').update(payload).eq('id', itemId)
      if (e) setError(e.message)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/inventory" className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary truncate">{name || (isNew ? 'New Item' : 'Item')}</h1>
        </div>
        <button onClick={save} disabled={saving}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[80px]">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">

        {/* ITEM DETAILS */}
        <div className="card p-4 space-y-3">
          <p className="section-label">ITEM DETAILS</p>
          <input placeholder="Item name *" value={name} onChange={e => setName(e.target.value)} className="dark-entry w-full" />
          <input placeholder="SKU / code" value={sku} onChange={e => setSku(e.target.value)} className="dark-entry w-full" />
          <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)}
            rows={3} className="dark-entry w-full min-h-[64px] py-2 resize-none" />
          <input placeholder="Unit (each, box, kg…)" value={unitOfMeasure} onChange={e => setUnitOfMeasure(e.target.value)} className="dark-entry w-full" />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Unit cost (R)</label>
              <input type="number" value={unitCost} onChange={e => setUnitCost(e.target.value)} className="dark-entry" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Selling price (R)</label>
              <input type="number" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} className="dark-entry" />
            </div>
          </div>
        </div>

        {/* SUPPLIER */}
        <div className="card p-4 space-y-3">
          <p className="section-label">SUPPLIER</p>
          <p className="text-text-secondary text-[11px]">Where you purchase this item (used on jobs and costing).</p>
          <div className="flex items-center gap-2">
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="dark-entry flex-1 appearance-none">
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="text-primary text-sm px-2 hover:opacity-70 transition-opacity">+ New</button>
          </div>
        </div>

        {/* STOCK */}
        <div className="card p-4 space-y-3">
          <p className="section-label">STOCK</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Quantity on hand</label>
              <input type="number" value={quantityOnHand} onChange={e => setQuantityOnHand(e.target.value)} className="dark-entry" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-secondary">Reorder level</label>
              <input type="number" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} className="dark-entry" />
            </div>
          </div>
          <p className="text-text-primary text-sm">{stockValuePreview}</p>
          <div className="flex items-center justify-between">
            <span className="text-text-primary text-sm">Active item</span>
            <Toggle checked={isActive} onChange={setIsActive} activeColor="#16A34A" />
          </div>
        </div>

        {/* Allocate button (hidden for new items) */}
        {!isNew && (
          <button className="btn-outlined w-full h-11 text-[13px]">
            Allocate stock to open job
          </button>
        )}
      </div>
    </div>
  )
}
